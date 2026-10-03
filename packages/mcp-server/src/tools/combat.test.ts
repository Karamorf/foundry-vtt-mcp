import { describe, expect, it, vi } from 'vitest';
import { CombatTools } from './combat.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const query = vi.fn(queryImpl ?? (async () => ({ success: true })));
  const logger: any = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), child: () => logger };
  const foundryClient: any = { query };
  const tools = new CombatTools({ foundryClient, logger });
  return { tools, query };
}

describe('CombatTools', () => {
  it('advertises the four combat tools with GM role in the description', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'start-combat',
      'next-turn',
      'end-combat',
      'get-combat-state',
    ]);
    for (const def of defs) {
      expect(def.description).toContain('requires GM');
      expect(def.inputSchema.type).toBe('object');
    }
  });

  it('start-combat applies defaults', async () => {
    const { tools, query } = makeTools();
    await tools.handleStartCombat({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.start-combat', {
      rollInitiative: true,
      replace: false,
    });
  });

  it('start-combat forwards tokenIds, sceneId and flags', async () => {
    const { tools, query } = makeTools();
    await tools.handleStartCombat({
      tokenIds: ['a', 'b'],
      rollInitiative: false,
      replace: true,
      sceneId: 'scene-1',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.start-combat', {
      tokenIds: ['a', 'b'],
      rollInitiative: false,
      replace: true,
      sceneId: 'scene-1',
    });
  });

  it('start-combat rejects an empty tokenIds array without querying', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleStartCombat({ tokenIds: [] })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('next-turn maps previous/round flags', async () => {
    const { tools, query } = makeTools();
    await tools.handleNextTurn(undefined);
    expect(query).toHaveBeenLastCalledWith('foundry-mcp-bridge.next-turn', {
      previous: false,
      round: false,
    });
    await tools.handleNextTurn({ previous: true, round: true, combatId: 'c1' });
    expect(query).toHaveBeenLastCalledWith('foundry-mcp-bridge.next-turn', {
      previous: true,
      round: true,
      combatId: 'c1',
    });
  });

  it('end-combat and get-combat-state forward scene/combat ids and return the bridge result', async () => {
    const state = { success: true, inCombat: true, round: 2 };
    const { tools, query } = makeTools(async () => state);
    await expect(tools.handleEndCombat({ sceneId: 's' })).resolves.toBe(state);
    expect(query).toHaveBeenLastCalledWith('foundry-mcp-bridge.end-combat', { sceneId: 's' });
    await expect(tools.handleGetCombatState({})).resolves.toBe(state);
    expect(query).toHaveBeenLastCalledWith('foundry-mcp-bridge.get-combat-state', {});
  });

  it('wraps bridge errors', async () => {
    const { tools } = makeTools(async () => {
      throw new Error('no GM');
    });
    await expect(tools.handleNextTurn({})).rejects.toThrow('Failed to advance combat: no GM');
  });
});
