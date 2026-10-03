import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface CombatToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

const SCENE_ID_DESCRIPTION =
  'Optional scene ID or name. Defaults to the viewed scene, falling back to the active scene.';
const COMBAT_ID_DESCRIPTION =
  'Optional combat ID. Overrides sceneId; use it when a scene has more than one combat.';

/**
 * Combat encounter tools: start, advance, end and inspect a scene's combat.
 *
 * Combats are looked up by scene (never via the "active"/"viewed" combat, which
 * needs a rendered canvas), and none of these operations open a dialog, so they
 * work on an unattended GM client.
 */
export class CombatTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: CombatToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'CombatTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'start-combat',
        description:
          'Start a combat encounter on a scene (requires GM). Creates the combat, adds the given tokens ' +
          '(default: every token on the scene) as combatants, rolls initiative with the game system rules ' +
          '(e.g. D&D 5e Dex modifier) without any dialog, and begins round 1. Refuses if the scene already ' +
          'has a combat unless replace is true. Returns the combat state in turn order.',
        inputSchema: {
          type: 'object',
          properties: {
            tokenIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Token IDs on the scene to add as combatants. Default: all tokens.',
            },
            rollInitiative: {
              type: 'boolean',
              description: 'Roll initiative for all combatants before starting (default: true)',
              default: true,
            },
            replace: {
              type: 'boolean',
              description:
                "Delete the scene's existing combat(s) and start a new one (default: false)",
              default: false,
            },
            sceneId: { type: 'string', description: SCENE_ID_DESCRIPTION },
          },
        },
      },
      {
        name: 'next-turn',
        description:
          "Advance the scene's combat to the next turn (requires GM). Set previous:true to go back a turn, " +
          'round:true to jump to the next round (or the previous round with previous:true). ' +
          'Returns the new combat state.',
        inputSchema: {
          type: 'object',
          properties: {
            previous: {
              type: 'boolean',
              description: 'Go backwards instead of forwards (default: false)',
              default: false,
            },
            round: {
              type: 'boolean',
              description: 'Move a whole round instead of a single turn (default: false)',
              default: false,
            },
            sceneId: { type: 'string', description: SCENE_ID_DESCRIPTION },
            combatId: { type: 'string', description: COMBAT_ID_DESCRIPTION },
          },
        },
      },
      {
        name: 'end-combat',
        description:
          "End the scene's combat encounter by deleting it (requires GM). No confirmation dialog is shown.",
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: { type: 'string', description: SCENE_ID_DESCRIPTION },
            combatId: { type: 'string', description: COMBAT_ID_DESCRIPTION },
          },
        },
      },
      {
        name: 'get-combat-state',
        description:
          "Get the scene's combat state (requires GM): round, turn, whether it has started, the current and " +
          'next combatant, and every combatant in turn order with initiative, HP (value/max/temp), AC, ' +
          'status conditions, defeated, hidden and disposition. Returns inCombat:false if there is no combat.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: { type: 'string', description: SCENE_ID_DESCRIPTION },
            combatId: { type: 'string', description: COMBAT_ID_DESCRIPTION },
          },
        },
      },
    ];
  }

  async handleStartCombat(args: any): Promise<any> {
    const schema = z.object({
      tokenIds: z.array(z.string()).min(1).optional(),
      rollInitiative: z.boolean().optional().default(true),
      replace: z.boolean().optional().default(false),
      sceneId: z.string().optional(),
    });
    const params = schema.parse(args ?? {});

    this.logger.info('Starting combat', params);
    try {
      return await this.foundryClient.query('foundry-mcp-bridge.start-combat', params);
    } catch (error) {
      this.logger.error('Failed to start combat', error);
      throw new Error(
        `Failed to start combat: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleNextTurn(args: any): Promise<any> {
    const schema = z.object({
      previous: z.boolean().optional().default(false),
      round: z.boolean().optional().default(false),
      sceneId: z.string().optional(),
      combatId: z.string().optional(),
    });
    const params = schema.parse(args ?? {});

    this.logger.info('Advancing combat', params);
    try {
      return await this.foundryClient.query('foundry-mcp-bridge.next-turn', params);
    } catch (error) {
      this.logger.error('Failed to advance combat', error);
      throw new Error(
        `Failed to advance combat: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleEndCombat(args: any): Promise<any> {
    const schema = z.object({
      sceneId: z.string().optional(),
      combatId: z.string().optional(),
    });
    const params = schema.parse(args ?? {});

    this.logger.info('Ending combat', params);
    try {
      return await this.foundryClient.query('foundry-mcp-bridge.end-combat', params);
    } catch (error) {
      this.logger.error('Failed to end combat', error);
      throw new Error(
        `Failed to end combat: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleGetCombatState(args: any): Promise<any> {
    const schema = z.object({
      sceneId: z.string().optional(),
      combatId: z.string().optional(),
    });
    const params = schema.parse(args ?? {});

    this.logger.info('Getting combat state', params);
    try {
      return await this.foundryClient.query('foundry-mcp-bridge.get-combat-state', params);
    } catch (error) {
      this.logger.error('Failed to get combat state', error);
      throw new Error(
        `Failed to get combat state: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
