import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface SceneToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class SceneTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: SceneToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'SceneTools' });
  }

  /**
   * Tool definitions for scene operations
   */
  getToolDefinitions() {
    return [
      {
        name: 'get-current-scene',
        description:
          'Get information about the currently active scene, including tokens, layout, and the music binding (playlist + playlistSound)',
        inputSchema: {
          type: 'object',
          properties: {
            includeTokens: {
              type: 'boolean',
              description: 'Whether to include detailed token information (default: true)',
              default: true,
            },
            includeHidden: {
              type: 'boolean',
              description: 'Whether to include hidden tokens and elements (default: false)',
              default: false,
            },
          },
        },
      },
      {
        name: 'get-world-info',
        description: 'Get basic information about the Foundry world and system',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'update-scene-music',
        description:
          'Set or clear the music binding of a scene. Pass playlist and optionally playlist_sound (ids or unique names, null to clear). Writes through the scene document API and syncs live to connected clients.',
        inputSchema: {
          type: 'object',
          properties: {
            scene_identifier: {
              type: 'string',
              description: 'Scene id or exact name',
            },
            playlist: {
              type: ['string', 'null'],
              description: 'Playlist id or unique name, or null to clear',
            },
            playlist_sound: {
              type: ['string', 'null'],
              description: 'PlaylistSound id or unique name within the playlist, or null to clear',
            },
          },
          required: ['scene_identifier'],
        },
      },
      {
        name: 'create-scene',
        description:
          'Create a new scene from an existing background image already under the Foundry Data ' +
          'directory (e.g. one found with list-map-images, or produced by generate-map). ' +
          "Requires GM access. Width/height default to the image's natural pixel size when it " +
          'can be determined headlessly; if it cannot, pass both explicitly. The scene is NOT ' +
          'activated by default (activation pulls connected players to it) and no thumbnail is ' +
          'generated (thumbnail generation needs the canvas, which is disabled headlessly).',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name for the new scene',
            },
            backgroundPath: {
              type: 'string',
              description:
                'Path to the background image under the Foundry Data directory, e.g. ' +
                "'worlds/lostmines/maps/x.webp'",
            },
            width: {
              type: 'number',
              description:
                "Scene width in pixels. Defaults to the background image's natural width if it " +
                'can be determined headlessly; required otherwise.',
            },
            height: {
              type: 'number',
              description:
                "Scene height in pixels. Defaults to the background image's natural height if it " +
                'can be determined headlessly; required otherwise.',
            },
            gridSize: {
              type: 'number',
              description: 'Grid square size in pixels (default: 100)',
            },
            gridDistance: {
              type: 'number',
              description: 'Grid distance per square, in gridUnits (default: 5)',
            },
            gridUnits: {
              type: 'string',
              description: 'Grid distance units (default: "ft")',
            },
            padding: {
              type: 'number',
              description: 'Scene padding as a fraction of scene size (default: 0.25)',
            },
            activate: {
              type: 'boolean',
              description:
                'Whether to activate the scene immediately. Activation pulls connected players ' +
                'to it, so this defaults to false.',
              default: false,
            },
            navigation: {
              type: 'boolean',
              description: 'Whether the scene appears in scene navigation (default: true)',
            },
          },
          required: ['name', 'backgroundPath'],
        },
      },
      {
        name: 'list-map-images',
        description:
          'Browse image files under the Foundry Data directory, to find backgrounds for ' +
          "create-scene. Defaults to the current world's folder. Requires GM access.",
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                "Data-relative directory to browse, e.g. 'worlds/lostmines/maps'. " +
                "Defaults to 'worlds/<current world id>'.",
            },
          },
        },
      },
    ];
  }

  async handleGetCurrentScene(args: any): Promise<any> {
    const schema = z.object({
      includeTokens: z.boolean().default(true),
      includeHidden: z.boolean().default(false),
    });

    const { includeTokens, includeHidden } = schema.parse(args);

    this.logger.info('Getting current scene information', { includeTokens, includeHidden });

    try {
      const sceneData = await this.foundryClient.query('foundry-mcp-bridge.getActiveScene');

      this.logger.debug('Successfully retrieved scene data', {
        sceneId: sceneData.id,
        sceneName: sceneData.name,
        tokenCount: sceneData.tokens?.length || 0,
      });

      return this.formatSceneResponse(sceneData, includeTokens, includeHidden);
    } catch (error) {
      this.logger.error('Failed to get current scene', error);
      throw new Error(
        `Failed to get current scene: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleGetWorldInfo(_args: any): Promise<any> {
    this.logger.info('Getting world information');

    try {
      const worldData = await this.foundryClient.query('foundry-mcp-bridge.getWorldInfo');

      this.logger.debug('Successfully retrieved world data', {
        worldId: worldData.id,
        system: worldData.system,
      });

      return this.formatWorldResponse(worldData);
    } catch (error) {
      this.logger.error('Failed to get world information', error);
      throw new Error(
        `Failed to get world information: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleUpdateSceneMusic(args: any): Promise<any> {
    const schema = z.object({
      scene_identifier: z.string().min(1),
      playlist: z.string().nullable().optional(),
      playlist_sound: z.string().nullable().optional(),
    });
    const parsed = schema.parse(args);

    this.logger.info('Updating scene music', { scene_identifier: parsed.scene_identifier });
    try {
      const result = await this.foundryClient.query(
        'foundry-mcp-bridge.update-scene-music',
        parsed
      );
      this.logger.info('Scene music updated', { scene_identifier: parsed.scene_identifier });
      return { success: true, ...result };
    } catch (error) {
      this.logger.error('Failed to update scene music', error);
      throw new Error(
        `Failed to update scene music: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleCreateScene(args: any): Promise<any> {
    const schema = z.object({
      name: z.string().min(1),
      backgroundPath: z.string().min(1),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      gridSize: z.number().positive().optional(),
      gridDistance: z.number().positive().optional(),
      gridUnits: z.string().optional(),
      padding: z.number().min(0).optional(),
      activate: z.boolean().default(false),
      navigation: z.boolean().optional(),
    });
    const parsed = schema.parse(args);

    this.logger.info('Creating scene', {
      name: parsed.name,
      backgroundPath: parsed.backgroundPath,
    });
    try {
      const result = await this.foundryClient.query('foundry-mcp-bridge.create-scene', parsed);
      this.logger.info('Scene created', { name: parsed.name, sceneId: result?.sceneId });
      return result;
    } catch (error) {
      this.logger.error('Failed to create scene', error);
      throw new Error(
        `Failed to create scene: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleListMapImages(args: any): Promise<any> {
    const schema = z.object({
      path: z.string().optional(),
    });
    const parsed = schema.parse(args ?? {});

    this.logger.info('Listing map images', { path: parsed.path });
    try {
      return await this.foundryClient.query('foundry-mcp-bridge.list-map-images', parsed);
    } catch (error) {
      this.logger.error('Failed to list map images', error);
      throw new Error(
        `Failed to list map images: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private formatSceneResponse(sceneData: any, includeTokens: boolean, includeHidden: boolean): any {
    const response: any = {
      id: sceneData.id,
      name: sceneData.name,
      active: sceneData.active,
      dimensions: {
        width: sceneData.width,
        height: sceneData.height,
        padding: sceneData.padding,
      },
      hasBackground: !!sceneData.background,
      navigation: sceneData.navigation,
      music: sceneData.music || { playlist: null, playlistSound: null },
      elements: {
        walls: sceneData.walls || 0,
        lights: sceneData.lights || 0,
        sounds: sceneData.sounds || 0,
        notes: sceneData.notes?.length || 0,
      },
    };

    if (includeTokens && sceneData.tokens) {
      response.tokens = this.formatTokens(sceneData.tokens, includeHidden);
      response.tokenSummary = this.createTokenSummary(sceneData.tokens, includeHidden);
    }

    if (sceneData.notes && sceneData.notes.length > 0) {
      response.notes = sceneData.notes.map((note: any) => ({
        id: note.id,
        text: this.truncateText(note.text, 100),
        position: { x: note.x, y: note.y },
      }));
    }

    return response;
  }

  private formatTokens(tokens: any[], includeHidden: boolean): any[] {
    return tokens
      .filter(token => includeHidden || !token.hidden)
      .map(token => ({
        id: token.id,
        name: token.name,
        position: {
          x: token.x,
          y: token.y,
        },
        size: {
          width: token.width,
          height: token.height,
        },
        actorId: token.actorId,
        disposition: this.getDispositionName(token.disposition),
        hidden: token.hidden,
        hasImage: !!token.img,
      }));
  }

  private createTokenSummary(tokens: any[], includeHidden: boolean): any {
    const visibleTokens = includeHidden ? tokens : tokens.filter(t => !t.hidden);

    const summary = {
      total: visibleTokens.length,
      byDisposition: {
        friendly: 0,
        neutral: 0,
        hostile: 0,
        unknown: 0,
      },
      hasActors: 0,
      withoutActors: 0,
    };

    visibleTokens.forEach(token => {
      // Count by disposition
      const disposition = this.getDispositionName(token.disposition);
      if (disposition in summary.byDisposition) {
        summary.byDisposition[disposition as keyof typeof summary.byDisposition]++;
      } else {
        summary.byDisposition.unknown++;
      }

      // Count actor association
      if (token.actorId) {
        summary.hasActors++;
      } else {
        summary.withoutActors++;
      }
    });

    return summary;
  }

  private formatWorldResponse(worldData: any): any {
    return {
      id: worldData.id,
      title: worldData.title,
      system: {
        id: worldData.system,
        version: worldData.systemVersion,
      },
      foundry: {
        version: worldData.foundryVersion,
      },
      users: {
        total: worldData.users?.length || 0,
        active: worldData.users?.filter((u: any) => u.active).length || 0,
        gms: worldData.users?.filter((u: any) => u.isGM).length || 0,
        players: worldData.users?.filter((u: any) => !u.isGM).length || 0,
      },
      activeUsers:
        worldData.users
          ?.filter((u: any) => u.active)
          .map((u: any) => ({
            id: u.id,
            name: u.name,
            isGM: u.isGM,
          })) || [],
    };
  }

  private getDispositionName(disposition: number): string {
    switch (disposition) {
      case -1:
        return 'hostile';
      case 0:
        return 'neutral';
      case 1:
        return 'friendly';
      default:
        return 'unknown';
    }
  }

  private truncateText(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }
}
