/**
 * Shared Scene.create() helper used by both the map-generation job-completion flow
 * (socket-bridge.ts) and the create-scene query (data-access.ts), so the Foundry v14
 * background-persistence quirk is only handled in one place.
 */

/**
 * Create a Scene document and make sure its background image actually persists.
 *
 * The intended background path is read from `sceneData.background?.src` *before*
 * calling `Scene.create()`, because Foundry's Document constructor explicitly owns
 * and may mutate the data object passed to it (its own JSDoc says so), and since
 * `background` isn't a valid top-level Scene field on v14 it gets stripped from
 * `sceneData` in place during schema cleaning. Reading it after create() would
 * always see it as already gone.
 *
 * Foundry v14 removed Scene#background entirely - the background image now lives
 * on a Level document in the Scene's `levels` embedded collection instead (see
 * foundry.documents.Level / LevelData#background). Foundry v13 and earlier still
 * use the flat `background.src` field on the Scene itself, and some Scene.create()
 * calls there silently fail to persist a nested `background` payload, so that path
 * is verified and repaired if needed.
 */
export async function createSceneWithBackground(sceneData: Record<string, any>): Promise<any> {
  const expectedBackgroundSrc = sceneData.background?.src;

  const scene = await (globalThis as any).Scene.create(sceneData);

  if (expectedBackgroundSrc) {
    const foundryGeneration = (globalThis as any).game?.release?.generation ?? 0;
    if (foundryGeneration >= 14) {
      const existingLevel = scene.levels?.contents?.[0];
      if (existingLevel) {
        if (existingLevel.background?.src !== expectedBackgroundSrc) {
          await existingLevel.update({ background: { src: expectedBackgroundSrc } });
        }
      } else {
        await scene.createEmbeddedDocuments('Level', [
          { name: 'Base', background: { src: expectedBackgroundSrc } },
        ]);
      }
    } else if (scene.background?.src !== expectedBackgroundSrc) {
      await scene.update({ background: { src: expectedBackgroundSrc } });
    }
  }

  return scene;
}
