import { z } from 'zod';
import { FoundryClient } from '../../foundry-client.js';
import { Logger } from '../../logger.js';
import { ErrorHandler } from '../../utils/error-handler.js';
import { detectGameSystem, getCachedSystemId } from '../../utils/system-detection.js';

export interface DnD5eActorMechanicsToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Shared schema pieces
// ---------------------------------------------------------------------------

const actorOrTokenSchema = z
  .object({
    actorId: z.string().min(1).optional(),
    tokenId: z.string().min(1).optional(),
  })
  .refine(data => !!data.actorId || !!data.tokenId, {
    message: 'Either actorId or tokenId is required',
  });

export class DnD5eActorMechanicsTools {
  private foundryClient: FoundryClient;
  private logger: Logger;
  private errorHandler: ErrorHandler;

  constructor({ foundryClient, logger }: DnD5eActorMechanicsToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'DnD5eActorMechanicsTools' });
    this.errorHandler = new ErrorHandler(this.logger);
  }

  getToolDefinitions() {
    return [
      {
        name: 'apply-damage',
        description:
          '[D&D 5e only, GM] Apply damage or healing to an actor’s hit points using dnd5e’s ' +
          'own Actor5e#applyDamage pipeline, so resistances, immunities, vulnerabilities and damage ' +
          'thresholds apply exactly as they would from a chat card damage button. Give either actorId ' +
          '(world actor) or tokenId; tokenId is preferred for NPC tokens since an unlinked token has ' +
          'its own HP independent of the prototype actor. Set healing:true to heal instead of damage, ' +
          'or temp:true to grant temporary hit points (amount is the number of temp HP granted, not ' +
          'subject to resistance). Returns HP before/after and the amount actually applied.',
        inputSchema: {
          type: 'object',
          properties: {
            actorId: {
              type: 'string',
              description: 'World actor ID. Either actorId or tokenId is required.',
            },
            tokenId: {
              type: 'string',
              description:
                'Token ID on the current scene. Preferred over actorId for NPC tokens, since it ' +
                'resolves to that token’s own synthetic actor (own HP) rather than the prototype.',
            },
            amount: {
              type: 'number',
              minimum: 0,
              description:
                'Magnitude of damage, healing, or temp HP to apply (always non-negative).',
            },
            type: {
              type: 'string',
              description:
                'dnd5e damage type (e.g. "fire", "slashing", "bludgeoning"). Determines which ' +
                'resistances/immunities/vulnerabilities apply. Ignored when healing or temp is true.',
            },
            healing: {
              type: 'boolean',
              description: 'If true, amount heals the actor instead of damaging it.',
              default: false,
            },
            temp: {
              type: 'boolean',
              description:
                'If true, amount is granted as temporary hit points instead of damage or healing.',
              default: false,
            },
          },
          required: ['amount'],
        },
      },
      {
        name: 'roll-check',
        description:
          '[D&D 5e only, GM] Roll a skill, ability check, saving throw, or tool check on behalf of an ' +
          'actor and post the result to chat immediately, with no configuration dialog (headless-safe). ' +
          'This is the GM rolling for an actor — unlike request-player-rolls, which asks a *player* ' +
          'to click a roll button, this tool performs and resolves the roll itself. Give either actorId ' +
          'or tokenId; tokenId is preferred for NPC tokens. `key` is the dnd5e identifier for the kind of ' +
          'roll: a skill key (e.g. "prc" for Perception, "ste" for Stealth) when kind is "skill", an ' +
          'ability key (e.g. "dex", "wis") when kind is "ability" or "save", or a tool key (e.g. ' +
          '"thief") when kind is "tool". Returns the total, the natural d20 result, success vs. dc ' +
          '(if given), and the chat message id.',
        inputSchema: {
          type: 'object',
          properties: {
            actorId: {
              type: 'string',
              description: 'World actor ID. Either actorId or tokenId is required.',
            },
            tokenId: {
              type: 'string',
              description:
                'Token ID on the current scene. Preferred over actorId for NPC tokens, since it ' +
                'resolves to that token’s own synthetic actor rather than the prototype.',
            },
            kind: {
              type: 'string',
              enum: ['skill', 'ability', 'save', 'tool'],
              description: 'Which kind of d20 check to roll.',
            },
            key: {
              type: 'string',
              description:
                'dnd5e key for the check: a skill key (e.g. "prc", "ste") for kind "skill", an ' +
                'ability key (e.g. "dex", "wis") for kind "ability" or "save", or a tool key ' +
                '(e.g. "thief") for kind "tool".',
            },
            dc: {
              type: 'number',
              description: 'Optional DC to compare the total against.',
            },
            advantage: {
              type: 'boolean',
              description: 'Roll with advantage.',
              default: false,
            },
            disadvantage: {
              type: 'boolean',
              description: 'Roll with disadvantage.',
              default: false,
            },
            bonus: {
              type: 'string',
              description:
                'Optional extra roll formula added to the check (e.g. "+2", "-1", "+1d4").',
            },
          },
          required: ['kind', 'key'],
        },
      },
    ];
  }

  async handleApplyDamage(args: any): Promise<any> {
    const schema = z
      .object({
        actorId: z.string().min(1).optional(),
        tokenId: z.string().min(1).optional(),
        amount: z.number().min(0),
        type: z.string().min(1).optional(),
        healing: z.boolean().default(false),
        temp: z.boolean().default(false),
      })
      .refine(data => !!data.actorId || !!data.tokenId, {
        message: 'Either actorId or tokenId is required',
        path: ['actorId'],
      })
      .refine(data => !(data.healing && data.temp), {
        message: 'healing and temp cannot both be true',
        path: ['healing'],
      });

    const parsed = schema.parse(args);

    this.logger.info('Applying damage/healing', {
      actorId: parsed.actorId,
      tokenId: parsed.tokenId,
      amount: parsed.amount,
      type: parsed.type,
      healing: parsed.healing,
      temp: parsed.temp,
    });

    try {
      const system = await detectGameSystem(this.foundryClient, this.logger);
      if (system !== 'dnd5e') {
        throw new Error(
          `apply-damage requires D&D 5e. Detected system: "${getCachedSystemId() ?? 'unknown'}".`
        );
      }

      const result = await this.foundryClient.query('foundry-mcp-bridge.applyDamage', parsed);

      this.logger.debug('Damage/healing applied', { result });

      return result;
    } catch (error) {
      this.errorHandler.handleToolError(error, 'apply-damage', 'applying damage/healing');
    }
  }

  async handleRollCheck(args: any): Promise<any> {
    const schema = actorOrTokenSchema.and(
      z.object({
        kind: z.enum(['skill', 'ability', 'save', 'tool']),
        key: z.string().min(1),
        dc: z.number().optional(),
        advantage: z.boolean().default(false),
        disadvantage: z.boolean().default(false),
        bonus: z.string().min(1).optional(),
      })
    );

    const parsed = schema.parse(args);

    this.logger.info('Rolling GM check', {
      actorId: parsed.actorId,
      tokenId: parsed.tokenId,
      kind: parsed.kind,
      key: parsed.key,
      dc: parsed.dc,
    });

    try {
      const system = await detectGameSystem(this.foundryClient, this.logger);
      if (system !== 'dnd5e') {
        throw new Error(
          `roll-check requires D&D 5e. Detected system: "${getCachedSystemId() ?? 'unknown'}".`
        );
      }

      const result = await this.foundryClient.query('foundry-mcp-bridge.rollCheck', parsed);

      this.logger.debug('Roll check completed', { result });

      return result;
    } catch (error) {
      this.errorHandler.handleToolError(error, 'roll-check', 'rolling check');
    }
  }
}
