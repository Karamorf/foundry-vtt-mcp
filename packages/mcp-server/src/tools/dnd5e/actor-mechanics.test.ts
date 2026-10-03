import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DnD5eActorMechanicsTools } from './actor-mechanics.js';
import { clearSystemCache } from '../../utils/system-detection.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const defaultImpl = async (method: string) => {
    if (method === 'foundry-mcp-bridge.getWorldInfo') {
      return { system: { id: 'dnd5e' } };
    }
    return { success: true };
  };
  const query = vi.fn(queryImpl ?? defaultImpl);
  const logger: any = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => logger,
  };
  const foundryClient: any = { query };
  const tools = new DnD5eActorMechanicsTools({ foundryClient, logger });
  return { tools, query };
}

describe('DnD5eActorMechanicsTools', () => {
  beforeEach(() => {
    clearSystemCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('advertises apply-damage and roll-check tools', () => {
    const { tools } = makeTools();
    const names = tools.getToolDefinitions().map(t => t.name);
    expect(names).toEqual(['apply-damage', 'roll-check']);
  });

  describe('apply-damage', () => {
    it('forwards valid args to the applyDamage bridge query', async () => {
      const { tools, query } = makeTools();

      const result = await tools.handleApplyDamage({
        tokenId: 'token-1',
        amount: 10,
        type: 'fire',
      });

      expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.applyDamage', {
        tokenId: 'token-1',
        amount: 10,
        type: 'fire',
        healing: false,
        temp: false,
      });
      expect(result).toMatchObject({ success: true });
    });

    it('rejects when neither actorId nor tokenId is given', async () => {
      const { tools, query } = makeTools();

      await expect(tools.handleApplyDamage({ amount: 5 })).rejects.toThrow();
      expect(query).not.toHaveBeenCalledWith('foundry-mcp-bridge.applyDamage', expect.anything());
    });

    it('rejects when both healing and temp are set', async () => {
      const { tools } = makeTools();

      await expect(
        tools.handleApplyDamage({ actorId: 'a1', amount: 5, healing: true, temp: true })
      ).rejects.toThrow();
    });

    it('rejects a negative amount before contacting Foundry', async () => {
      const { tools, query } = makeTools();

      await expect(tools.handleApplyDamage({ actorId: 'a1', amount: -1 })).rejects.toThrow();
      expect(query).not.toHaveBeenCalledWith('foundry-mcp-bridge.applyDamage', expect.anything());
    });

    it('refuses to run against a non-dnd5e system without calling applyDamage', async () => {
      const { tools, query } = makeTools(async (method: string) => {
        if (method === 'foundry-mcp-bridge.getWorldInfo') {
          return { system: { id: 'pf2e' } };
        }
        return { success: true };
      });

      // The error-handler formats all thrown errors into a generic user-facing message
      // (see ErrorHandler.mapFoundryError), so assert on behavior rather than the exact
      // "requires D&D 5e" text: the operation must fail and never reach the bridge.
      await expect(tools.handleApplyDamage({ actorId: 'a1', amount: 5 })).rejects.toThrow();
      expect(query).not.toHaveBeenCalledWith('foundry-mcp-bridge.applyDamage', expect.anything());
    });
  });

  describe('roll-check', () => {
    it('forwards valid args to the rollCheck bridge query', async () => {
      const { tools, query } = makeTools();

      const result = await tools.handleRollCheck({
        actorId: 'actor-1',
        kind: 'skill',
        key: 'prc',
        dc: 15,
        advantage: true,
      });

      expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.rollCheck', {
        actorId: 'actor-1',
        kind: 'skill',
        key: 'prc',
        dc: 15,
        advantage: true,
        disadvantage: false,
      });
      expect(result).toMatchObject({ success: true });
    });

    it('rejects an unknown kind', async () => {
      const { tools } = makeTools();

      await expect(
        tools.handleRollCheck({ actorId: 'a1', kind: 'initiative', key: 'dex' })
      ).rejects.toThrow();
    });

    it('rejects when neither actorId nor tokenId is given', async () => {
      const { tools } = makeTools();

      await expect(tools.handleRollCheck({ kind: 'ability', key: 'dex' })).rejects.toThrow();
    });

    it('refuses to run against a non-dnd5e system without calling rollCheck', async () => {
      const { tools, query } = makeTools(async (method: string) => {
        if (method === 'foundry-mcp-bridge.getWorldInfo') {
          return { system: { id: 'pf2e' } };
        }
        return { success: true };
      });

      await expect(
        tools.handleRollCheck({ actorId: 'a1', kind: 'save', key: 'wis' })
      ).rejects.toThrow();
      expect(query).not.toHaveBeenCalledWith('foundry-mcp-bridge.rollCheck', expect.anything());
    });
  });
});
