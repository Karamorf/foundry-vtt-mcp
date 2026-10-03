import { describe, expect, it, vi } from 'vitest';
import { TableControlTools } from './table-control.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const query = vi.fn(queryImpl ?? (async () => ({ success: true })));
  const logger: any = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => logger };
  const tools = new TableControlTools({ foundryClient: { query } as any, logger });
  return { tools, query };
}

describe('TableControlTools.handleSetPaused', () => {
  it('sends the paused flag to the bridge and returns the resulting state', async () => {
    const { tools, query } = makeTools(async () => ({ success: true, paused: true }));

    const result = await tools.handleSetPaused({ paused: true });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.set-paused', { paused: true });
    expect(result).toEqual({ success: true, paused: true });
  });

  it('rejects non-boolean paused values', async () => {
    const { tools } = makeTools();

    await expect(tools.handleSetPaused({ paused: 'yes' })).rejects.toThrow();
  });
});

describe('TableControlTools.handleNarrate', () => {
  it('maps args through to the bridge query and returns the message id', async () => {
    const { tools, query } = makeTools(async () => ({ success: true, messageId: 'msg-1' }));

    const result = await tools.handleNarrate({
      content: 'The party enters a dark cave.',
      style: 'narration',
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.narrate', {
      content: 'The party enters a dark cave.',
      speaker: undefined,
      style: 'narration',
      whisperTo: undefined,
    });
    expect(result).toEqual({ success: true, messageId: 'msg-1' });
  });

  it('passes speaker and whisperTo through unchanged', async () => {
    const { tools, query } = makeTools(async () => ({ success: true, messageId: 'msg-2' }));

    await tools.handleNarrate({
      content: 'A secret aside',
      speaker: { actorId: 'actor-1' },
      whisperTo: ['Charlie'],
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.narrate', {
      content: 'A secret aside',
      speaker: { actorId: 'actor-1' },
      style: undefined,
      whisperTo: ['Charlie'],
    });
  });

  it('rejects empty content', async () => {
    const { tools } = makeTools();

    await expect(tools.handleNarrate({ content: '' })).rejects.toThrow();
  });
});
