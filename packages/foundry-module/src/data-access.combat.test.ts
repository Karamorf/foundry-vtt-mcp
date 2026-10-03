import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function makeCollection<T extends { id: string; name?: string }>(docs: T[]) {
  const list = [...docs];
  const collection = Object.assign(list, {
    contents: list,
    get: (id: string) => list.find(d => d.id === id),
    getName: (name: string) => list.find(d => d.name === name),
  });
  // Object.assign would flatten a getter, so define size separately
  Object.defineProperty(collection, 'size', { get: () => list.length });
  return collection as typeof collection & { readonly size: number };
}

function makeActor(id: string, name: string, overrides: Record<string, any> = {}) {
  return {
    id,
    name,
    type: overrides.type ?? 'npc',
    statuses: new Set<string>(overrides.statuses ?? []),
    system: {
      attributes: {
        hp: overrides.hp ?? { value: 11, max: 11, temp: 0 },
        ac: { value: overrides.ac ?? 13 },
        death: overrides.death ?? { success: 0, failure: 0 },
      },
    },
  };
}

function makeToken(id: string, actor: any, extra: Record<string, any> = {}) {
  return {
    id,
    name: actor.name,
    actorId: actor.id,
    actor,
    hidden: extra.hidden ?? false,
    disposition: extra.disposition ?? -1,
    x: 100,
    y: 200,
  };
}

