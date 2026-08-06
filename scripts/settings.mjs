import {
  DEFAULT_COMPANION_ENDPOINT,
  DEFAULT_NPC_COUNT,
  MAX_NPC_COUNT,
  MIN_NPC_COUNT,
  MODULE_ID,
  SETTINGS,
} from "./constants.mjs";
import {DEFAULT_CONTROLS, normalizeControls} from "./contracts/npc-generation-contract.mjs";
import {NpcBotSettingsApp} from "./apps/npcbot-settings-app.mjs";

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.companionEndpoint, {
    name: `${MODULE_ID}.settings.companionEndpoint.name`,
    hint: `${MODULE_ID}.settings.companionEndpoint.hint`,
    scope: "client",
    config: false,
    type: String,
    default: DEFAULT_COMPANION_ENDPOINT,
  });

  game.settings.register(MODULE_ID, SETTINGS.pairingToken, {
    name: `${MODULE_ID}.settings.pairingToken.name`,
    hint: `${MODULE_ID}.settings.pairingToken.hint`,
    scope: "client",
    config: false,
    type: String,
    default: "",
  });

  game.settings.register(MODULE_ID, SETTINGS.generationDefaults, {
    name: `${MODULE_ID}.settings.generationDefaults.name`,
    hint: `${MODULE_ID}.settings.generationDefaults.hint`,
    scope: "world",
    config: false,
    type: Object,
    default: {
      count: DEFAULT_NPC_COUNT,
      controls: {...DEFAULT_CONTROLS},
    },
  });

  game.settings.registerMenu(MODULE_ID, "configuration", {
    name: `${MODULE_ID}.settings.menu.name`,
    label: `${MODULE_ID}.settings.menu.label`,
    hint: `${MODULE_ID}.settings.menu.hint`,
    icon: "fa-solid fa-robot",
    type: NpcBotSettingsApp,
    restricted: true,
  });
}

export function getCompanionConfiguration() {
  return {
    endpoint: game.settings.get(MODULE_ID, SETTINGS.companionEndpoint),
    pairingToken: game.settings.get(MODULE_ID, SETTINGS.pairingToken),
  };
}

export function getGenerationDefaults() {
  const stored = game.settings.get(MODULE_ID, SETTINGS.generationDefaults);
  return {
    count: clampCount(stored?.count),
    controls: normalizeControls(stored?.controls),
  };
}

export async function setNpcBotSettings({endpoint, pairingToken, count, controls}) {
  await game.settings.set(MODULE_ID, SETTINGS.companionEndpoint, endpoint);
  await game.settings.set(MODULE_ID, SETTINGS.pairingToken, pairingToken);
  await game.settings.set(MODULE_ID, SETTINGS.generationDefaults, {
    count: clampCount(count),
    controls: normalizeControls(controls),
  });
}

function clampCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return DEFAULT_NPC_COUNT;
  return Math.min(MAX_NPC_COUNT, Math.max(MIN_NPC_COUNT, Math.round(count)));
}
