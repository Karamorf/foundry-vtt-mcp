import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

interface MockTokenDocument {
  id: string;
  name: string;
}

function createTokenDoc(id: string, name: string): MockTokenDocument {
  return { id, name };
}

function setupFoundry(options: {
  tokens?: MockTokenDocument[];
  current?: boolean;
  active?: boolean;
  deleteEmbeddedDocuments?: ReturnType<typeof vi.fn>;
}) {
  const tokenDocs = options.tokens ?? [];
  const tokens = Object.assign(new Map(tokenDocs.map(t => [t.id, t])), {
    get: (id: string) => tokenDocs.find(t => t.id === id),
  });

  const deleteEmbeddedDocuments =
    options.deleteEmbeddedDocuments ??
    vi.fn().mockImplementation(async (_type: string, ids: string[]) => {
      return ids.map(id => tokenDocs.find(t => t.id === id)).filter(Boolean);
    });

  const scene = {
    id: 'scene-1',
    tokens,
    deleteEmbeddedDocuments,
  };

  const scenes = {
    current: options.current === false ? null : scene,
    active: options.active === false ? null : scene,
  };

  const settingsStore: Record<string, boolean> = {
    allowWriteOperations: true,
  };

  vi.stubGlobal('Hooks', { on: vi.fn() });
  vi.stubGlobal('game', {
    ready: true,
    world: { id: 'world-1' },
    user: { id: 'user-1', name: 'GM', isGM: true },
    system: { id: 'dnd5e' },
    settings: {
      get: (_moduleId: string, key: string) => settingsStore[key],
    },
    scenes,
  });

  return {
    scene,
    deleteEmbeddedDocuments,
    dataAccess: new FoundryDataAccess(),
  };
}

describe('FoundryDataAccess.deleteTokens', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports the deleted token id when a single placed token is removed', async () => {
    const token = createTokenDoc('token-1', 'Goblin');
    const { dataAccess, deleteEmbeddedDocuments } = setupFoundry({ tokens: [token] });

    const result = await dataAccess.deleteTokens({ tokenIds: ['token-1'] });

    expect(deleteEmbeddedDocuments).toHaveBeenCalledWith('Token', ['token-1']);
    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(1);
    expect(result.deletedTokens).toEqual(['token-1']);
    expect(result.failedTokens).toBeUndefined();
  });

  it('does not report a deleted token as failed when delete() would have thrown headlessly', async () => {
    // Regression test: deleteEmbeddedDocuments resolves with the deleted documents
    // directly, so success no longer depends on a per-token delete() call that can
    // throw from a canvas-dependent hook in a headless client.
    const token = createTokenDoc('token-1', 'Goblin');
    const { dataAccess } = setupFoundry({ tokens: [token] });

    const result = await dataAccess.deleteTokens({ tokenIds: ['token-1'] });

    expect(result.deletedCount).toBe(1);
    expect(result.failedTokens).toBeUndefined();
  });

  it('reports ids that are not found on the scene as failed, without deleting anything for them', async () => {
    const token = createTokenDoc('token-1', 'Goblin');
    const { dataAccess, deleteEmbeddedDocuments } = setupFoundry({ tokens: [token] });

    const result = await dataAccess.deleteTokens({ tokenIds: ['token-1', 'missing-token'] });

    expect(deleteEmbeddedDocuments).toHaveBeenCalledWith('Token', ['token-1']);
    expect(result.deletedCount).toBe(1);
    expect(result.deletedTokens).toEqual(['token-1']);
    expect(result.failedTokens).toEqual(['missing-token']);
  });

  it('skips the delete call entirely when no requested ids exist', async () => {
    const { dataAccess, deleteEmbeddedDocuments } = setupFoundry({ tokens: [] });

    const result = await dataAccess.deleteTokens({ tokenIds: ['missing-token'] });

    expect(deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(result.deletedCount).toBe(0);
    expect(result.deletedTokens).toEqual([]);
    expect(result.failedTokens).toEqual(['missing-token']);
  });

  it('falls back to game.scenes.active when game.scenes.current is unavailable (headless)', async () => {
    const token = createTokenDoc('token-1', 'Goblin');
    const { dataAccess, deleteEmbeddedDocuments } = setupFoundry({
      tokens: [token],
      current: false,
    });

    const result = await dataAccess.deleteTokens({ tokenIds: ['token-1'] });

    expect(deleteEmbeddedDocuments).toHaveBeenCalledWith('Token', ['token-1']);
    expect(result.deletedCount).toBe(1);
  });

  it('throws when no scene is active or viewed', async () => {
    const { dataAccess } = setupFoundry({ tokens: [], current: false, active: false });

    await expect(dataAccess.deleteTokens({ tokenIds: ['token-1'] })).rejects.toThrow(
      'Failed to delete tokens'
    );
  });
});
