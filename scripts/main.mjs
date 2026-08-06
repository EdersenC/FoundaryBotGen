import {MODULE_ID} from "./constants.mjs";
import {NpcGeneratorApp} from "./apps/npc-generator-app.mjs";
import {isFullGamemaster, requireDnd5e, requireFullGamemaster, requireReadyScene} from "./foundry/guards.mjs";
import {registerSettings} from "./settings.mjs";

Hooks.once("init", () => {
  registerSettings();
  Hooks.on("getSceneControlButtons", addGeneratorSceneControl);
});

export async function openNpcGenerator() {
  try {
    requireFullGamemaster();
    requireDnd5e();
    const scene = requireReadyScene();
    const existing = foundry.applications.instances.get(`${MODULE_ID}-generator`);
    if (existing) {
      if (existing.sceneId === scene.id) {
        existing.bringToFront();
        return existing;
      }
      await existing.close();
    }
    return new NpcGeneratorApp({sceneId: scene.id}).render({force: true});
  } catch (error) {
    console.error(`${MODULE_ID} | Cannot open generator`, error);
    ui.notifications.error(error.message);
    return null;
  }
}

function addGeneratorSceneControl(controls) {
  const tokenControls = controls.tokens;
  if (!tokenControls?.tools) return;
  tokenControls.tools.npcbotGenerator = {
    name: "npcbotGenerator",
    title: `${MODULE_ID}.controls.openGenerator`,
    icon: "fa-solid fa-people-group",
    order: Object.keys(tokenControls.tools).length,
    button: true,
    visible: isFullGamemaster() && game.system?.id === "dnd5e",
    onChange: () => void openNpcGenerator(),
  };
}
