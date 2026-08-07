import {
  JOB_STATUS,
  MAX_NPC_COUNT,
  MIN_NPC_COUNT,
  MODULE_ID,
  MODULE_TEMPLATE_ROOT,
  POLL_INTERVAL_MS,
} from "../constants.mjs";
import {CompanionClient} from "../companion-client.mjs";
import {
  buildGenerationRequest,
  GENERATION_LIMITS,
  GENERATION_SCHEMA_VERSION,
  validateGenerationResult,
  validateNpcDraft,
} from "../contracts/npc-generation-contract.mjs";
import {
  createControlDefinition,
  createFieldDefinition,
  readControlDefinitions,
  readFieldDefinitions,
  toControlDefinitionContext,
  toFieldDefinitionContext,
} from "../core/generation-definitions.mjs";
import {applyNpcReviewEdits} from "../core/npc-draft.mjs";
import {normalizePlainText} from "../core/text.mjs";
import {
  requireDnd5e,
  requireFullGamemaster,
  requireNpcMutationAccess,
  requireReadyScene,
} from "../foundry/guards.mjs";
import {createNpcActors, placeNpcActors} from "../foundry/npc-persistence.mjs";
import {getCompanionConfiguration, getGenerationDefaults} from "../settings.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

export class NpcGeneratorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-generator`,
    classes: [MODULE_ID, `${MODULE_ID}--generator`],
    tag: "form",
    position: {width: 820, height: 820},
    window: {
      title: `${MODULE_ID}.generator.title`,
      icon: "fa-solid fa-people-group",
      resizable: true,
    },
    actions: {
      queue: this.#onQueue,
      checkConnection: this.#onCheckConnection,
      cancel: this.#onCancel,
      approve: this.#onApprove,
      place: this.#onPlace,
      placeActor: this.#onPlaceActor,
      restart: this.#onRestart,
      addField: this.#onAddField,
      removeField: this.#onRemoveField,
      addControl: this.#onAddControl,
      removeControl: this.#onRemoveControl,
    },
    form: {closeOnSubmit: false},
  };

  static PARTS = {
    body: {template: `${MODULE_TEMPLATE_ROOT}/npc-generator.hbs`},
  };

  #phase = "configure";
  #configuration;
  #jobId = null;
  #snapshot = null;
  #result = null;
  #drafts = [];
  #createdActors = [];
  #placedCount = 0;
  #selectedRegionUuid = null;
  #pollController = null;
  #error = null;
  #sceneId;
  #actionInFlight = false;
  #connection = null;
  #connectionCheckStarted = false;
  #connectionController = null;

  constructor({sceneId, ...options} = {}) {
    super(options);
    if (!sceneId) throw new Error("NpcGeneratorApp requires a Scene ID.");
    this.#sceneId = sceneId;
    const defaults = getGenerationDefaults();
    const companion = getCompanionConfiguration();
    this.#connection = {
      state: "checking",
      endpoint: companion.endpoint,
      message: game.i18n.localize(`${MODULE_ID}.connection.checkingMessage`),
    };
    this.#configuration = {
      regionId: "",
      regionDescription: "",
      prompt: "",
      count: defaults.count,
      fields: structuredClone(defaults.fields),
      controls: structuredClone(defaults.controls),
    };
  }

  get sceneId() {
    return this.#sceneId;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const scene = game.scenes.get(this.#sceneId);
    const regions = scene?.regions?.contents ?? [];
    const progress = normalizeProgress(this.#snapshot?.progress, this.#configuration.count);
    return {
      ...context,
      phase: this.#phase,
      isConfigure: this.#phase === "configure",
      isPolling: this.#phase === "polling",
      isReview: this.#phase === "review",
      isCreated: this.#phase === "created",
      scene: scene ? {id: scene.id, name: scene.name} : null,
      hasRegions: regions.length > 0,
      regions: regions.map((region) => ({
        id: region.id,
        name: region.name,
        selected: region.id === this.#configuration.regionId,
      })),
      configuration: this.#configuration,
      limits: GENERATION_LIMITS,
      countRange: {min: MIN_NPC_COUNT, max: MAX_NPC_COUNT},
      fields: toFieldDefinitionContext(this.#configuration.fields),
      controls: toControlDefinitionContext(this.#configuration.controls),
      canAddField: this.#configuration.fields.length < GENERATION_LIMITS.fieldDefinitions,
      canAddControl: this.#configuration.controls.length < GENERATION_LIMITS.controlDefinitions,
      job: this.#snapshot ? {
        id: this.#snapshot.jobId,
        status: localizeStatus(this.#snapshot.status),
        progress,
        activity: normalizePlainText(this.#snapshot.activity?.message, {maxLength: 500}),
      } : null,
      connection: toConnectionContext(this.#connection),
      diagnostics: toDiagnosticsContext(this.#snapshot),
      drafts: this.#drafts.map((draft, index) =>
        toReviewContext(draft, index, this.#result?.fields ?? [])),
      generationFailures: (this.#result?.failures ?? []).map(toFailureContext),
      hasGenerationFailures: (this.#result?.failures?.length ?? 0) > 0,
      createdActors: this.#createdActors.map((actor) => ({id: actor.id, name: actor.name})),
      placedCount: this.#placedCount,
      error: this.#error,
      isBusy: this.#actionInFlight,
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    bindRangeOutputs(this.element);
    for (const select of this.element.querySelectorAll("select[data-control-type]")) {
      select.addEventListener("change", () => {
        this.#syncConfiguration();
        this.render({force: true});
      });
    }
    if (!this.#connectionCheckStarted && this.#phase === "configure") {
      this.#connectionCheckStarted = true;
      void this.#refreshConnection();
    }
  }

  _onClose(options) {
    const runningJobId = this.#phase === "polling" ? this.#jobId : null;
    this.#pollController?.abort();
    this.#connectionController?.abort();
    if (runningJobId) {
      try {
        void createCompanionClient().cancelGeneration(runningJobId).catch((error) => {
          console.warn(`${MODULE_ID} | Could not cancel the closed generator job`, error);
        });
      } catch (error) {
        console.warn(`${MODULE_ID} | Could not create a client to cancel the closed generator job`, error);
      }
    }
    super._onClose(options);
  }

  static async #onQueue() {
    await this.#runAction(() => this.#queueGeneration());
  }

  static async #onCheckConnection() {
    await this.#refreshConnection();
  }

  static async #onCancel() {
    await this.#runAction(() => this.#cancelGeneration());
  }

  static async #onApprove() {
    await this.#runAction(() => this.#approveDrafts());
  }

  static async #onPlace() {
    await this.#runAction(() => this.#placeCreatedActors());
  }

  static async #onPlaceActor(event, target) {
    await this.#runAction(() => this.#placeCreatedActor(readActionActorId(event, target)));
  }

  static async #onRestart() {
    if (this.#actionInFlight) return;
    this.#pollController?.abort();
    this.#phase = "configure";
    this.#jobId = null;
    this.#snapshot = null;
    this.#result = null;
    this.#drafts = [];
    this.#createdActors = [];
    this.#placedCount = 0;
    this.#error = null;
    this.render({force: true});
  }

  static async #onAddField() {
    if (this.#phase !== "configure") return;
    this.#syncConfiguration();
    if (this.#configuration.fields.length >= GENERATION_LIMITS.fieldDefinitions) return;
    this.#configuration.fields.push(createFieldDefinition(this.#configuration.fields));
    this.render({force: true});
  }

  static async #onRemoveField(event, target) {
    if (this.#phase !== "configure") return;
    this.#syncConfiguration();
    const index = readActionIndex(event, target);
    if (index === null || this.#configuration.fields.length <= 1) return;
    this.#configuration.fields.splice(index, 1);
    this.render({force: true});
  }

  static async #onAddControl() {
    if (this.#phase !== "configure") return;
    this.#syncConfiguration();
    if (this.#configuration.controls.length >= GENERATION_LIMITS.controlDefinitions) return;
    this.#configuration.controls.push(createControlDefinition(this.#configuration.controls));
    this.render({force: true});
  }

  static async #onRemoveControl(event, target) {
    if (this.#phase !== "configure") return;
    this.#syncConfiguration();
    const index = readActionIndex(event, target);
    if (index === null) return;
    this.#configuration.controls.splice(index, 1);
    this.render({force: true});
  }

  async #runAction(action) {
    if (this.#actionInFlight) return;
    this.#actionInFlight = true;
    this.#error = null;
    try {
      await action();
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error(`${MODULE_ID} | Generator action failed`, error);
      this.#error = toErrorContext(error, this.#snapshot);
      this.render({force: true});
    } finally {
      this.#actionInFlight = false;
      if (this.rendered) this.render({force: true});
    }
  }

  async #refreshConnection() {
    this.#connectionController?.abort();
    const controller = new AbortController();
    this.#connectionController = controller;
    const configuration = getCompanionConfiguration();
    this.#connection = {
      state: "checking",
      endpoint: configuration.endpoint,
      message: game.i18n.localize(`${MODULE_ID}.connection.checkingMessage`),
    };
    if (this.rendered) this.render({force: true});
    try {
      const health = await createCompanionClient().health({signal: controller.signal});
      if (controller.signal.aborted) return;
      const provider = health.provider ?? {};
      const schemaCompatible = String(health.schemaVersion ?? "") === GENERATION_SCHEMA_VERSION;
      const ready = health.status === "ok" && provider.status === "ready" && schemaCompatible;
      this.#connection = {
        state: ready ? "ready" : "degraded",
        endpoint: configuration.endpoint,
        model: normalizePlainText(provider.model, {maxLength: 200}),
        providerStatus: normalizePlainText(provider.status, {maxLength: 100}),
        outputFormatMode: normalizePlainText(provider.outputFormatMode, {maxLength: 100}),
        schemaCompatible,
        companionSchemaVersion: String(health.schemaVersion ?? "unknown"),
        queue: {
          active: Math.max(0, Number(health.queue?.active) || 0),
          pending: Math.max(0, Number(health.queue?.pending) || 0),
        },
        message: connectionMessage(health, schemaCompatible),
      };
    } catch (error) {
      if (error?.name === "AbortError") return;
      this.#connection = {
        state: "unreachable",
        endpoint: configuration.endpoint,
        message: normalizePlainText(error?.message, {maxLength: 500})
          || game.i18n.localize(`${MODULE_ID}.connection.unreachableMessage`),
      };
    } finally {
      if (this.#connectionController === controller) this.#connectionController = null;
      if (!controller.signal.aborted && this.rendered) this.render({force: true});
    }
  }

  async #queueGeneration() {
    requireFullGamemaster();
    requireDnd5e();
    if (this.#connection?.schemaCompatible === false) {
      throw new Error(this.#connection.message);
    }
    const scene = requireReadyScene(this.#sceneId);
    this.#syncConfiguration();
    if (!this.#configuration.prompt) {
      throw new Error(game.i18n.localize(`${MODULE_ID}.errors.promptRequired`));
    }

    const region = this.#configuration.regionId
      ? scene.regions.get(this.#configuration.regionId)
      : null;
    this.#selectedRegionUuid = region?.uuid ?? null;
    const request = buildGenerationRequest({
      requestId: foundry.utils.randomID(24),
      scene,
      region: {
        uuid: region?.uuid ?? null,
        name: region?.name ?? scene.name,
        description: this.#configuration.regionDescription,
      },
      prompt: this.#configuration.prompt,
      count: this.#configuration.count,
      fields: this.#configuration.fields,
      controls: this.#configuration.controls,
      existingNames: game.actors.contents.map((actor) => actor.name),
      excludedThemes: [],
    });

    const client = createCompanionClient();
    this.#pollController?.abort();
    this.#pollController = new AbortController();
    const snapshot = await client.queueGeneration(request, {signal: this.#pollController.signal});
    this.#jobId = snapshot.jobId;
    this.#snapshot = snapshot;
    this.#phase = "polling";
    this.render({force: true});
    void this.#pollGeneration(client, snapshot.jobId, this.#pollController.signal);
  }

  async #pollGeneration(client, jobId, signal) {
    try {
      while (!signal.aborted) {
        await abortableDelay(POLL_INTERVAL_MS, signal);
        const snapshot = await client.getGeneration(jobId, {signal});
        if (jobId !== this.#jobId) return;
        this.#snapshot = snapshot;

        if (snapshot.status === JOB_STATUS.succeeded) {
          this.#result = validateGenerationResult(snapshot.result);
          this.#drafts = this.#result.npcs.map((draft) =>
            validateNpcDraft(draft, this.#result.fields));
          this.#phase = "review";
          this.#pollController = null;
          this.render({force: true});
          return;
        }
        if (snapshot.status === JOB_STATUS.failed) {
          throw createCompanionJobError(snapshot.error, snapshot.jobId);
        }
        if (snapshot.status === JOB_STATUS.cancelled) {
          this.#phase = "configure";
          this.#jobId = null;
          this.#pollController = null;
          this.render({force: true});
          return;
        }
        this.render({force: true});
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (jobId !== this.#jobId) return;
      this.#phase = "configure";
      this.#jobId = null;
      this.#pollController = null;
      await this.#runAction(async () => { throw error; });
      void this.#refreshConnection();
    }
  }

  async #cancelGeneration() {
    requireFullGamemaster();
    if (!this.#jobId) return;
    const client = createCompanionClient();
    const snapshot = await client.cancelGeneration(this.#jobId);
    this.#pollController?.abort();
    this.#snapshot = snapshot;
    this.#jobId = null;
    this.#phase = "configure";
    this.render({force: true});
  }

  async #approveDrafts() {
    const scene = requireNpcMutationAccess(this.#sceneId);
    const data = new FormData(this.element);
    const approved = [];
    for (let index = 0; index < this.#drafts.length; index += 1) {
      if (!data.has(`include.${index}`)) continue;
      const fieldValues = Object.fromEntries(
        this.#result.fields.map(({id}) => [
          id,
          data.get(`npcs.${index}.fields.${id}`),
        ]),
      );
      const edited = applyNpcReviewEdits(this.#drafts[index], {
        name: data.get(`npcs.${index}.name`),
        tokenLabel: data.get(`npcs.${index}.tokenLabel`),
        fields: fieldValues,
      }, this.#result.fields);
      approved.push(validateNpcDraft(edited, this.#result.fields));
    }
    if (approved.length === 0) {
      throw new Error(game.i18n.localize(`${MODULE_ID}.errors.noApprovedNpcs`));
    }

    this.#createdActors = await createNpcActors({
      drafts: approved,
      sceneId: scene.id,
      jobId: this.#snapshot?.jobId,
      regionUuid: this.#selectedRegionUuid,
      provenance: this.#result?.provenance,
      fields: this.#result.fields,
      controls: this.#result.controls,
    });
    this.#phase = "created";
    this.render({force: true});
    await this.#placeCreatedActors();
  }

  async #placeCreatedActors() {
    await this.#placeActors(this.#createdActors);
  }

  async #placeCreatedActor(actorId) {
    if (!actorId) return;
    const actor = this.#createdActors.find((candidate) => candidate.id === actorId);
    if (!actor) return;
    await this.#placeActors([actor]);
  }

  async #placeActors(actors) {
    requireNpcMutationAccess(this.#sceneId);
    const placed = await placeNpcActors({
      actors,
      sceneId: this.#sceneId,
    });
    this.#placedCount += placed.length;
    this.render({force: true});
    if (placed.length > 0) {
      ui.notifications.info(game.i18n.format(`${MODULE_ID}.notifications.tokensPlaced`, {
        count: placed.length,
      }));
    }
  }

  #syncConfiguration() {
    if (!this.element) return;
    this.#configuration = readGenerationForm(this.element);
  }
}

function readGenerationForm(form) {
  const data = new FormData(form);
  return {
    regionId: String(data.get("regionId") ?? ""),
    regionDescription: normalizePlainText(data.get("regionDescription"), {
      maxLength: GENERATION_LIMITS.regionDescription,
    }),
    prompt: normalizePlainText(data.get("prompt"), {
      maxLength: GENERATION_LIMITS.prompt,
    }),
    count: Number(data.get("count")),
    fields: readFieldDefinitions(data),
    controls: readControlDefinitions(data),
  };
}

function createCompanionClient() {
  const configuration = getCompanionConfiguration();
  return new CompanionClient({
    ...configuration,
    fetchWithTimeout: foundry.utils.fetchWithTimeout,
  });
}

function toReviewContext(draft, index, fieldDefinitions) {
  return {
    index,
    id: draft.id,
    slot: draft.slot,
    name: draft.name,
    tokenLabel: draft.tokenLabel,
    fields: fieldDefinitions.map((definition) => ({
      ...definition,
      value: draft.fields[definition.id] ?? "",
    })),
  };
}

function toFailureContext(failure) {
  return {
    slot: failure.slot,
    code: normalizePlainText(failure.code, {maxLength: 80}),
    message: normalizePlainText(failure.message, {maxLength: GENERATION_LIMITS.failureMessage}),
  };
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

function readActionActorId(event, target) {
  const value = target?.dataset?.actorId ?? event?.currentTarget?.dataset?.actorId;
  if (typeof value !== "string") return null;
  const actorId = value.trim();
  return actorId || null;
}

function normalizeProgress(progress, fallbackTotal) {
  const completed = Math.max(0, Number(progress?.completed) || 0);
  const total = Math.max(1, Number(progress?.total) || fallbackTotal || 1);
  return {
    completed,
    total,
    percent: Math.min(100, Math.round((completed / total) * 100)),
  };
}

function localizeStatus(status) {
  const key = `${MODULE_ID}.jobStatus.${status}`;
  const localized = game.i18n.localize(key);
  return localized === key ? status : localized;
}

function toConnectionContext(value) {
  const state = new Set(["checking", "ready", "degraded", "unreachable"]).has(value?.state)
    ? value.state
    : "unreachable";
  const icon = {
    checking: "fa-solid fa-spinner fa-spin",
    ready: "fa-solid fa-circle-check",
    degraded: "fa-solid fa-triangle-exclamation",
    unreachable: "fa-solid fa-circle-xmark",
  }[state];
  return {
    ...value,
    state,
    icon,
    label: game.i18n.localize(`${MODULE_ID}.connection.${state}`),
    isChecking: state === "checking",
  };
}

function connectionMessage(health, schemaCompatible) {
  if (!schemaCompatible) {
    return game.i18n.format(`${MODULE_ID}.connection.schemaMismatchMessage`, {
      moduleVersion: GENERATION_SCHEMA_VERSION,
      companionVersion: String(health?.schemaVersion ?? "unknown"),
    });
  }
  const provider = health?.provider ?? {};
  if (provider.status === "ready") {
    const outputMode = provider.outputFormatMode === "json"
      ? game.i18n.localize(`${MODULE_ID}.connection.jsonFallback`)
      : game.i18n.localize(`${MODULE_ID}.connection.jsonSchema`);
    return game.i18n.format(`${MODULE_ID}.connection.readyMessage`, {
      model: normalizePlainText(provider.model, {maxLength: 200}) || "Ollama",
      outputMode,
    });
  }
  if (provider.status === "model-missing") {
    return game.i18n.format(`${MODULE_ID}.connection.modelMissingMessage`, {
      model: normalizePlainText(provider.model, {maxLength: 200}) || "configured model",
    });
  }
  return normalizePlainText(provider.message, {maxLength: 500})
    || game.i18n.localize(`${MODULE_ID}.connection.degradedMessage`);
}

function toDiagnosticsContext(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const events = Array.isArray(snapshot.events) ? snapshot.events.slice(-20) : [];
  return {
    jobId: normalizePlainText(snapshot.jobId, {maxLength: 200}),
    updatedAt: formatEventTime(snapshot.updatedAt),
    expanded: new Set([JOB_STATUS.queued, JOB_STATUS.running, JOB_STATUS.failed]).has(snapshot.status),
    events: events.map((event) => ({
      timestamp: formatEventTime(event?.timestamp),
      level: new Set(["info", "warn", "error"]).has(event?.level) ? event.level : "info",
      code: normalizePlainText(event?.code, {maxLength: 100}),
      message: normalizePlainText(event?.message, {maxLength: 500}),
    })),
  };
}

function formatEventTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit"});
}

function createCompanionJobError(error, jobId) {
  const failure = new Error(
    typeof error === "string"
      ? error
      : typeof error?.message === "string"
        ? error.message
        : game.i18n.localize(`${MODULE_ID}.errors.generationFailed`),
  );
  failure.code = typeof error?.code === "string" ? error.code : "GENERATION_FAILED";
  failure.retryable = Boolean(error?.retryable);
  failure.jobId = jobId;
  return failure;
}

function toErrorContext(error, snapshot) {
  const code = normalizePlainText(error?.code, {maxLength: 100});
  return {
    message: normalizePlainText(error?.message, {maxLength: 1_000})
      || game.i18n.localize(`${MODULE_ID}.errors.unexpected`),
    code,
    retryable: Boolean(error?.retryable),
    jobId: normalizePlainText(error?.jobId ?? snapshot?.jobId, {maxLength: 200}),
    suggestion: errorSuggestion(code),
  };
}

function errorSuggestion(code) {
  const key = {
    OLLAMA_TIMEOUT: "timeoutSuggestion",
    OLLAMA_UNAVAILABLE: "unavailableSuggestion",
    OLLAMA_HTTP_ERROR: "ollamaSuggestion",
    MODEL_OUTPUT_INVALID: "modelOutputSuggestion",
  }[code] ?? "defaultSuggestion";
  return game.i18n.localize(`${MODULE_ID}.errors.${key}`);
}

function abortableDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timeoutId = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timeoutId);
      reject(new DOMException("Aborted", "AbortError"));
    }, {once: true});
  });
}
