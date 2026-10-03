/**
 * delete-tokens result mapping tests.
 *
 * Regression coverage for a bug where the tool reported `deletedCount: 0`
 * even though tokens were actually deleted: the module's bridge query
 * returns `deletedTokens`/`failedTokens`, but the tool used to read
 * `tokenIds`/`errors`, fields the module never sends.
 */

import { describe, it, expect, vi } from 'vitest';
import { TokenManipulationTools } from './token-manipulation.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const query = vi.fn(
    queryImpl ??
      (async () => ({
        success: true,
        deletedCount: 0,
        deletedTokens: [],
        failedTokens: undefined,
      }))
  );
  const logger: any = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => logger };
  const foundryClient: any = { query };
  const tools = new TokenManipulationTools({ foundryClient, logger });
  return { tools, query };
}

describe('delete-tokens result mapping', () => {
  it('reports deletedCount and the deleted id for a single placed token', async () => {
    const { tools, query } = makeTools(async () => ({
      success: true,
      deletedCount: 1,
      deletedTokens: ['token-1'],
      failedTokens: undefined,
    }));

    const result = await tools.handleDeleteTokens({ tokenIds: ['token-1'] });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.delete-tokens', {
      tokenIds: ['token-1'],
    });
    expect(result).toEqual({
      success: true,
      deletedCount: 1,
      deletedTokens: ['token-1'],
      failedTokens: undefined,
    });
  });

  it('passes through failedTokens for ids that were not found', async () => {
    const { tools } = makeTools(async () => ({
      success: true,
      deletedCount: 1,
      deletedTokens: ['token-1'],
      failedTokens: ['missing-token'],
    }));

    const result = await tools.handleDeleteTokens({ tokenIds: ['token-1', 'missing-token'] });

    expect(result.deletedCount).toBe(1);
    expect(result.deletedTokens).toEqual(['token-1']);
    expect(result.failedTokens).toEqual(['missing-token']);
  });

  it('rejects a call with no tokenIds', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleDeleteTokens({ tokenIds: [] })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
