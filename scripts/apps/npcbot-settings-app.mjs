import {
  MAX_NPC_COUNT,
  MIN_NPC_COUNT,
  MODULE_ID,
  MODULE_TEMPLATE_ROOT,
} from "../constants.mjs";
import {createControlDefinitions} from "../contracts/npc-generation-contract.mjs";
import {normalizeEndpoint} from "../companion-client.mjs";
import {humanizeIdentifier} from "../core/text.mjs";
import {isFullGamemaster, requireFullGamemaster} from "../foundry/guards.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

export class NpcBotSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #saving = false;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-settings`,
    classes: [MODULE_ID, `${MODULE_ID}--settings`],
    tag: "form",
    position: {width: 560, height: "auto"},
    window: {
      title: `${MODULE_ID}.settings.menu.name`,
      icon: "fa-solid fa-robot",
      resizable: true,
    },
    actions: {
      save: this.#onSave,
    },
    form: {closeOnSubmit: false},
  };

  static PARTS = {
    body: {template: `${MODULE_TEMPLATE_ROOT}/npcbot-settings.hbs`},
  };

  _canRender(options) {
    if (!isFullGamemaster()) return false;
    return super._canRender(options);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const {getCompanionConfiguration, getGenerationDefaults} = await import("../settings.mjs");
    const companion = getCompanionConfiguration();
    const defaults = getGenerationDefaults();
    return {
      ...context,
      companion,
      count: defaults.count,
      countRange: {min: MIN_NPC_COUNT, max: MAX_NPC_COUNT},
      controls: createControlDefinitions(defaults.controls).map(addControlLabel),
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    for (const input of this.element.querySelectorAll('input[type="range"]')) {
      input.addEventListener("input", () => {
        const output = input.closest("label")?.querySelector("output");
        if (output) output.value = input.value;
      });
    }
  }

  static async #onSave() {
    if (this.#saving) return;
    this.#saving = true;
    try {
      requireFullGamemaster();
      const data = new FormData(this.element);
      const endpoint = normalizeEndpoint(data.get("endpoint")).href.replace(/\/$/, "");
      const pairingToken = String(data.get("pairingToken") ?? "").trim();
      if (!pairingToken) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.pairingTokenRequired`));
      if (pairingToken.length < 16) {
        throw new Error(game.i18n.localize(`${MODULE_ID}.errors.pairingTokenTooShort`));
      }

      const controls = Object.fromEntries(
        createControlDefinitions().map(({key}) => [key, data.get(`controls.${key}`)]),
      );
      const {setNpcBotSettings} = await import("../settings.mjs");
      await setNpcBotSettings({
        endpoint,
        pairingToken,
        count: data.get("count"),
        controls,
      });
      ui.notifications.info(game.i18n.localize(`${MODULE_ID}.notifications.settingsSaved`));
      await this.close();
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to save settings`, error);
      ui.notifications.error(error.message);
    } finally {
      this.#saving = false;
    }
  }
}

function addControlLabel(control) {
  const localizationKey = `${MODULE_ID}.controls.${control.key}`;
  const localized = game.i18n.localize(localizationKey);
  return {
    ...control,
    label: localized === localizationKey ? humanizeIdentifier(control.key) : localized,
  };
}
