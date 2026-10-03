import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function makeActor(overrides: Record<string, any> = {}) {
  const hp = { value: 20, temp: 0, max: 20, ...(overrides.hp ?? {}) };
  const actor: any = {
    id: overrides.id ?? 'actor-1',
    name: overrides.name ?? 'Test Actor',
    system: { attributes: { hp } },
    applyDamage: vi.fn(async () => undefined),
    rollSkill: vi.fn(),
    rollToolCheck: vi.fn(),
    rollAbilityCheck: vi.fn(),
    rollSavingThrow: vi.fn(),
  };
  return actor;
}

function setupFoundry(
  options: {
    actor?: any;
    token?: { id: string; actor: any } | null;
    allowWriteOperations?: boolean;
    systemId?: string;
  } = {}
) {
  const actor = options.actor ?? makeActor();
  const actors = Object.assign([actor], {
    get: (id: string) => (id === actor.id ? actor : undefined),
  });

  const token = options.token === null ? undefined : (options.token ?? { id: 'token-1', actor });
  const tokens = {
    get: (id: string) => (token && id === token.id ? token : undefined),
  };
  const scene = { id: 'scene-1', tokens };
  const scenes = Object.assign([scene], { current: scene, active: scene });

  vi.stubGlobal('Hooks', { on: vi.fn(), call: vi.fn(() => true), callAll: vi.fn() });
  vi.stubGlobal('game', {
    ready: true,
    world: { id: 'world-1' },
    user: { id: 'gm-1', name: 'GM', isGM: true },
    system: { id: options.systemId ?? 'dnd5e' },
    actors,
    scenes,
    settings: {
      get: vi.fn(() => options.allowWriteOperations ?? true),
    },
  });

  return { actor, token, dataAccess: new FoundryDataAccess() };
}

describe('FoundryDataAccess.applyDamage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('rejects non-dnd5e systems', async () => {
    const { dataAccess } = setupFoundry({ systemId: 'pf2e' });

    await expect(dataAccess.applyDamage({ actorId: 'actor-1', amount: 10 })).rejects.toThrow(
      /requires D&D 5e/
    );
  });

  it('rejects when both healing and temp are set', async () => {
    const { dataAccess } = setupFoundry();

    await expect(
      dataAccess.applyDamage({ actorId: 'actor-1', amount: 5, healing: true, temp: true })
    ).rejects.toThrow(/cannot both be true/);
  });

  it('rejects a negative amount', async () => {
    const { dataAccess } = setupFoundry();

    await expect(dataAccess.applyDamage({ actorId: 'actor-1', amount: -5 })).rejects.toThrow(
      /non-negative/
    );
  });

  it('rejects when neither actorId nor tokenId is given', async () => {
    const { dataAccess } = setupFoundry();

    await expect(dataAccess.applyDamage({ amount: 5 } as any)).rejects.toThrow(
      /actorId or tokenId is required/
    );
  });

  it('denies the operation when write operations are disabled in module settings', async () => {
    const { dataAccess } = setupFoundry({ allowWriteOperations: false });

    await expect(dataAccess.applyDamage({ actorId: 'actor-1', amount: 5 })).rejects.toThrow(
      /Access denied/
    );
  });

  it('passes a typed damage description to Actor5e#applyDamage and reports the resolved change', async () => {
    const actor = makeActor({ hp: { value: 20, temp: 0, max: 20 } });
    // Simulate dnd5e resistance halving 10 fire damage to 5.
    actor.applyDamage.mockImplementation(async () => {
      actor.system.attributes.hp.value -= 5;
    });
    const { dataAccess } = setupFoundry({ actor });

    const result = await dataAccess.applyDamage({ actorId: 'actor-1', amount: 10, type: 'fire' });

    expect(actor.applyDamage).toHaveBeenCalledWith([{ value: 10, type: 'fire' }], {});
    expect(result).toMatchObject({
      success: true,
      actorId: 'actor-1',
      hpBefore: { value: 20, temp: 0, max: 20 },
      hpAfter: { value: 15, temp: 0, max: 20 },
      amountApplied: 5,
    });
  });

  it('heals using the "healing" damage type and reports a negative amountApplied', async () => {
    const actor = makeActor({ hp: { value: 10, temp: 0, max: 20 } });
    actor.applyDamage.mockImplementation(async () => {
      actor.system.attributes.hp.value += 5;
    });
    const { dataAccess } = setupFoundry({ actor });

    const result = await dataAccess.applyDamage({ actorId: 'actor-1', amount: 5, healing: true });

    expect(actor.applyDamage).toHaveBeenCalledWith([{ value: 5, type: 'healing' }], {});
    expect(result.amountApplied).toBe(-5);
    expect(result.hpAfter).toEqual({ value: 15, temp: 0, max: 20 });
  });

  it('grants temporary hit points using the "temphp" damage type', async () => {
    const actor = makeActor({ hp: { value: 10, temp: 0, max: 20 } });
    actor.applyDamage.mockImplementation(async () => {
      actor.system.attributes.hp.temp = 8;
    });
    const { dataAccess } = setupFoundry({ actor });

    const result = await dataAccess.applyDamage({ actorId: 'actor-1', amount: 8, temp: true });

    expect(actor.applyDamage).toHaveBeenCalledWith([{ value: 8, type: 'temphp' }], {});
    expect(result.amountApplied).toBe(-8);
    expect(result.hpAfter).toEqual({ value: 10, temp: 8, max: 20 });
  });

  it('prefers the token synthetic actor over a world actor lookup when tokenId is given', async () => {
    const tokenActor = makeActor({ id: 'token-actor', hp: { value: 5, temp: 0, max: 10 } });
    const { dataAccess } = setupFoundry({
      token: { id: 'token-9', actor: tokenActor },
    });

    const result = await dataAccess.applyDamage({ tokenId: 'token-9', amount: 2, type: 'cold' });

    expect(tokenActor.applyDamage).toHaveBeenCalledWith([{ value: 2, type: 'cold' }], {});
    expect(result.tokenId).toBe('token-9');
    expect(result.actorId).toBe('token-actor');
  });

  it('throws when the given tokenId is not found on the current scene', async () => {
    const { dataAccess } = setupFoundry({ token: null });

    await expect(dataAccess.applyDamage({ tokenId: 'missing', amount: 1 })).rejects.toThrow(
      /not found in current scene/
    );
  });
});

