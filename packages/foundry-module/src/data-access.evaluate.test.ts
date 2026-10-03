import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function setupFoundry(options: { evaluateEnabled: boolean }) {
  const settingsStore: Record<string, any> = {
    enableEvaluate: options.evaluateEnabled,
  };

  vi.stubGlobal('Hooks', { on: vi.fn() });
  vi.stubGlobal('game', {
    ready: true,
    world: { id: 'world-1' },
    user: { id: 'user-1', name: 'claude-mcp', isGM: true },
    system: { id: 'dnd5e' },
    settings: {
      get: (_moduleId: string, key: string) => settingsStore[key],
    },
  });

  return { dataAccess: new FoundryDataAccess() };
}

describe('FoundryDataAccess.evaluateCode', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refuses to run and names the setting when evaluate is disabled', async () => {
    const { dataAccess } = setupFoundry({ evaluateEnabled: false });

    await expect(dataAccess.evaluateCode({ code: 'return 1;' })).rejects.toThrow(/enableEvaluate/);
  });

  it('runs the code with `game` in scope and returns the result when enabled', async () => {
    const { dataAccess } = setupFoundry({ evaluateEnabled: true });

    const result = await dataAccess.evaluateCode({ code: 'return game.user.name;' });

    expect(result).toEqual({ success: true, result: 'claude-mcp', truncated: false });
  });

  it('returns a success:false error result (not a throw) when the code throws', async () => {
    const { dataAccess } = setupFoundry({ evaluateEnabled: true });

    const result: any = await dataAccess.evaluateCode({
      code: "throw new Error('boom');",
    });

    expect(result.success).toBe(false);
    expect(result.error.message).toBe('boom');
    expect(result.error.stack).toEqual(expect.stringContaining('boom'));
  });

  it('serializes an undefined return value as null', async () => {
    const { dataAccess } = setupFoundry({ evaluateEnabled: true });

    const result = await dataAccess.evaluateCode({ code: 'return undefined;' });

    expect(result).toEqual({ success: true, result: null, truncated: false });
  });

  it('replaces circular references instead of throwing', async () => {
    const circular: any = { name: 'self-referential' };
    circular.self = circular;
    vi.stubGlobal('__evaluateTestFixture', circular);
    const { dataAccess } = setupFoundry({ evaluateEnabled: true });

    const result: any = await dataAccess.evaluateCode({
      code: 'return globalThis.__evaluateTestFixture;',
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ name: 'self-referential', self: '[Circular Reference]' });
  });

  it('times out a hung promise instead of hanging forever', async () => {
    const { dataAccess } = setupFoundry({ evaluateEnabled: true });

    const result: any = await dataAccess.evaluateCode({
      code: 'return new Promise(() => {});',
      timeoutMs: 20,
    });

    expect(result.success).toBe(false);
    expect(result.error.message).toMatch(/timed out/);
  });

  it('requires non-empty code', async () => {
    const { dataAccess } = setupFoundry({ evaluateEnabled: true });

    await expect(dataAccess.evaluateCode({ code: '' })).rejects.toThrow(/code is required/);
  });
});
