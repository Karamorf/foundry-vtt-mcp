/**
 * `evaluate` MCP tool layer tests.
 *
 * The actual code execution happens browser-side (data-access.evaluateCode), so
 * these cover the MCP tool layer: argument validation, forwarding to the bridge
 * query, the timeoutMs cap, and error propagation.
 */

import { describe, it, expect, vi } from 'vitest';
import { EvaluateTools } from './evaluate.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const query = vi.fn(queryImpl ?? (async () => ({ success: true, result: 'claude-mcp' })));
  const logger: any = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => logger,
  };
  const foundryClient: any = { query };
  const tools = new EvaluateTools({ foundryClient, logger });
  return { tools, query };
}

describe('evaluate tool', () => {
  it('advertises the tool with a required code param', () => {
    const { tools } = makeTools();
    const def = tools.getToolDefinitions()[0];
    expect(def.name).toBe('evaluate');
    expect(def.inputSchema.required).toEqual(['code']);
    expect(def.description).toMatch(/GM/);
  });

  it('forwards code and timeoutMs to the bridge evaluate query', async () => {
    const { tools, query } = makeTools();

    const result = await tools.handleEvaluate({
      code: 'return game.user.name;',
      timeoutMs: 5000,
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.evaluate', {
      code: 'return game.user.name;',
      timeoutMs: 5000,
    });
    expect(result).toEqual({ success: true, result: 'claude-mcp' });
  });

  it('defaults timeoutMs to undefined when not provided, leaving the module default to apply', async () => {
    const { tools, query } = makeTools();

    await tools.handleEvaluate({ code: 'return 1;' });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.evaluate', {
      code: 'return 1;',
      timeoutMs: undefined,
    });
  });

  it('rejects empty code before it reaches the bridge', async () => {
    const { tools, query } = makeTools();

    await expect(tools.handleEvaluate({ code: '' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a timeoutMs above the transport-safe cap', async () => {
    const { tools, query } = makeTools();

    await expect(tools.handleEvaluate({ code: 'return 1;', timeoutMs: 60000 })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('wraps a rejected query in a descriptive error (e.g. evaluate disabled)', async () => {
    const { tools } = makeTools(async () => {
      throw new Error(
        'Access denied - feature is disabled: Evaluate JavaScript is disabled in module settings. A GM must enable it first.'
      );
    });

    await expect(tools.handleEvaluate({ code: 'return 1;' })).rejects.toThrow(
      /Failed to evaluate code:.*disabled/
    );
  });

  it('passes through a success:false error result from a throwing script unchanged', async () => {
    const errorResult = {
      success: false,
      error: { message: 'boom', stack: 'Error: boom\n    at <anonymous>' },
    };
    const { tools } = makeTools(async () => errorResult);

    const result = await tools.handleEvaluate({ code: "throw new Error('boom');" });

    expect(result).toEqual(errorResult);
  });
});
