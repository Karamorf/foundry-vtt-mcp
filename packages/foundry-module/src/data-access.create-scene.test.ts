import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function makeScene(id = 'scene-1', name = 'Test Scene') {
  const levelsContents: any[] = [];
  const scene: any = {
    id,
    name,
    levels: { contents: levelsContents },
    createEmbeddedDocuments: vi.fn(async (docType: string, docs: any[]) => {
      if (docType === 'Level') {
        const created = docs.map(d => ({ background: d.background, update: vi.fn() }));
        levelsContents.push(...created);
        return created;
      }
      return [];
    }),
    update: vi.fn(async () => undefined),
    activate: vi.fn(async () => undefined),
  };
  return scene;
}

function setupFoundry(
  options: {
    allowWriteOperations?: boolean;
    isGM?: boolean;
    generation?: number;
    browseResult?: { dirs?: string[]; files?: string[] };
    withImage?: { width: number; height: number } | 'error' | 'missing';
  } = {}
) {
  const scene = makeScene();
  const sceneCreate = vi.fn(async (_data: any) => scene);

  vi.stubGlobal('Hooks', { on: vi.fn() });
  vi.stubGlobal('Scene', { create: sceneCreate });
  vi.stubGlobal('game', {
    ready: true,
    world: { id: 'lostmines' },
    user: { id: 'gm-1', name: 'GM', isGM: options.isGM ?? true },
    release: { generation: options.generation ?? 14 },
    settings: {
      get: vi.fn(() => options.allowWriteOperations ?? true),
    },
  });

  const browse = vi.fn(async () => ({
    dirs: options.browseResult?.dirs ?? [],
    files: options.browseResult?.files ?? [],
  }));
  vi.stubGlobal('foundry', {
    applications: { apps: { FilePicker: { implementation: { browse } } } },
    utils: { getRoute: (p: string) => `/${p}` },
  });

  if (options.withImage === 'missing') {
    vi.stubGlobal('Image', undefined);
  } else if (options.withImage) {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_value: string) {
        queueMicrotask(() => {
          if (options.withImage === 'error') {
            this.onerror?.();
            return;
          }
          const size = options.withImage as { width: number; height: number };
          this.naturalWidth = size.width;
          this.naturalHeight = size.height;
          this.onload?.();
        });
      }
    }
    vi.stubGlobal('Image', FakeImage);
  }

  return { scene, sceneCreate, browse, dataAccess: new FoundryDataAccess() };
}

describe('FoundryDataAccess.createScene', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a scene and sets the background via a Level document on v14', async () => {
    const { scene, sceneCreate, dataAccess } = setupFoundry();

    const result = await dataAccess.createScene({
      name: '[mcp-test] Scene',
      backgroundPath: 'worlds/lostmines/maps/x.webp',
      width: 2000,
      height: 1500,
    });

    expect(sceneCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '[mcp-test] Scene',
        background: { src: 'worlds/lostmines/maps/x.webp' },
        width: 2000,
        height: 1500,
        active: false,
      })
    );
    expect(scene.createEmbeddedDocuments).toHaveBeenCalledWith('Level', [
      { name: 'Base', background: { src: 'worlds/lostmines/maps/x.webp' } },
    ]);
    expect(scene.activate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      sceneId: 'scene-1',
      sceneName: 'Test Scene',
      dimensions: { width: 2000, height: 1500 },
      active: false,
    });
  });

  it('activates the scene only when activate:true is passed', async () => {
    const { scene, dataAccess } = setupFoundry();

    await dataAccess.createScene({
      name: '[mcp-test] Scene',
      backgroundPath: 'worlds/lostmines/maps/x.webp',
      width: 100,
      height: 100,
      activate: true,
    });

    expect(scene.activate).toHaveBeenCalledTimes(1);
  });

  it('defaults width/height to the natural image size when not provided', async () => {
    const { sceneCreate, dataAccess } = setupFoundry({ withImage: { width: 4096, height: 3072 } });

    await dataAccess.createScene({
      name: '[mcp-test] Scene',
      backgroundPath: 'worlds/lostmines/maps/x.webp',
    });

    expect(sceneCreate).toHaveBeenCalledWith(
      expect.objectContaining({ width: 4096, height: 3072 })
    );
  });

  it('throws when dimensions cannot be determined and were not provided', async () => {
    const { dataAccess } = setupFoundry({ withImage: 'missing' });

    await expect(
      dataAccess.createScene({
        name: '[mcp-test] Scene',
        backgroundPath: 'worlds/lostmines/maps/x.webp',
      })
    ).rejects.toThrow(/width and height/);
  });

  it('denies scene creation when write operations are disabled', async () => {
    const { dataAccess } = setupFoundry({ allowWriteOperations: false });

    await expect(
      dataAccess.createScene({
        name: '[mcp-test] Scene',
        backgroundPath: 'worlds/lostmines/maps/x.webp',
        width: 100,
        height: 100,
      })
    ).rejects.toThrow(/Access denied/);
  });
});

describe('FoundryDataAccess.listMapImages', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to the current world folder and filters to image files', async () => {
    const { browse, dataAccess } = setupFoundry({
      browseResult: {
        dirs: ['worlds/lostmines/maps/sub'],
        files: [
          'worlds/lostmines/maps/x.webp',
          'worlds/lostmines/maps/notes.txt',
          'worlds/lostmines/maps/y.png',
        ],
      },
    });

    const result = await dataAccess.listMapImages();

    expect(browse).toHaveBeenCalledWith('data', 'worlds/lostmines');
    expect(result).toEqual({
      path: 'worlds/lostmines',
      dirs: ['worlds/lostmines/maps/sub'],
      files: ['worlds/lostmines/maps/x.webp', 'worlds/lostmines/maps/y.png'],
    });
  });

  it('browses an explicit path when provided', async () => {
    const { browse, dataAccess } = setupFoundry({ browseResult: { files: [] } });

    await dataAccess.listMapImages({ path: 'worlds/lostmines/maps' });

    expect(browse).toHaveBeenCalledWith('data', 'worlds/lostmines/maps');
  });
});
