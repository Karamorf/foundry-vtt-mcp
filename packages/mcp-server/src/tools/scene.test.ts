import { describe, expect, it, vi } from 'vitest';
import { SceneTools } from './scene.js';

function makeTools(queryImpl?: (method: string, data?: any) => unknown) {
  const query = vi.fn(queryImpl ?? (async () => ({ success: true })));
  const logger: any = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => logger };
  const tools = new SceneTools({ foundryClient: { query } as any, logger });
  return { tools, query };
}

describe('SceneTools.handleCreateScene', () => {
  it('defaults activate to false and forwards args to the create-scene query', async () => {
    const { tools, query } = makeTools(async () => ({
      success: true,
      sceneId: 'scene-1',
      sceneName: '[mcp-test] Scene',
    }));

    const result = await tools.handleCreateScene({
      name: '[mcp-test] Scene',
      backgroundPath: 'worlds/lostmines/maps/x.webp',
    });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.create-scene',
      expect.objectContaining({
        name: '[mcp-test] Scene',
        backgroundPath: 'worlds/lostmines/maps/x.webp',
        activate: false,
      })
    );
    expect(result).toMatchObject({ success: true, sceneId: 'scene-1' });
  });

  it('passes activate:true through when explicitly requested', async () => {
    const { tools, query } = makeTools();

    await tools.handleCreateScene({
      name: '[mcp-test] Scene',
      backgroundPath: 'worlds/lostmines/maps/x.webp',
      activate: true,
    });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.create-scene',
      expect.objectContaining({ activate: true })
    );
  });

  it('requires name and backgroundPath', async () => {
    const { tools } = makeTools();

    await expect(tools.handleCreateScene({ name: 'Missing path' })).rejects.toThrow();
    await expect(tools.handleCreateScene({ backgroundPath: 'x.webp' })).rejects.toThrow();
  });

  it('wraps query failures with a descriptive message', async () => {
    const { tools } = makeTools(async () => {
      throw new Error('Access denied');
    });

    await expect(
      tools.handleCreateScene({ name: 'Scene', backgroundPath: 'x.webp' })
    ).rejects.toThrow(/Failed to create scene: Access denied/);
  });
});

describe('SceneTools.handleListMapImages', () => {
  it('defaults to no path argument and forwards the result', async () => {
    const { tools, query } = makeTools(async () => ({
      path: 'worlds/lostmines',
      dirs: [],
      files: ['worlds/lostmines/maps/x.webp'],
    }));

    const result = await tools.handleListMapImages({});

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.list-map-images', {});
    expect(result.files).toEqual(['worlds/lostmines/maps/x.webp']);
  });

  it('forwards an explicit path', async () => {
    const { tools, query } = makeTools();

    await tools.handleListMapImages({ path: 'worlds/lostmines/maps' });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.list-map-images', {
      path: 'worlds/lostmines/maps',
    });
  });
});
