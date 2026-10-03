import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface TableControlToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

/**
 * GM table-control tools: pausing the game and posting narration/chat messages.
 * Both require a GM-level connection (enforced by the module's validateGMAccess()).
 */
export class TableControlTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: TableControlToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'TableControlTools' });
  }

  /**
   * Tool definitions for table-control operations
   */
  getToolDefinitions() {
    return [
      {
        name: 'set-paused',
        description:
          'Pause or unpause the game for all connected players. Requires a GM-level connection.',
        inputSchema: {
          type: 'object',
          properties: {
            paused: {
              type: 'boolean',
              description: 'Whether the game should be paused (true) or unpaused (false)',
            },
          },
          required: ['paused'],
        },
      },
      {
        name: 'narrate',
        description:
          'Post a chat message as the GM, e.g. DM narration or an NPC line. With no speaker, ' +
          'the message is posted as "Narrator" rather than the connected GM user. Optionally ' +
          'whisper it to specific players. Requires a GM-level connection.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'Message content (HTML or plain text) to post to chat',
            },
            speaker: {
              type: 'object',
              description:
                'Who the message is spoken as. Omit entirely to speak as "Narrator". ' +
                'At most one of actorId/tokenId is used (tokenId takes precedence); alias ' +
                'overrides the displayed name either way.',
              properties: {
                alias: {
                  type: 'string',
                  description: 'Display name override for the speaker',
                },
                actorId: {
                  type: 'string',
                  description: 'Actor ID to speak as',
                },
                tokenId: {
                  type: 'string',
                  description: 'Token ID (on the current scene) to speak as',
                },
              },
            },
            style: {
              type: 'string',
              description:
                'Chat message style (default: narration, shown as an uncategorized message)',
              enum: ['ooc', 'ic', 'emote', 'narration'],
            },
            whisperTo: {
              type: 'array',
              description:
                'If set, only these users (by name or user id) can see the message, in ' +
                'addition to any GMs',
              items: { type: 'string' },
            },
          },
          required: ['content'],
        },
      },
    ];
  }

  async handleSetPaused(args: any): Promise<any> {
    const schema = z.object({
      paused: z.boolean(),
    });

    const { paused } = schema.parse(args);

    this.logger.info('Setting paused state', { paused });

    try {
      const result = await this.foundryClient.query('foundry-mcp-bridge.set-paused', { paused });

      this.logger.debug('Paused state updated', { paused: result?.paused });

      return {
        success: true,
        paused: result?.paused ?? paused,
      };
    } catch (error) {
      this.logger.error('Failed to set paused state', error);
      throw new Error(
        `Failed to set paused state: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleNarrate(args: any): Promise<any> {
    const schema = z.object({
      content: z.string().min(1),
      speaker: z
        .object({
          alias: z.string().optional(),
          actorId: z.string().optional(),
          tokenId: z.string().optional(),
        })
        .optional(),
      style: z.enum(['ooc', 'ic', 'emote', 'narration']).optional(),
      whisperTo: z.array(z.string()).optional(),
    });

    const { content, speaker, style, whisperTo } = schema.parse(args);

    this.logger.info('Posting narration', { style, hasSpeaker: !!speaker, whisperTo });

    try {
      const result = await this.foundryClient.query('foundry-mcp-bridge.narrate', {
        content,
        speaker,
        style,
        whisperTo,
      });

      this.logger.debug('Narration posted', { messageId: result?.messageId });

      return {
        success: true,
        messageId: result?.messageId,
      };
    } catch (error) {
      this.logger.error('Failed to post narration', error);
      throw new Error(
        `Failed to post narration: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
