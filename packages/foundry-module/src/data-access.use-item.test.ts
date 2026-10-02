import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

interface MockTokenDocument {
  id: string;
  name: string;
  actorId: string;
  actor: {
    id: string;
    name: string;
    uuid: string;
    img: string;
    system: any;
    statuses: Set<string>;
  };
  object?: MockToken | null;
}

interface MockToken {
  id: string;
  name: string;
  actor: MockTokenDocument['actor'];
  document: MockTokenDocument;
  setTarget: ReturnType<typeof vi.fn>;
}

function createToken(
  id: string,
  name: string,
  actorId: string,
  actorName = name,
  ac = 12
): MockToken {
  const actor = {
    id: actorId,
    name: actorName,
    uuid: `Actor.${actorId}`,
    img: `${actorId}.webp`,
    system: { attributes: { ac: { value: ac } } },
    statuses: new Set<string>(),
  };
  const document: MockTokenDocument = { id, name, actorId, actor };
  const token: MockToken = {
    id,
    name,
    actor,
    document,
    setTarget: vi.fn().mockResolvedValue(undefined),
  };
  document.object = token;
  return token;
}

/** A TokenDocument as seen on a client without a canvas: no rendered placeable. */
function headless(token: MockToken): MockTokenDocument {
  return { ...token.document, object: null };
}

function setupFoundry(
  options: {
    tokens?: MockToken[];
    controlled?: MockToken[];
    scene?: boolean;
    documents?: MockTokenDocument[];
    canvas?: boolean;
    item?: any;
    sceneOnCurrent?: boolean;
  } = {}
) {
  const itemUse = vi.fn().mockResolvedValue(undefined);
  const item = options.item ?? {
    id: 'item-1',
    name: 'Shadow Dive',
    type: 'feat',
    use: itemUse,
  };
  const actor = {
    id: 'actor-1',
    name: 'Kai Veyl',
    items: Object.assign([item], {
      get: (id: string) => (id === item.id ? item : undefined),
    }),
  };
  const actors = Object.assign([actor], {
    get: (identifier: string) => (identifier === actor.id ? actor : undefined),
    getName: (identifier: string) => (identifier === actor.name ? actor : undefined),
  });
  const tokens = options.tokens ?? [];
  const scene =
    options.scene === false
      ? undefined
      : {
          id: 'scene-1',
          name: 'Test Scene',
          tokens: options.documents ?? tokens.map(token => token.document),
        };
  // Headless (core.noCanvas): game.scenes.current is null and only the active scene exists.
  const scenes = Object.assign(scene ? [scene] : [], {
    active: options.sceneOnCurrent ? undefined : scene,
    current: options.sceneOnCurrent ? scene : null,
  });
  const updateTokenTargets = vi.fn();

  vi.stubGlobal('Hooks', { on: vi.fn() });
  vi.stubGlobal('game', {
    ready: true,
    world: { id: 'world-1' },
    user: { id: 'user-1', name: 'GM', updateTokenTargets },
    system: { id: 'dnd5e' },
    actors,
    scenes,
  });
  if (options.canvas !== false) {
    vi.stubGlobal('canvas', {
      scene,
      tokens: {
        placeables: tokens,
        controlled: options.controlled ?? [],
      },
    });
  } else {
    vi.stubGlobal('canvas', undefined);
  }

  return {
    actor,
    item,
    itemUse,
    updateTokenTargets,
    dataAccess: new FoundryDataAccess(),
  };
}

