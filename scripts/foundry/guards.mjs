import {MODULE_ID} from "../constants.mjs";

export function isFullGamemaster(user = game.user) {
  return Boolean(user?.hasRole?.(CONST.USER_ROLES.GAMEMASTER, true));
}

export function requireFullGamemaster() {
  if (isFullGamemaster()) return;
  throw new Error(game.i18n.localize(`${MODULE_ID}.errors.gamemasterOnly`));
}

export function requireDnd5e() {
  if (game.system?.id === "dnd5e") return;
  throw new Error(game.i18n.localize(`${MODULE_ID}.errors.dnd5eOnly`));
}

export function requireReadyScene(expectedSceneId = null) {
  const scene = canvas?.ready ? canvas.scene : null;
  if (!scene) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.sceneRequired`));
  if (expectedSceneId && scene.id !== expectedSceneId) {
    throw new Error(game.i18n.localize(`${MODULE_ID}.errors.sceneChanged`));
  }
  return scene;
}

export function requireNpcMutationAccess(expectedSceneId) {
  requireFullGamemaster();
  requireDnd5e();
  const scene = requireReadyScene(expectedSceneId);
  if (!game.user.can("ACTOR_CREATE") || !game.user.can("TOKEN_CREATE")) {
    throw new Error(game.i18n.localize(`${MODULE_ID}.errors.createPermission`));
  }
  if (!scene.canUserModify(game.user, "update")) {
    throw new Error(game.i18n.localize(`${MODULE_ID}.errors.scenePermission`));
  }
  return scene;
}
