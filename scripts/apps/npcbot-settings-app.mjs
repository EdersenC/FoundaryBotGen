import {
  MAX_NPC_COUNT,
  MIN_NPC_COUNT,
  MODULE_ID,
  MODULE_TEMPLATE_ROOT,
} from "../constants.mjs";
import {GENERATION_LIMITS} from "../contracts/npc-generation-contract.mjs";
import {normalizeEndpoint} from "../companion-client.mjs";
import {
  createControlDefinition,
  createFieldDefinition,
  readControlDefinitions,
  readFieldDefinitions,
  toControlDefinitionContext,
  toFieldDefinitionContext,
} from "../core/generation-definitions.mjs";
import {isFullGamemaster, requireFullGamemaster} from "../foundry/guards.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

export class NpcBotSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #saving = false;
  #draft = null;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-settings`,
    classes: [MODULE_ID, `${MODULE_ID}--settings`],
    tag: "form",
    position: {width: 720, height: 780},
    window: {
      title: `${MODULE_ID}.settings.menu.name`,
      icon: "fa-solid fa-robot",
      resizable: true,
    },
    actions: {
      save: this.#onSave,
      addField: this.#onAddField,
      removeField: this.#onRemoveField,
      addControl: this.#onAddControl,
      removeControl: this.#onRemoveControl,
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
    if (!this.#draft) await this.#initializeDraft();
    return {
      ...context,
      companion: this.#draft.companion,
      count: this.#draft.count,
      countRange: {min: MIN_NPC_COUNT, max: MAX_NPC_COUNT},
      fields: toFieldDefinitionContext(this.#draft.fields),
      controls: toControlDefinitionContext(this.#draft.controls),
      limits: GENERATION_LIMITS,
      canAddField: this.#draft.fields.length < GENERATION_LIMITS.fieldDefinitions,
      canAddControl: this.#draft.controls.length < GENERATION_LIMITS.controlDefinitions,
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    bindRangeOutputs(this.element);
    for (const select of this.element.querySelectorAll("select[data-control-type]")) {
      select.addEventListener("change", () => {
        this.#syncDraft();
        this.render({force: true});
      });
    }
  }

  static async #onAddField() {
    this.#syncDraft();
    if (this.#draft.fields.length >= GENERATION_LIMITS.fieldDefinitions) return;
    this.#draft.fields.push(createFieldDefinition(this.#draft.fields));
    this.render({force: true});
  }

  static async #onRemoveField(event, target) {
    this.#syncDraft();
    const index = readActionIndex(event, target);
    if (index === null || this.#draft.fields.length <= 1) return;
    this.#draft.fields.splice(index, 1);
    this.render({force: true});
  }

  static async #onAddControl() {
    this.#syncDraft();
    if (this.#draft.controls.length >= GENERATION_LIMITS.controlDefinitions) return;
    this.#draft.controls.push(createControlDefinition(this.#draft.controls));
    this.render({force: true});
  }

  static async #onRemoveControl(event, target) {
    this.#syncDraft();
    const index = readActionIndex(event, target);
    if (index === null) return;
    this.#draft.controls.splice(index, 1);
    this.render({force: true});
  }

  static async #onSave() {
    if (this.#saving) return;
    this.#saving = true;
    try {
      requireFullGamemaster();
      this.#syncDraft();
      const endpoint = normalizeEndpoint(this.#draft.companion.endpoint).href.replace(/\/$/, "");
      const pairingToken = String(this.#draft.companion.pairingToken ?? "").trim();
      if (!pairingToken) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.pairingTokenRequired`));
      if (pairingToken.length < 16) {
        throw new Error(game.i18n.localize(`${MODULE_ID}.errors.pairingTokenTooShort`));
      }

      const {setNpcBotSettings} = await import("../settings.mjs");
      await setNpcBotSettings({
        endpoint,
        pairingToken,
        count: this.#draft.count,
        fields: this.#draft.fields,
        controls: this.#draft.controls,
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

  async #initializeDraft() {
    const {getCompanionConfiguration, getGenerationDefaults} = await import("../settings.mjs");
    const defaults = getGenerationDefaults();
    this.#draft = {
      companion: getCompanionConfiguration(),
      count: defaults.count,
      fields: structuredClone(defaults.fields),
      controls: structuredClone(defaults.controls),
    };
  }

  #syncDraft() {
    if (!this.element) return;
    const data = new FormData(this.element);
    this.#draft = {
      companion: {
        endpoint: String(data.get("endpoint") ?? ""),
        pairingToken: String(data.get("pairingToken") ?? ""),
      },
      count: Number(data.get("count")),
      fields: readFieldDefinitions(data),
      controls: readControlDefinitions(data),
    };
  }
}

function bindRangeOutputs(element) {
  for (const input of element.querySelectorAll('input[type="range"]')) {
    input.addEventListener("input", () => {
      const output = input.closest(".npcbot-definition")?.querySelector("output");
      if (output) output.value = input.value;
    });
  }
}

function readActionIndex(event, target) {
  const value = target?.dataset?.index ?? event?.currentTarget?.dataset?.index;
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : null;
}