describe('FoundryDataAccess.useItem targeting', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('leaves current targets unchanged when targets are omitted', async () => {
    const target = createToken('target-1', 'Goblin', 'actor-2');
    const { dataAccess, itemUse, updateTokenTargets } = setupFoundry({ tokens: [target] });

    const result = await dataAccess.useItem({
      actorIdentifier: 'Kai Veyl',
      itemIdentifier: 'Shadow Dive',
    });

    expect(target.setTarget).not.toHaveBeenCalled();
    expect(updateTokenTargets).not.toHaveBeenCalled();
    expect(itemUse).toHaveBeenCalledOnce();
    expect(result.targeting).toEqual({
      status: 'not-requested',
      requested: [],
      applied: [],
      unresolved: [],
      failed: [],
    });
  });

  it('resolves self to a controlled token for the acting actor', async () => {
    const firstToken = createToken('actor-token-a', 'Kai A', 'actor-1', 'Kai Veyl');
    const controlledToken = createToken('actor-token-b', 'Kai B', 'actor-1', 'Kai Veyl');
    const laterControlledToken = createToken('actor-token-z', 'Kai Z', 'actor-1', 'Kai Veyl');
    const { dataAccess, itemUse } = setupFoundry({
      tokens: [firstToken, laterControlledToken, controlledToken],
      controlled: [laterControlledToken, controlledToken],
    });

    const result = await dataAccess.useItem({
      actorIdentifier: 'Kai Veyl',
      itemIdentifier: 'Shadow Dive',
      targets: ['self'],
    });

    expect(firstToken.setTarget).not.toHaveBeenCalled();
    expect(laterControlledToken.setTarget).not.toHaveBeenCalled();
    expect(controlledToken.setTarget).toHaveBeenCalledWith(true, { releaseOthers: true });
    expect(itemUse).toHaveBeenCalledOnce();
    expect(result.targeting.status).toBe('applied');
    expect(result.targeting.applied).toEqual([
      { identifier: 'self', tokenId: 'actor-token-b', tokenName: 'Kai B' },
    ]);
  });

  it('targets an explicit token by ID through Token#setTarget', async () => {
    const target = createToken('target-1', 'Goblin', 'actor-2');
    const { dataAccess, updateTokenTargets } = setupFoundry({ tokens: [target] });

    const result = await dataAccess.useItem({
      actorIdentifier: 'Kai Veyl',
      itemIdentifier: 'Shadow Dive',
      targets: ['target-1'],
    });

    expect(target.setTarget).toHaveBeenCalledWith(true, { releaseOthers: true });
    expect(updateTokenTargets).not.toHaveBeenCalled();
    expect(result.targets).toEqual(['Goblin']);
    expect(result.targeting.status).toBe('applied');
  });

  it('releases previous targets once before applying multiple targets', async () => {
    const goblin = createToken('target-1', 'Goblin', 'actor-2');
    const orc = createToken('target-2', 'Orc', 'actor-3');
    const { dataAccess } = setupFoundry({ tokens: [goblin, orc] });

    const result = await dataAccess.useItem({
      actorIdentifier: 'Kai Veyl',
      itemIdentifier: 'Shadow Dive',
      targets: ['Orc', 'Goblin'],
    });

    expect(orc.setTarget).toHaveBeenCalledOnce();
    expect(goblin.setTarget).toHaveBeenCalledOnce();
    expect(orc.setTarget).toHaveBeenCalledWith(true, { releaseOthers: true });
    expect(goblin.setTarget).toHaveBeenCalledWith(true, { releaseOthers: false });
    expect(result.targeting.status).toBe('applied');
    expect(result.targeting.applied.map(target => target.tokenName)).toEqual(['Orc', 'Goblin']);
  });

  it('reports an unresolved target and still initiates item use', async () => {
    const { dataAccess, itemUse } = setupFoundry();

    const result = await dataAccess.useItem({
      actorIdentifier: 'Kai Veyl',
      itemIdentifier: 'Shadow Dive',
      targets: ['Missing Target'],
    });

    expect(itemUse).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.status).toBe('initiated');
    expect(result.targeting.status).toBe('failed');
    expect(result.targeting.unresolved).toEqual(['Missing Target']);
    expect(result.warnings).toEqual([
      'Target "Missing Target" was not found in the current scene.',
    ]);
  });

  it('reports partial targeting when only some requested targets resolve', async () => {
    const goblin = createToken('target-1', 'Goblin', 'actor-2');
    const { dataAccess, itemUse } = setupFoundry({ tokens: [goblin] });

    const result = await dataAccess.useItem({
      actorIdentifier: 'Kai Veyl',
      itemIdentifier: 'Shadow Dive',
      targets: ['Goblin', 'Missing Target'],
    });

    expect(goblin.setTarget).toHaveBeenCalledWith(true, { releaseOthers: true });
    expect(itemUse).toHaveBeenCalledOnce();
    expect(result.targeting.status).toBe('partial');
    expect(result.targeting.unresolved).toEqual(['Missing Target']);
  });

  it('reports a Token#setTarget failure without crashing item use', async () => {
    const target = createToken('target-1', 'Goblin', 'actor-2');
    target.setTarget.mockRejectedValue(new Error('Target API unavailable'));
    const { dataAccess, itemUse } = setupFoundry({ tokens: [target] });

    const result = await dataAccess.useItem({
      actorIdentifier: 'Kai Veyl',
      itemIdentifier: 'Shadow Dive',
      targets: ['Goblin'],
    });

    expect(target.setTarget).toHaveBeenCalledWith(true, { releaseOthers: true });
    expect(itemUse).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.status).toBe('initiated');
    expect(result.targeting.status).toBe('failed');
    expect(result.targeting.failed).toEqual([
      {
        identifier: 'Goblin',
        tokenId: 'target-1',
        tokenName: 'Goblin',
        error: 'Target API unavailable',
      },
    ]);
    expect(result.warnings).toEqual(['Failed to target "Goblin": Target API unavailable']);
  });

  it('keeps releaseOthers true until a target is successfully applied', async () => {
    const goblin = createToken('target-1', 'Goblin', 'actor-2');
    const orc = createToken('target-2', 'Orc', 'actor-3');
    goblin.setTarget.mockRejectedValue(new Error('Target API unavailable'));
    const { dataAccess, itemUse } = setupFoundry({ tokens: [goblin, orc] });

    const result = await dataAccess.useItem({
      actorIdentifier: 'Kai Veyl',
      itemIdentifier: 'Shadow Dive',
      targets: ['Goblin', 'Orc'],
    });

    expect(goblin.setTarget).toHaveBeenCalledWith(true, { releaseOthers: true });
    expect(orc.setTarget).toHaveBeenCalledWith(true, { releaseOthers: true });
    expect(itemUse).toHaveBeenCalledOnce();
    expect(result.targeting.status).toBe('partial');
    expect(result.targeting.applied).toEqual([
      { identifier: 'Orc', tokenId: 'target-2', tokenName: 'Orc' },
    ]);
    expect(result.targeting.failed).toEqual([
      {
        identifier: 'Goblin',
        tokenId: 'target-1',
        tokenName: 'Goblin',
        error: 'Target API unavailable',
      },
    ]);
  });
});

