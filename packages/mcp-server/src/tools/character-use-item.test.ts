import { describe, expect, it, vi } from 'vitest';
import { CharacterTools } from './character.js';

function makeCharacterTools() {
  const query = vi.fn(async () => ({ success: true }));
  const logger: any = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => logger };
  const tools = new CharacterTools({ foundryClient: { query } as any, logger });
  return { tools, query };
}

describe('CharacterTools.handleUseItem', () => {
  it('keeps the GM dialog by default (skipDialogs false)', async () => {
    const { tools, query } = makeCharacterTools();

    await tools.handleUseItem({ actorIdentifier: 'Wolf', itemIdentifier: 'Bite' });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.useItem', {
      actorIdentifier: 'Wolf',
      itemIdentifier: 'Bite',
      targets: undefined,
      options: { consume: true, spellLevel: undefined, activity: undefined, skipDialogs: false },
    });
  });

  it('passes activity, targets and the skipDialogs opt-in through', async () => {
    const { tools, query } = makeCharacterTools();

    await tools.handleUseItem({
      actorIdentifier: 'Wolf',
      itemIdentifier: 'Bite',
      targets: ['Charlie'],
      activity: 'attack',
      skipDialogs: true,
      consume: false,
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.useItem', {
      actorIdentifier: 'Wolf',
      itemIdentifier: 'Bite',
      targets: ['Charlie'],
      options: { consume: false, spellLevel: undefined, activity: 'attack', skipDialogs: true },
    });
  });

  it('accepts the legacy skipDialog alias', async () => {
    const { tools, query } = makeCharacterTools();

    await tools.handleUseItem({
      actorIdentifier: 'Wolf',
      itemIdentifier: 'Bite',
      skipDialog: true,
    });

    expect((query.mock.calls[0] as any)[1].options.skipDialogs).toBe(true);
  });

  it('advertises activity and skipDialogs in the tool schema', () => {
    const { tools } = makeCharacterTools();
    const tool = tools
      .getToolDefinitions()
      .find((definition: any) => definition.name === 'use-item');

    expect(tool?.inputSchema.properties).toHaveProperty('activity');
    expect(tool?.inputSchema.properties).toHaveProperty('skipDialogs');
    expect(tool?.description).toContain('GM-only');
  });
});