interface MockCombat {
  id: string;
  scene: any;
  active: boolean;
  round: number;
  turn: number | null;
  combatants: ReturnType<typeof makeCollection<any>>;
  turns: any[];
  readonly started: boolean;
  readonly combatant: any;
  readonly nextCombatant: any;
  createEmbeddedDocuments: ReturnType<typeof vi.fn>;
  rollAll: ReturnType<typeof vi.fn>;
  startCombat: ReturnType<typeof vi.fn>;
  nextTurn: ReturnType<typeof vi.fn>;
  previousTurn: ReturnType<typeof vi.fn>;
  nextRound: ReturnType<typeof vi.fn>;
  previousRound: ReturnType<typeof vi.fn>;
  endCombat: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function setupFoundry(options: { tokens?: any[]; scenes?: number; current?: boolean } = {}) {
  const wolf = makeActor('wolf-actor', 'Wolf', { statuses: ['prone'] });
  const charlie = makeActor('charlie-actor', 'Charlie', {
    type: 'character',
    hp: { value: 0, max: 12, temp: 3 },
    ac: 15,
    death: { success: 1, failure: 2 },
  });
  const tokens = options.tokens ?? [
    makeToken('wolf-token', wolf),
    makeToken('charlie-token', charlie, { disposition: 1 }),
  ];
  const scene = { id: 'scene-1', name: 'Cragmaw Hideout', tokens: makeCollection(tokens) };
  const otherScene = { id: 'scene-2', name: 'Elsewhere', tokens: makeCollection([]) };
  const sceneList = makeCollection([scene, otherScene]);
  const scenes = Object.assign(sceneList, {
    current: options.current ? scene : null,
    active: scene,
  });

  const combatList: MockCombat[] = [];
  const combats = Object.assign(combatList, {
    get: (id: string) => combatList.find(c => c.id === id),
  });

  let nextId = 1;
  const makeCombat = (data: { scene?: string; active?: boolean }): MockCombat => {
    const combat: MockCombat = {
      id: `combat-${nextId++}`,
      scene: data.scene ? sceneList.get(data.scene) : null,
      active: !!data.active,
      round: 0,
      turn: null,
      combatants: makeCollection<any>([]),
      turns: [],
      get started() {
        return this.round > 0;
      },
      get combatant() {
        return this.turn === null ? null : this.turns[this.turn];
      },
      get nextCombatant() {
        return this.turns[((this.turn ?? -1) + 1) % this.turns.length] ?? null;
      },
      createEmbeddedDocuments: vi.fn(async (_name: string, rows: any[]) => {
        const created = rows.map((row, i) => {
          const token = scene.tokens.get(row.tokenId);
          return {
            id: `cmb-${i}`,
            name: token?.name,
            ...row,
            initiative: null,
            defeated: false,
            isNPC: token?.actor?.type !== 'character',
            token,
            actor: token?.actor,
            get isDefeated() {
              return this.defeated;
            },
          };
        });
        combat.combatants.push(...created);
        combat.turns = [...combat.combatants];
        return created;
      }),
      rollAll: vi.fn(async () => {
        // Highest initiative first, like Combat#setupTurns
        combat.combatants.forEach((c: any, i: number) => (c.initiative = 10 + i));
        combat.turns = [...combat.combatants].sort((a, b) => b.initiative - a.initiative);
        return combat;
      }),
      startCombat: vi.fn(async () => {
        combat.round = 1;
        combat.turn = 0;
        return combat;
      }),
      nextTurn: vi.fn(async () => {
        combat.turn = (combat.turn ?? 0) + 1;
        return combat;
      }),
      previousTurn: vi.fn(async () => combat),
      nextRound: vi.fn(async () => {
        combat.round += 1;
        combat.turn = 0;
        return combat;
      }),
      previousRound: vi.fn(async () => combat),
      endCombat: vi.fn(),
      delete: vi.fn(async () => {
        const index = combatList.indexOf(combat);
        if (index >= 0) combatList.splice(index, 1);
        return combat;
      }),
    };
    return combat;
  };

  const create = vi.fn(async (data: any) => {
    const combat = makeCombat(data);
    combatList.push(combat);
    return combat;
  });

  vi.stubGlobal('Hooks', { on: vi.fn() });
  vi.stubGlobal('game', {
    ready: true,
    world: { id: 'world-1' },
    user: { id: 'gm', name: 'GM', isGM: true },
    settings: { get: vi.fn(() => true) },
    scenes,
    combats,
  });
  vi.stubGlobal('foundry', {
    utils: { getDocumentClass: vi.fn(() => ({ create })) },
  });

  return { dataAccess: new FoundryDataAccess(), scene, combats, create, makeCombat };
}

describe('FoundryDataAccess combat', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('startCombat', () => {
    it('creates a scene-linked combat with every token, rolls initiative and starts', async () => {
      const { dataAccess, create, combats } = setupFoundry();

      const result = await dataAccess.startCombat({});

      expect(create).toHaveBeenCalledWith({ scene: 'scene-1', active: true }, { render: false });
      const combat = combats[0];
      expect(combat.createEmbeddedDocuments).toHaveBeenCalledWith('Combatant', [
        { tokenId: 'wolf-token', sceneId: 'scene-1', actorId: 'wolf-actor', hidden: false },
        { tokenId: 'charlie-token', sceneId: 'scene-1', actorId: 'charlie-actor', hidden: false },
      ]);
      expect(combat.rollAll).toHaveBeenCalledOnce();
      expect(combat.startCombat).toHaveBeenCalledOnce();
      expect(combat.rollAll.mock.invocationCallOrder[0]).toBeLessThan(
        combat.startCombat.mock.invocationCallOrder[0]
      );
      expect(result).toMatchObject({
        success: true,
        initiativeRolled: true,
        combatId: combat.id,
        round: 1,
        turn: 0,
        started: true,
        scene: { id: 'scene-1', name: 'Cragmaw Hideout' },
        current: { name: 'Charlie', initiative: 11, isCurrent: true },
        next: { name: 'Wolf' },
      });
      expect(result.combatants.map((c: any) => c.name)).toEqual(['Charlie', 'Wolf']);
    });

    it('adds only the requested tokens and can skip initiative', async () => {
      const { dataAccess, combats } = setupFoundry();

      const result = await dataAccess.startCombat({
        tokenIds: ['wolf-token'],
        rollInitiative: false,
      });

      const combat = combats[0];
      expect(combat.createEmbeddedDocuments.mock.calls[0][1]).toHaveLength(1);
      expect(combat.rollAll).not.toHaveBeenCalled();
      expect(combat.startCombat).toHaveBeenCalledOnce();
      expect(result.initiativeRolled).toBe(false);
    });

    it('refuses when the scene already has a combat', async () => {
      const { dataAccess, combats, makeCombat, create } = setupFoundry();
      combats.push(makeCombat({ scene: 'scene-1' }));

      await expect(dataAccess.startCombat({})).rejects.toThrow(/already has a combat/);
      expect(create).not.toHaveBeenCalled();
      expect(combats).toHaveLength(1);
    });

    it('treats an unlinked combat holding this scene’s combatants as existing', async () => {
      const { dataAccess, combats, makeCombat } = setupFoundry();
      const unlinked = makeCombat({});
      unlinked.combatants.push({ id: 'c', sceneId: 'scene-1' });
      combats.push(unlinked);

      await expect(dataAccess.startCombat({})).rejects.toThrow(/already has a combat/);
    });

    it('ignores combats on other scenes', async () => {
      const { dataAccess, combats, makeCombat } = setupFoundry();
      combats.push(makeCombat({ scene: 'scene-2' }));

      const result = await dataAccess.startCombat({});
      expect(result.success).toBe(true);
      expect(combats).toHaveLength(2);
    });

    it('replaces the existing combat when replace is true', async () => {
      const { dataAccess, combats, makeCombat } = setupFoundry();
      const old = makeCombat({ scene: 'scene-1' });
      combats.push(old);

      const result = await dataAccess.startCombat({ replace: true });

      expect(old.delete).toHaveBeenCalledOnce();
      expect(old.endCombat).not.toHaveBeenCalled();
      expect(result.replacedCombatIds).toEqual([old.id]);
      expect(combats).toHaveLength(1);
      expect(combats[0].id).not.toBe(old.id);
    });

    it('rejects unknown token ids before deleting or creating anything', async () => {
      const { dataAccess, combats, makeCombat, create } = setupFoundry();
      const old = makeCombat({ scene: 'scene-1' });
      combats.push(old);

      await expect(dataAccess.startCombat({ tokenIds: ['nope'], replace: true })).rejects.toThrow(
        /Tokens not found.*nope/
      );
      expect(old.delete).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects a scene with no tokens', async () => {
      const { dataAccess } = setupFoundry({ tokens: [] });
      await expect(dataAccess.startCombat({})).rejects.toThrow(/no tokens/);
    });

    it('deletes the half-built combat if a step fails', async () => {
      const { dataAccess, combats, create } = setupFoundry();
      const failing: any = {
        id: 'combat-x',
        createEmbeddedDocuments: vi.fn(async () => {
          throw new Error('boom');
        }),
        delete: vi.fn(async () => {
          combats.splice(combats.indexOf(failing), 1);
        }),
      };
      create.mockImplementationOnce(async () => {
        combats.push(failing);
        return failing;
      });

      await expect(dataAccess.startCombat({})).rejects.toThrow(/boom/);
      expect(failing.delete).toHaveBeenCalledOnce();
      expect(combats).toHaveLength(0);
    });

    it('uses an explicit sceneId', async () => {
      const { dataAccess } = setupFoundry();
      await expect(dataAccess.startCombat({ sceneId: 'scene-2' })).rejects.toThrow(
        /"Elsewhere" has no tokens/
      );
      await expect(dataAccess.startCombat({ sceneId: 'missing' })).rejects.toThrow(
        /Scene not found/
      );
    });
  });

  describe('advanceCombat', () => {
    async function started() {
      const ctx = setupFoundry();
      await ctx.dataAccess.startCombat({});
      return { ...ctx, combat: ctx.combats[0] };
    }

    it('calls nextTurn by default and returns the new state', async () => {
      const { dataAccess, combat } = await started();

      const result = await dataAccess.advanceCombat({});

      expect(combat.nextTurn).toHaveBeenCalledOnce();
      expect(result).toMatchObject({
        success: true,
        action: 'nextTurn',
        from: { round: 1, turn: 0, combatant: 'Charlie' },
        round: 1,
        turn: 1,
        current: { name: 'Wolf' },
      });
    });

    it.each([
      [{ previous: true }, 'previousTurn'],
      [{ round: true }, 'nextRound'],
      [{ round: true, previous: true }, 'previousRound'],
    ])('maps %o to %s', async (args, method) => {
      const { dataAccess, combat } = await started();
      const result = await dataAccess.advanceCombat(args);
      expect((combat as any)[method]).toHaveBeenCalledOnce();
      expect(result.action).toBe(method);
    });

    it('errors when the scene has no combat', async () => {
      const { dataAccess } = setupFoundry();
      await expect(dataAccess.advanceCombat({})).rejects.toThrow(/No combat found/);
    });

    it('finds the combat by combatId', async () => {
      const { dataAccess, combat } = await started();
      await dataAccess.advanceCombat({ combatId: combat.id });
      expect(combat.nextTurn).toHaveBeenCalledOnce();
      await expect(dataAccess.advanceCombat({ combatId: 'nope' })).rejects.toThrow(
        /Combat not found/
      );
    });
  });

  describe('endCombat', () => {
    it('deletes the combat without calling endCombat (which opens a dialog)', async () => {
      const { dataAccess, combats } = setupFoundry();
      await dataAccess.startCombat({});
      const combat = combats[0];

      const result = await dataAccess.endCombat({});

      expect(combat.delete).toHaveBeenCalledOnce();
      expect(combat.endCombat).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        deleted: true,
        combatId: combat.id,
        scene: { id: 'scene-1', name: 'Cragmaw Hideout' },
        finalRound: 1,
        combatantCount: 2,
      });
      expect(combats).toHaveLength(0);
    });

    it('errors when there is nothing to end', async () => {
      const { dataAccess } = setupFoundry();
      await expect(dataAccess.endCombat({})).rejects.toThrow(/No combat found/);
    });
  });

  describe('getCombatState', () => {
    it('reports inCombat:false when the scene has no combat', async () => {
      const { dataAccess } = setupFoundry();
      expect(await dataAccess.getCombatState({})).toEqual({
        success: true,
        inCombat: false,
        scene: { id: 'scene-1', name: 'Cragmaw Hideout' },
      });
    });

    it('prefers the viewed scene and falls back to the active scene', async () => {
      const { dataAccess, combats, makeCombat } = setupFoundry({ current: false });
      combats.push(makeCombat({ scene: 'scene-1' }));
      const state = await dataAccess.getCombatState({});
      expect(state.inCombat).toBe(true);
    });

    it('serializes each combatant with HP, AC, statuses and disposition', async () => {
      const { dataAccess } = setupFoundry();
      await dataAccess.startCombat({});

      const state = await dataAccess.getCombatState({});

      expect(state.inCombat).toBe(true);
      expect(state.combatants).toEqual([
        {
          turnIndex: 0,
          isCurrent: true,
          combatantId: 'cmb-1',
          name: 'Charlie',
          actorId: 'charlie-actor',
          tokenId: 'charlie-token',
          actorType: 'character',
          isNPC: false,
          initiative: 11,
          hp: { value: 0, max: 12, temp: 3 },
          ac: 15,
          statuses: [],
          defeated: false,
          hidden: false,
          disposition: 1,
          dispositionLabel: 'friendly',
          position: { x: 100, y: 200 },
          deathSaves: { success: 1, failure: 2 },
        },
        {
          turnIndex: 1,
          isCurrent: false,
          combatantId: 'cmb-0',
          name: 'Wolf',
          actorId: 'wolf-actor',
          tokenId: 'wolf-token',
          actorType: 'npc',
          isNPC: true,
          initiative: 10,
          hp: { value: 11, max: 11, temp: 0 },
          ac: 13,
          statuses: ['prone'],
          defeated: false,
          hidden: false,
          disposition: -1,
          dispositionLabel: 'hostile',
          position: { x: 100, y: 200 },
        },
      ]);
    });

    it('prefers a started combat when a scene has several', async () => {
      const { dataAccess, combats, makeCombat } = setupFoundry();
      const idle = makeCombat({ scene: 'scene-1' });
      const running = makeCombat({ scene: 'scene-1' });
      running.round = 2;
      combats.push(idle, running);

      const state = await dataAccess.getCombatState({});
      expect(state.combatId).toBe(running.id);
    });
  });

  it('refuses writes when write operations are disabled', async () => {
    const { dataAccess } = setupFoundry();
    (game as any).settings.get = vi.fn(() => false);
    await expect(dataAccess.startCombat({})).rejects.toThrow(/disabled in module settings/);
    await expect(dataAccess.advanceCombat({})).rejects.toThrow(/disabled in module settings/);
    await expect(dataAccess.endCombat({})).rejects.toThrow(/disabled in module settings/);
  });
});