function roll(total: number, options: Record<string, any> = {}, extra: Record<string, any> = {}) {
  return {
    total,
    formula: extra.formula ?? '1d20 + 4',
    options,
    isCritical: extra.isCritical ?? false,
    isFumble: extra.isFumble ?? false,
    parent: { id: extra.messageId ?? 'msg-roll' },
  };
}

function createActivity(
  id: string,
  type: string,
  name: string,
  overrides: Record<string, any> = {}
) {
  return {
    id,
    type,
    name,
    canUse: true,
    damage: { parts: [{}] },
    target: { template: { type: '' } },
    use: vi.fn().mockResolvedValue({ message: { id: 'msg-usage' }, effects: [], templates: [] }),
    rollAttack: vi.fn(),
    rollDamage: vi.fn(),
    ...overrides,
  };
}

function createDnd5eItem(activities: any[]) {
  return {
    id: 'bite-1',
    name: 'Bite',
    type: 'weapon',
    use: vi.fn().mockResolvedValue(undefined),
    system: { activities: new Map(activities.map(activity => [activity.id, activity])) },
  };
}

describe('FoundryDataAccess.useItem dnd5e activities', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the GM confirmation dialog by default and returns initiated', async () => {
    const attack = createActivity('act-attack', 'attack', 'Attack');
    const save = createActivity('act-save', 'save', 'Save');
    const item = createDnd5eItem([attack, save]);
    const { dataAccess } = setupFoundry({ item });

    const result = await dataAccess.useItem({
      actorIdentifier: 'Kai Veyl',
      itemIdentifier: 'Bite',
      options: { activity: 'attack' },
    });

    // Activity chosen directly, so no ActivityChoiceDialog; usage dialog left at dnd5e default.
    expect(attack.use).toHaveBeenCalledWith({}, {}, {});
    expect(item.use).not.toHaveBeenCalled();
    expect(attack.rollAttack).not.toHaveBeenCalled();
    expect(result.status).toBe('initiated');
    expect(result.requiresGMInteraction).toBe(true);
    expect(result.activity).toEqual({ id: 'act-attack', name: 'Attack', type: 'attack' });
  });

  it('falls back to Item#use (activity choice dialog) by default when no activity is given', async () => {
    const item = createDnd5eItem([
      createActivity('act-attack', 'attack', 'Attack'),
      createActivity('act-save', 'save', 'Save'),
    ]);
    const { dataAccess } = setupFoundry({ item });

    const result = await dataAccess.useItem({
      actorIdentifier: 'Kai Veyl',
      itemIdentifier: 'Bite',
      options: { consume: false },
    });

    expect(item.use).toHaveBeenCalledWith({ consume: false }, {}, {});
    expect(result.status).toBe('initiated');
    expect(result.activity).toBeUndefined();
  });

  it('runs an attack unattended against a headless scene token and returns the rolls', async () => {
    const attack = createActivity('act-attack', 'attack', 'Attack');
    attack.rollAttack.mockResolvedValue([
      roll(17, { target: 12, attackMode: 'oneHanded' }, { messageId: 'msg-attack' }),
    ]);
    attack.rollDamage.mockResolvedValue([
      roll(
        7,
        { type: 'piercing', types: ['piercing'] },
        { formula: '2d4 + 2', messageId: 'msg-damage' }
      ),
    ]);
    const item = createDnd5eItem([attack, createActivity('act-save', 'save', 'Save')]);
    const charlie = createToken('tok-charlie', 'Charlie', 'actor-charlie', 'Charlie', 12);
    const { dataAccess } = setupFoundry({
      item,
      canvas: false,
      documents: [headless(charlie)],
    });

    const result = await dataAccess.useItem({
      actorIdentifier: 'Kai Veyl',
      itemIdentifier: 'Bite',
      targets: ['Charlie'],
      options: { activity: 'attack', skipDialogs: true },
    });

    const targets = [
      { name: 'Charlie', img: 'actor-charlie.webp', uuid: 'Actor.actor-charlie', ac: 12 },
    ];
    expect(attack.use).toHaveBeenCalledWith(
      { subsequentActions: false, create: { measuredTemplate: false } },
      { configure: false },
      { data: { flags: { dnd5e: { targets } } } }
    );
    const rollMessage = {
      data: { flags: { dnd5e: { originatingMessage: 'msg-usage', targets } } },
    };
    expect(attack.rollAttack).toHaveBeenCalledWith(
      { target: 12 },
      { configure: false },
      rollMessage
    );
    expect(attack.rollDamage).toHaveBeenCalledWith(
      { isCritical: false, attackMode: 'oneHanded' },
      { configure: false },
      rollMessage
    );
    expect(charlie.setTarget).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
    expect(result.requiresGMInteraction).toBe(false);
    expect(result.targeting.status).toBe('applied');
    expect(result.attack).toEqual({
      total: 17,
      formula: '1d20 + 4',
      targetAC: 12,
      hit: true,
      isCritical: false,
      isFumble: false,
      messageId: 'msg-attack',
    });
    expect(result.damage).toEqual({
      total: 7,
      types: ['piercing'],
      isCritical: false,
      rolls: [{ total: 7, formula: '2d4 + 2', type: 'piercing', types: ['piercing'] }],
      messageId: 'msg-damage',
    });
    expect(result.messageIds).toEqual(['msg-usage', 'msg-attack', 'msg-damage']);
  });

  it('resolves targets from game.scenes.current when it exists', async () => {
    const attack = createActivity('act-attack', 'attack', 'Attack');
    attack.rollAttack.mockResolvedValue([roll(5, { target: 15 })]);
    const item = createDnd5eItem([attack]);
    const goblin = createToken('tok-goblin', 'Goblin', 'actor-goblin', 'Goblin', 15);
    const { dataAccess } = setupFoundry({
      item,
      canvas: false,
      sceneOnCurrent: true,
      documents: [headless(goblin)],
    });

    const result = await dataAccess.useItem({
      actorIdentifier: 'Kai Veyl',
      itemIdentifier: 'Bite',
      targets: ['tok-goblin'],
      options: { skipDialogs: true },
    });

    // Single activity is picked without an "activity" param; a miss skips damage.
    expect(result.targets).toEqual(['Goblin']);
    expect(result.attack?.hit).toBe(false);
    expect(attack.rollDamage).not.toHaveBeenCalled();
    expect(result.damage).toBeUndefined();
  });

  it('reports hit as null and still rolls damage when there is no target', async () => {
    const attack = createActivity('act-attack', 'attack', 'Attack');
    attack.rollAttack.mockResolvedValue([roll(14, {}, { isCritical: true })]);
    attack.rollDamage.mockResolvedValue([roll(9, { type: 'slashing' })]);
    const { dataAccess } = setupFoundry({ item: createDnd5eItem([attack]), canvas: false });

    const result = await dataAccess.useItem({
      actorIdentifier: 'Kai Veyl',
      itemIdentifier: 'Bite',
      options: { skipDialogs: true },
    });

    expect(attack.use).toHaveBeenCalledWith(
      { subsequentActions: false, create: { measuredTemplate: false } },
      { configure: false },
      {}
    );
    expect(attack.rollAttack).toHaveBeenCalledWith(
      {},
      { configure: false },
      { data: { flags: { dnd5e: { originatingMessage: 'msg-usage' } } } }
    );
    expect(attack.rollDamage.mock.calls[0]?.[0]).toEqual({ isCritical: true });
    expect(result.attack?.hit).toBeNull();
    expect(result.damage?.total).toBe(9);
  });

  it('requires an activity choice when unattended and the item has several', async () => {
    const item = createDnd5eItem([
      createActivity('act-attack', 'attack', 'Attack'),
      createActivity('act-save', 'save', 'Save'),
    ]);
    const { dataAccess } = setupFoundry({ item });

    await expect(
      dataAccess.useItem({
        actorIdentifier: 'Kai Veyl',
        itemIdentifier: 'Bite',
        options: { skipDialogs: true },
      })
    ).rejects.toThrow(/has 2 activities; pass "activity"/);
    expect(item.use).not.toHaveBeenCalled();
  });

  it('selects activities by id or name and rejects unknown or ambiguous requests', async () => {
    const first = createActivity('act-1', 'save', 'Poison');
    const second = createActivity('act-2', 'save', 'Knockdown');
    const item = createDnd5eItem([first, second]);
    const { dataAccess } = setupFoundry({ item });

    await dataAccess.useItem({
      actorIdentifier: 'Kai Veyl',
      itemIdentifier: 'Bite',
      options: { activity: 'act-2' },
    });
    expect(second.use).toHaveBeenCalledOnce();

    await dataAccess.useItem({
      actorIdentifier: 'Kai Veyl',
      itemIdentifier: 'Bite',
      options: { activity: 'poison' },
    });
    expect(first.use).toHaveBeenCalledOnce();

    await expect(
      dataAccess.useItem({
        actorIdentifier: 'Kai Veyl',
        itemIdentifier: 'Bite',
        options: { activity: 'save' },
      })
    ).rejects.toThrow(/ambiguous/);
    await expect(
      dataAccess.useItem({
        actorIdentifier: 'Kai Veyl',
        itemIdentifier: 'Bite',
        options: { activity: 'heal' },
      })
    ).rejects.toThrow(/not found/);
  });

  it('rolls save damage and reports the DC, passing consume and spell slot options', async () => {
    const save = createActivity('act-save', 'save', 'Save', {
      save: { dc: { value: 11 }, ability: new Set(['str']) },
    });
    save.rollDamage.mockResolvedValue([roll(4, { type: 'poison' })]);
    const { dataAccess } = setupFoundry({ item: createDnd5eItem([save]) });

    const result = await dataAccess.useItem({
      actorIdentifier: 'Kai Veyl',
      itemIdentifier: 'Bite',
      options: { skipDialogs: true, consume: false, spellLevel: 3 },
    });

    expect(save.use.mock.calls[0]?.[0]).toEqual({
      consume: false,
      spell: { slot: 'spell3' },
      subsequentActions: false,
      create: { measuredTemplate: false },
    });
    expect(save.rollAttack).not.toHaveBeenCalled();
    expect(result.save).toEqual({ dc: 11, abilities: ['str'] });
    expect(result.damage?.types).toEqual(['poison']);
  });

  it('throws when dnd5e declines to use the activity', async () => {
    const attack = createActivity('act-attack', 'attack', 'Attack');
    attack.use.mockResolvedValue(undefined);
    const { dataAccess } = setupFoundry({ item: createDnd5eItem([attack]) });

    await expect(
      dataAccess.useItem({
        actorIdentifier: 'Kai Veyl',
        itemIdentifier: 'Bite',
        options: { skipDialogs: true },
      })
    ).rejects.toThrow(/did not use activity "Attack"/);
    expect(attack.rollAttack).not.toHaveBeenCalled();
  });
});
