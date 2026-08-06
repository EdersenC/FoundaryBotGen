import {MODULE_ID} from "../constants.mjs";
import {createActorSource} from "../core/npc-draft.mjs";
import {normalizeSingleLine} from "../core/text.mjs";
import {requireNpcMutationAccess} from "./guards.mjs";

const FOLDER_SCENE_FLAG = "sceneId";

export async function createNpcActors({drafts, sceneId, jobId, regionUuid, provenance}) {
  const scene = requireNpcMutationAccess(sceneId);
  if (!Array.isArray(drafts) || drafts.length === 0) {
    throw new Error(game.i18n.localize(`${MODULE_ID}.errors.noApprovedNpcs`));
  }

  const folder = await getOrCreateSceneActorFolder(scene);
  const generation = {
    schemaVersion: "1",
    sceneUuid: scene.uuid,
    regionUuid,
    jobId,
    generatedAt: new Date().toISOString(),
    provenance,
  };
  const actorSources = drafts.map((draft) => {
    const source = createActorSource(draft, {
      folderId: folder?.id ?? null,
      generation,
      moduleId: MODULE_ID,
    });
    source.prototypeToken.displayName = CONST.TOKEN_DISPLAY_MODES.HOVER;
    return source;
  });

  const actors = await Actor.implementation.createDocuments(actorSources);
  if (actors.length !== actorSources.length) {
    throw new Error(game.i18n.localize(`${MODULE_ID}.errors.actorCreationIncomplete`));
  }
  return actors;
}

export async function placeNpcActors({actors, sceneId}) {
  const scene = requireNpcMutationAccess(sceneId);
  if (!Array.isArray(actors) || actors.length === 0) {
    throw new Error(game.i18n.localize(`${MODULE_ID}.errors.noCreatedActors`));
  }
  if (typeof canvas.tokens?.placeTokens !== "function") {
    throw new Error(game.i18n.localize(`${MODULE_ID}.errors.interactivePlacementUnavailable`));
  }

  const levelId = canvas.level?.id;
  const tokenData = [];
  for (const actor of actors) {
    const data = levelId ? {level: levelId} : {};
    const token = await actor.getTokenDocument(data, {parent: scene});
    tokenData.push(token.toObject());
  }
  return canvas.tokens.placeTokens(tokenData);
}

async function getOrCreateSceneActorFolder(scene) {
  const existing = game.folders.find((folder) =>
    folder.type === "Actor" && folder.getFlag(MODULE_ID, FOLDER_SCENE_FLAG) === scene.id,
  );
  if (existing) return existing;

  const sceneName = normalizeSingleLine(scene.name, {maxLength: 120});
  try {
    return await Folder.implementation.create({
      name: `NPCBOT — ${sceneName}`,
      type: "Actor",
      flags: {[MODULE_ID]: {[FOLDER_SCENE_FLAG]: scene.id}},
    });
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not create a scene-linked Actor folder`, error);
    ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.notifications.folderSkipped`));
    return null;
  }
}
