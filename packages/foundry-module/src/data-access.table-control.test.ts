import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function setupFoundry(
  options: {
    togglePause?: ReturnType<typeof vi.fn>;
    actors?: Record<string, any>;
    tokens?: Record<string, any>;
    users?: Array<{ id: string; name: string; isGM?: boolean }>;
    getSpeaker?: ReturnType<typeof vi.fn>;
    create?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const togglePause = options.togglePause ?? vi.fn((paused: boolean) => paused);
  const actorsMap = options.actors ?? {};
  const tokensMap = options.tokens ?? {};
  const users = options.users ?? [{ id: 'gm-1', name: 'GM', isGM: true }];

  const actors = {
    get: (id: string) => actorsMap[id],
    find: (predicate: (a: any) => boolean) => Object.values(actorsMap).find(predicate),
  };

  const scene = {
    id: 'scene-1',
    tokens: {
      get: (id: string) => tokensMap[id],
    },
  };

  const scenes = Object.assign([scene], { current: scene, active: scene });

  const usersCollection = Object.assign([...users], {
    get: (id: string) => users.find(u => u.id === id),
    find: (predicate: (u: any) => boolean) => users.find(predicate),
  });

  const settings = { get: vi.fn().mockReturnValue(true) };

  vi.stubGlobal('Hooks', { on: vi.fn() });
  vi.stubGlobal('game', {
    ready: true,
    world: { id: 'world-1' },
    user: { id: 'gm-1', name: 'GM', isGM: true },
    system: { id: 'dnd5e' },
    settings,
    actors,
    scenes,
    users: usersCollection,
    paused: false,
    togglePause,
  });
  vi.stubGlobal('canvas', {});
  vi.stubGlobal('CONST', {
    CHAT_MESSAGE_STYLES: { OTHER: 0, OOC: 1, IC: 2, EMOTE: 3 },
  });
  vi.stubGlobal('ChatMessage', {
    getSpeaker: options.getSpeaker ?? vi.fn((opts: any) => ({ alias: opts?.alias ?? 'Narrator' })),
    create: options.create ?? vi.fn().mockResolvedValue({ id: 'message-1' }),
  });

  return { dataAccess: new FoundryDataAccess(), togglePause, settings };
}

describe('FoundryDataAccess.setPaused', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('calls game.togglePause with broadcast and returns the resulting state', async () => {
    const togglePause = vi.fn().mockReturnValue(true);
    const { dataAccess } = setupFoundry({ togglePause });

    const result = await dataAccess.setPaused(true);

    expect(togglePause).toHaveBeenCalledWith(true, { broadcast: true });
    expect(result).toEqual({ success: true, paused: true });
  });

  it('rejects when the write-operations setting is disabled', async () => {
    const { dataAccess, settings } = setupFoundry();
    settings.get.mockReturnValue(false);

    await expect(dataAccess.setPaused(true)).rejects.toThrow(/Access denied/);
  });
});

describe('FoundryDataAccess.narrate', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('speaks as Narrator by default, not the GM user', async () => {
    const getSpeaker = vi.fn((opts: any) => ({ alias: opts?.alias }));
    const create = vi.fn().mockResolvedValue({ id: 'message-1' });
    const { dataAccess } = setupFoundry({ getSpeaker, create });

    const result = await dataAccess.narrate({ content: 'The door creaks open.' });

    expect(getSpeaker).toHaveBeenCalledWith(expect.objectContaining({ alias: 'Narrator' }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'The door creaks open.', style: 0 })
    );
    expect(result).toEqual({ success: true, messageId: 'message-1' });
  });

  it('speaks as a given actor when actorId is provided', async () => {
    const actor = { id: 'actor-1', name: 'Gundren' };
    const getSpeaker = vi.fn((opts: any) => ({ alias: opts?.actor?.name }));
    const create = vi.fn().mockResolvedValue({ id: 'message-2' });
    const { dataAccess } = setupFoundry({ actors: { 'actor-1': actor }, getSpeaker, create });

    await dataAccess.narrate({
      content: 'Thank you for the rescue!',
      speaker: { actorId: 'actor-1' },
      style: 'ic',
    });

    expect(getSpeaker).toHaveBeenCalledWith(expect.objectContaining({ actor }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ style: 2 }));
  });

  it('throws when the referenced token is not on the current scene', async () => {
    const { dataAccess } = setupFoundry();

    await expect(
      dataAccess.narrate({ content: 'hi', speaker: { tokenId: 'missing-token' } })
    ).rejects.toThrow(/Token missing-token not found/);
  });

  it('resolves whisper targets by user id or name', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'message-3' });
    const { dataAccess } = setupFoundry({
      users: [
        { id: 'gm-1', name: 'GM', isGM: true },
        { id: 'user-2', name: 'Charlie' },
      ],
      create,
    });

    await dataAccess.narrate({
      content: 'A secret message',
      whisperTo: ['Charlie', 'gm-1'],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ whisper: expect.arrayContaining(['user-2', 'gm-1']) })
    );
  });

  it('throws when a whisper target cannot be resolved', async () => {
    const { dataAccess } = setupFoundry();

    await expect(dataAccess.narrate({ content: 'hi', whisperTo: ['nobody-here'] })).rejects.toThrow(
      /Could not resolve whisper target/
    );
  });
});