describe('FoundryDataAccess.rollCheck', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function makeRoll(overrides: Record<string, any> = {}) {
    return {
      total: 15,
      formula: '1d20 + 3',
      d20: { total: 12 },
      parent: { id: 'message-1' },
      ...overrides,
    };
  }

  it('rejects non-dnd5e systems', async () => {
    const { dataAccess } = setupFoundry({ systemId: 'pf2e' });

    await expect(
      dataAccess.rollCheck({ actorId: 'actor-1', kind: 'skill', key: 'prc' })
    ).rejects.toThrow(/requires D&D 5e/);
  });

  it('denies the operation when write operations are disabled in module settings', async () => {
    const { dataAccess } = setupFoundry({ allowWriteOperations: false });

    await expect(
      dataAccess.rollCheck({ actorId: 'actor-1', kind: 'skill', key: 'prc' })
    ).rejects.toThrow(/Access denied/);
  });

  it('rolls a skill check with no dialog and maps advantage/dc/bonus', async () => {
    const actor = makeActor();
    actor.rollSkill.mockResolvedValue([makeRoll()]);
    const { dataAccess } = setupFoundry({ actor });

    const result = await dataAccess.rollCheck({
      actorId: 'actor-1',
      kind: 'skill',
      key: 'prc',
      dc: 15,
      advantage: true,
      bonus: '+2',
    });

    expect(actor.rollSkill).toHaveBeenCalledWith(
      { skill: 'prc', advantage: true, target: 15, rolls: [{ parts: ['+2'] }] },
      { configure: false },
      {}
    );
    expect(result).toMatchObject({
      success: true,
      total: 15,
      natural: 12,
      dc: 15,
      succeeded: true,
      messageId: 'message-1',
    });
  });

  it('rolls a tool check using the tool key', async () => {
    const actor = makeActor();
    actor.rollToolCheck.mockResolvedValue([makeRoll({ total: 8 })]);
    const { dataAccess } = setupFoundry({ actor });

    const result = await dataAccess.rollCheck({
      actorId: 'actor-1',
      kind: 'tool',
      key: 'thief',
      dc: 10,
    });

    expect(actor.rollToolCheck).toHaveBeenCalledWith(
      { tool: 'thief', target: 10 },
      { configure: false },
      {}
    );
    expect(result.succeeded).toBe(false);
  });

  it('rolls an ability check using the ability key', async () => {
    const actor = makeActor();
    actor.rollAbilityCheck.mockResolvedValue([makeRoll()]);
    const { dataAccess } = setupFoundry({ actor });

    await dataAccess.rollCheck({ actorId: 'actor-1', kind: 'ability', key: 'dex' });

    expect(actor.rollAbilityCheck).toHaveBeenCalledWith(
      { ability: 'dex' },
      { configure: false },
      {}
    );
  });

  it('rolls a saving throw using the ability key', async () => {
    const actor = makeActor();
    actor.rollSavingThrow.mockResolvedValue([makeRoll()]);
    const { dataAccess } = setupFoundry({ actor });

    await dataAccess.rollCheck({
      actorId: 'actor-1',
      kind: 'save',
      key: 'wis',
      disadvantage: true,
    });

    expect(actor.rollSavingThrow).toHaveBeenCalledWith(
      { ability: 'wis', disadvantage: true },
      { configure: false },
      {}
    );
  });

  it('omits dc/succeeded when no dc is given', async () => {
    const actor = makeActor();
    actor.rollSkill.mockResolvedValue([makeRoll()]);
    const { dataAccess } = setupFoundry({ actor });

    const result = await dataAccess.rollCheck({ actorId: 'actor-1', kind: 'skill', key: 'prc' });

    expect(result.dc).toBeUndefined();
    expect(result.succeeded).toBeUndefined();
  });

  it('throws a clear error when the roll produces no result', async () => {
    const actor = makeActor();
    actor.rollSkill.mockResolvedValue(null);
    const { dataAccess } = setupFoundry({ actor });

    await expect(
      dataAccess.rollCheck({ actorId: 'actor-1', kind: 'skill', key: 'bogus' })
    ).rejects.toThrow(/did not produce a result/);
  });
});
