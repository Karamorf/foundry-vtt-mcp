import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface EvaluateToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

// Kept under the foundry-connector.ts query transport's hardcoded 10s timeout
// (see `packages/mcp-server/src/foundry-connector.ts`) so a slow script returns our
// own descriptive timeout error instead of the transport's generic "Query timeout".
const MAX_TIMEOUT_MS = 9000;

const evaluateSchema = z.object({
  code: z.string().min(1, 'code is required'),
  timeoutMs: z.number().positive().max(MAX_TIMEOUT_MS).optional(),
});

export class EvaluateTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: EvaluateToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'EvaluateTools' });
  }

  /**
   * Tool definitions for the evaluate escape hatch
   */
  getToolDefinitions() {
    return [
      {
        name: 'evaluate',
        description:
          'ESCAPE HATCH (GM only) - runs caller-supplied JavaScript as the body of an async function ' +
          'inside the live Foundry client, with `game` and the usual client globals (canvas, ui, CONFIG, ' +
          'Hooks, foundry, Actor, Item, Scene, ChatMessage, ...) in scope. Use `return <value>;` to produce ' +
          'a result, which is returned as JSON (undefined becomes null, circular references are replaced ' +
          'with "[Circular Reference]", and very large results are truncated). ' +
          'WARNING: this grants FULL GAMEMASTER POWER over the world - there is no sandboxing beyond the ' +
          'JS engine itself, so the code can create, modify, or delete any document. Prefer a purpose-built ' +
          'tool whenever one exists; reach for this only to prototype or cover a real gap. ' +
          'Disabled by default: a GM must first turn on the world setting "Enable JavaScript Evaluation ' +
          '(DANGEROUS)" (module "Foundry MCP Bridge", setting key `enableEvaluate`) or this tool refuses to run. ' +
          'Errors thrown by the evaluated code come back as a result with `success:false` and the error ' +
          'message/stack, not as a tool-call failure - a tool-call failure means the call itself (e.g. the ' +
          'feature being disabled) was refused.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description:
                'JavaScript source to run as the body of an async function, e.g. "return game.user.name". ' +
                'Has `game` and the usual client globals in scope.',
            },
            timeoutMs: {
              type: 'number',
              description: `Optional timeout in milliseconds for the evaluated code (default/${MAX_TIMEOUT_MS}ms max). Capped because the underlying query transport itself times out at 10000ms.`,
              minimum: 1,
              maximum: MAX_TIMEOUT_MS,
            },
          },
          required: ['code'],
        },
      },
    ];
  }

  async handleEvaluate(args: any): Promise<any> {
    const { code, timeoutMs } = evaluateSchema.parse(args);

    this.logger.warn('Evaluating arbitrary JavaScript in the Foundry client (full GM power)', {
      codeLength: code.length,
      timeoutMs,
    });

    try {
      const result = await this.foundryClient.query('foundry-mcp-bridge.evaluate', {
        code,
        timeoutMs,
      });

      this.logger.debug('Evaluate query completed', { success: result?.success });

      return result;
    } catch (error) {
      this.logger.error('Evaluate query failed', error);
      throw new Error(
        `Failed to evaluate code: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
