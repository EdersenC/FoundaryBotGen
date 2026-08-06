/**
 * Shared, runtime-independent contract for definition-driven NPC generation.
 *
 * The model owns only names, token labels, and configured narrative values.
 * Application IDs, slot numbers, and persistence metadata remain app-owned.
 */

export const GENERATION_SCHEMA_VERSION = "2";

export const CONTROL_TYPES = Object.freeze(["slider", "text"]);

export const DEFAULT_FIELD_DEFINITIONS = deepFreeze([
  {
    id: "social-role",
    label: "Social Role",
    description: "The NPC's place, status, and practical function in local society.",
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Distinctive physical presentation, clothing, and immediately visible details.",
  },
  {
    id: "personality",
    label: "Personality",
    description: "Temperament, virtues, faults, and how the NPC behaves around others.",
  },
  {
    id: "mannerisms",
    label: "Mannerisms",
    description: "Memorable speech patterns, habits, gestures, and tells for roleplay.",
  },
  {
    id: "background",
    label: "Background",
    description: "A concise personal history grounded in the described region and adventure.",
  },
  {
    id: "family-tree",
    label: "Family Tree",
    description: "Synthetic relatives and their relationships. These people need not exist as Actors.",
  },
  {
    id: "connections",
    label: "Connections",
    description: "Useful relationships, factions, obligations, or tensions involving the rest of the cast.",
  },
  {
    id: "gm-notes",
    label: "GM Notes",
    description: "Secrets, motivations, complications, or hooks intended for the Gamemaster.",
  },
]);

export const DEFAULT_CONTROL_DEFINITIONS = deepFreeze([
  sliderControl("detail", "Detail", "How specific and developed each requested field should be.", 50),
  sliderControl("social-diversity", "Social Diversity", "How varied the cast should be in status, work, outlook, and influence.", 50),
  sliderControl("interconnectedness", "Interconnectedness", "How strongly NPC relationships should link the cast together.", 50),
  sliderControl("family-depth", "Family Depth", "How much attention family history and relatives should receive.", 50),
  sliderControl("eccentricity", "Eccentricity", "How unusual, surprising, or theatrical the cast should feel.", 50),
  sliderControl("danger", "Danger", "How threatening, risky, or conflict-adjacent the cast should be.", 50),
  sliderControl("magic", "Magic", "How present supernatural or magical elements should be.", 50),
  {
    id: "additional-direction",
    label: "Additional Direction",
    description: "Optional free-form guidance applied to the whole generated cast.",
    type: "text",
    value: "",
  },
]);

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const HTML_TAG_PATTERN = /<\/?[A-Za-z][^>]*>/;
const URL_PATTERN = /(?:\b(?:https?|ftp|file):\/\/|\b(?:javascript|vbscript):|\bmailto:\S+|\bdata:[^\s,]*,|\bwww\.|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)/i;
const FOUNDRY_ENRICHER_PATTERN = /@[A-Za-z][A-Za-z0-9]*\[[^\]]*\]|\[\[[\s\S]*?\]\]/;
const FORBIDDEN_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const GENERATION_LIMITS = Object.freeze({
  requestId: 128,
  uuid: 128,
  name: 128,
  regionDescription: 4_000,
  prompt: 8_000,
  existingNames: 500,
  excludedThemes: 100,
  excludedTheme: 240,
  npcs: 12,
  fieldDefinitions: 16,
  controlDefinitions: 16,
  definitionId: 64,
  definitionLabel: 80,
  definitionDescription: 500,
  controlText: 1_000,
  fieldValue: 2_500,
  failureMessage: 500,
  fieldCellsPerBatch: 60,
  shortText: 240,
  mediumText: 1_000,
  longText: 2_500,
});

const LIMITS = GENERATION_LIMITS;

/** A validation failure at one or more contract paths. */
export class ContractValidationError extends TypeError {
  /** @param {{path: string, message: string}[]} issues */
  constructor(issues) {
    const summary = issues
      .map(({ path, message }) => `${path}: ${message}`)
      .join("; ");
    super(`Contract validation failed: ${summary}`);
    this.name = "ContractValidationError";
    this.issues = Object.freeze(
      issues.map((issue) => Object.freeze({ ...issue })),
    );
  }
}

class ValidationContext {
  constructor() {
    this.issues = [];
  }

  add(path, message) {
    this.issues.push({ path, message });
  }

  throwIfInvalid() {
    if (this.issues.length > 0) {
      throw new ContractValidationError(this.issues);
    }
  }
}

/** Validate and normalize a generation request. */
export function validateGenerationRequest(value) {
  const context = new ValidationContext();
  const input = readRecord(context, value, "$", [
    "schemaVersion",
    "requestId",
    "scene",
    "region",
    "prompt",
    "count",
    "fields",
    "controls",
    "constraints",
    "generation",
  ]);
  const schemaVersion = readLiteral(
    context,
    input?.schemaVersion,
    "$.schemaVersion",
    GENERATION_SCHEMA_VERSION,
  );
  const requestId = readIdentifier(
    context,
    input?.requestId,
    "$.requestId",
    LIMITS.requestId,
  );
  const scene = readScene(context, input?.scene);
  const region = readRegion(context, input?.region);
  const prompt = readPlainText(context, input?.prompt, "$.prompt", {
    min: 1,
    max: LIMITS.prompt,
  });
  const count = readInteger(context, input?.count, "$.count", 1, LIMITS.npcs);
  const fields = readFieldDefinitions(context, input?.fields, "$.fields");
  const controls = readControlDefinitions(context, input?.controls, "$.controls");
  const constraints = readConstraints(context, input?.constraints);
  const generation = input && Object.hasOwn(input, "generation")
    ? readGenerationOptions(context, input.generation)
    : undefined;

  context.throwIfInvalid();
  return {
    schemaVersion,
    requestId,
    scene,
    region,
    prompt,
    count,
    fields,
    controls,
    constraints,
    ...(generation === undefined ? {} : { generation }),
  };
}

/** Validate field definitions outside a complete request. */
export function validateFieldDefinitions(value) {
  const context = new ValidationContext();
  const fields = readFieldDefinitions(context, value, "$");
  context.throwIfInvalid();
  return fields;
}

/** Validate control definitions and their current values. */
export function validateControlDefinitions(value) {
  const context = new ValidationContext();
  const controls = readControlDefinitions(context, value, "$");
  context.throwIfInvalid();
  return controls;
}

/** Validate one application-assigned NPC draft against its field snapshot. */
export function validateNpcDraft(value, fieldDefinitions) {
  const context = new ValidationContext();
  const fields = readFieldDefinitions(context, fieldDefinitions, "$.fieldDefinitions");
  const draft = readNpcDraft(context, value, "$", fields);
  context.throwIfInvalid();
  return draft;
}

/** Validate and normalize a completed, possibly partial generation result. */
export function validateGenerationResult(value) {
  const context = new ValidationContext();
  const input = readRecord(context, value, "$", [
    "schemaVersion",
    "requestedCount",
    "fields",
    "controls",
    "npcs",
    "failures",
    "provenance",
  ]);
  const schemaVersion = readLiteral(
    context,
    input?.schemaVersion,
    "$.schemaVersion",
    GENERATION_SCHEMA_VERSION,
  );
  const requestedCount = readInteger(
    context,
    input?.requestedCount,
    "$.requestedCount",
    1,
    LIMITS.npcs,
  );
  const fields = readFieldDefinitions(context, input?.fields, "$.fields");
  const controls = readControlDefinitions(context, input?.controls, "$.controls");
  const npcs = readNpcDraftArray(context, input?.npcs, "$.npcs", fields, requestedCount);
  const failures = readFailureArray(context, input?.failures, "$.failures", requestedCount);
  const provenance = readProvenance(context, input?.provenance);

  assertUniqueField(context, npcs, "id", "$.npcs");
  assertUniqueField(context, npcs, "key", "$.npcs");
  assertUniqueField(context, npcs, "slot", "$.npcs");
  assertUniqueField(context, npcs, "name", "$.npcs");
  assertUniqueField(context, npcs, "tokenLabel", "$.npcs");
  assertUniqueField(context, failures, "slot", "$.failures");
  validateResultCoverage(context, { npcs, failures, requestedCount });
  context.throwIfInvalid();

  return {
    schemaVersion,
    requestedCount,
    fields,
    controls,
    npcs,
    failures,
    provenance,
  };
}

/** JSON Schema for one model-owned NPC candidate. */
export function createModelNpcJsonSchema(fieldDefinitions) {
  const fields = validateFieldDefinitions(fieldDefinitions);
  const fieldProperties = Object.fromEntries(
    fields.map(({ id }) => [id, boundedString(1, LIMITS.fieldValue)]),
  );
  return deepFreeze({
    type: "object",
    additionalProperties: false,
    required: ["name", "tokenLabel", "fields"],
    properties: {
      name: boundedString(1, LIMITS.name),
      tokenLabel: boundedString(1, LIMITS.name),
      fields: {
        type: "object",
        additionalProperties: false,
        required: fields.map(({ id }) => id),
        properties: fieldProperties,
      },
    },
  });
}

/** JSON Schema for one requested cast batch. */
export function createCastModelJsonSchema(fieldDefinitions, count) {
  if (!Number.isInteger(count) || count < 1 || count > LIMITS.npcs) {
    throw new RangeError(`Cast batch count must be between 1 and ${LIMITS.npcs}.`);
  }
  return deepFreeze({
    type: "object",
    additionalProperties: false,
    required: ["npcs"],
    properties: {
      npcs: {
        type: "array",
        minItems: count,
        maxItems: count,
        items: createModelNpcJsonSchema(fieldDefinitions),
      },
    },
  });
}

function readScene(context, value) {
  const input = readRecord(context, value, "$.scene", ["uuid", "name"]);
  return {
    uuid: readIdentifier(context, input?.uuid, "$.scene.uuid", LIMITS.uuid),
    name: readPlainText(context, input?.name, "$.scene.name", {
      min: 1,
      max: LIMITS.name,
      singleLine: true,
    }),
  };
}

function readRegion(context, value) {
  const input = readRecord(context, value, "$.region", [
    "uuid",
    "name",
    "description",
  ]);
  const uuid = input?.uuid === null
    ? null
    : readIdentifier(context, input?.uuid, "$.region.uuid", LIMITS.uuid);
  return {
    uuid,
    name: readPlainText(context, input?.name, "$.region.name", {
      min: uuid === null ? 0 : 1,
      max: LIMITS.name,
      singleLine: true,
    }),
    description: readPlainText(
      context,
      input?.description,
      "$.region.description",
      { min: 0, max: LIMITS.regionDescription },
    ),
  };
}

function readFieldDefinitions(context, value, path) {
  const definitions = readObjectArray(
    context,
    value,
    path,
    { minItems: 1, maxItems: LIMITS.fieldDefinitions },
    (definition, definitionPath) => readDefinition(context, definition, definitionPath),
  );
  assertUniqueField(context, definitions, "id", path);
  assertUniqueField(context, definitions, "label", path);
  return definitions;
}

function readControlDefinitions(context, value, path) {
  const definitions = readObjectArray(
    context,
    value,
    path,
    { minItems: 0, maxItems: LIMITS.controlDefinitions },
    (definition, definitionPath) => readControlDefinition(context, definition, definitionPath),
  );
  assertUniqueField(context, definitions, "id", path);
  assertUniqueField(context, definitions, "label", path);
  return definitions;
}

function readDefinition(context, value, path) {
  const input = readRecord(context, value, path, ["id", "label", "description"]);
  return readDefinitionFields(context, input, path);
}

function readDefinitionFields(context, input, path) {
  return {
    id: readIdentifier(context, input?.id, `${path}.id`, LIMITS.definitionId),
    label: readPlainText(context, input?.label, `${path}.label`, {
      min: 1,
      max: LIMITS.definitionLabel,
      singleLine: true,
    }),
    description: readPlainText(context, input?.description, `${path}.description`, {
      min: 1,
      max: LIMITS.definitionDescription,
    }),
  };
}

function readControlDefinition(context, value, path) {
  const input = readRecord(context, value, path, [
    "id",
    "label",
    "description",
    "type",
    "value",
  ]);
  const base = readDefinitionFields(context, input, path);
  const type = readEnum(context, input?.type, `${path}.type`, CONTROL_TYPES);
  const controlValue = type === "slider"
    ? readInteger(context, input?.value, `${path}.value`, 0, 100)
    : readPlainText(context, input?.value, `${path}.value`, {
      min: 0,
      max: LIMITS.controlText,
    });
  return { ...base, type, value: controlValue };
}

function readConstraints(context, value) {
  const input = readRecord(context, value, "$.constraints", [
    "existingNames",
    "excludedThemes",
  ]);
  return {
    existingNames: readPlainTextArray(
      context,
      input?.existingNames,
      "$.constraints.existingNames",
      {
        maxItems: LIMITS.existingNames,
        itemMax: LIMITS.name,
        singleLine: true,
      },
    ),
    excludedThemes: readPlainTextArray(
      context,
      input?.excludedThemes,
      "$.constraints.excludedThemes",
      {
        maxItems: LIMITS.excludedThemes,
        itemMax: LIMITS.excludedTheme,
        singleLine: true,
      },
    ),
  };
}

function readGenerationOptions(context, value) {
  const input = readRecord(context, value, "$.generation", ["seed"]);
  if (!input || !Object.hasOwn(input, "seed")) return {};
  return {
    seed: readInteger(
      context,
      input.seed,
      "$.generation.seed",
      0,
      2_147_483_647,
    ),
  };
}

function readNpcDraftArray(context, value, path, fields, requestedCount) {
  return readObjectArray(
    context,
    value,
    path,
    { minItems: 1, maxItems: requestedCount },
    (draft, draftPath) => readNpcDraft(context, draft, draftPath, fields),
  );
}

function readNpcDraft(context, value, path, fieldDefinitions) {
  const input = readRecord(context, value, path, [
    "id",
    "key",
    "slot",
    "name",
    "tokenLabel",
    "fields",
  ]);
  const fieldIds = fieldDefinitions.map(({ id }) => id);
  const fieldInput = readRecord(context, input?.fields, `${path}.fields`, fieldIds);
  const fields = Object.fromEntries(
    fieldIds.map((id) => [
      id,
      readPlainText(context, fieldInput?.[id], `${path}.fields.${id}`, {
        min: 1,
        max: LIMITS.fieldValue,
        generatedContent: true,
      }),
    ]),
  );
  return {
    id: readIdentifier(context, input?.id, `${path}.id`, LIMITS.uuid),
    key: readIdentifier(context, input?.key, `${path}.key`, LIMITS.uuid),
    slot: readInteger(context, input?.slot, `${path}.slot`, 1, LIMITS.npcs),
    name: readGeneratedSingleLine(context, input?.name, `${path}.name`, LIMITS.name),
    tokenLabel: readGeneratedSingleLine(
      context,
      input?.tokenLabel,
      `${path}.tokenLabel`,
      LIMITS.name,
    ),
    fields,
  };
}

function readFailureArray(context, value, path, requestedCount) {
  return readObjectArray(
    context,
    value,
    path,
    { minItems: 0, maxItems: requestedCount },
    (failure, failurePath) => {
      const input = readRecord(context, failure, failurePath, ["slot", "code", "message"]);
      return {
        slot: readInteger(context, input?.slot, `${failurePath}.slot`, 1, requestedCount),
        code: readIdentifier(context, input?.code, `${failurePath}.code`, 80),
        message: readPlainText(context, input?.message, `${failurePath}.message`, {
          min: 1,
          max: LIMITS.failureMessage,
          singleLine: true,
        }),
      };
    },
  );
}

function readProvenance(context, value) {
  const input = readRecord(context, value, "$.provenance", [
    "provider",
    "model",
    "promptTemplateVersion",
    "modelDigest",
  ]);
  return {
    provider: readGeneratedSingleLine(context, input?.provider, "$.provenance.provider", LIMITS.shortText),
    model: readGeneratedSingleLine(context, input?.model, "$.provenance.model", LIMITS.shortText),
    promptTemplateVersion: readIdentifier(
      context,
      input?.promptTemplateVersion,
      "$.provenance.promptTemplateVersion",
      64,
    ),
    ...(input && Object.hasOwn(input, "modelDigest")
      ? {
          modelDigest: readIdentifier(
            context,
            input.modelDigest,
            "$.provenance.modelDigest",
            LIMITS.uuid,
          ),
        }
      : {}),
  };
}

function validateResultCoverage(context, { npcs, failures, requestedCount }) {
  if (npcs.length + failures.length !== requestedCount) {
    context.add(
      "$",
      "must account for every requested slot with either an NPC or a failure",
    );
  }
  const completedSlots = new Set(npcs.map(({ slot }) => slot));
  for (const failure of failures) {
    if (completedSlots.has(failure.slot)) {
      context.add("$.failures", `slot ${failure.slot} is both successful and failed`);
    }
    completedSlots.add(failure.slot);
  }
  for (let slot = 1; slot <= requestedCount; slot += 1) {
    if (!completedSlots.has(slot)) {
      context.add("$", `does not account for requested slot ${slot}`);
    }
  }
}

function readRecord(context, value, path, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    context.add(path, "must be an object");
    return null;
  }
  const input = value;
  for (const key of Object.keys(input)) {
    if (!allowedKeys.includes(key)) {
      context.add(`${path}.${key}`, "is not allowed");
    }
  }
  return input;
}

function readPlainText(context, value, path, options) {
  const { min, max, singleLine = false, generatedContent = false } = options;
  if (typeof value !== "string") {
    context.add(path, "must be a string");
    return "";
  }
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    context.add(path, `must contain between ${min} and ${max} characters`);
  }
  if (FORBIDDEN_CONTROL_CHARACTER_PATTERN.test(normalized)) {
    context.add(path, "contains a forbidden control character");
  }
  if (HTML_TAG_PATTERN.test(normalized)) {
    context.add(path, "must be plain text without HTML tags");
  }
  if (singleLine && /[\r\n]/.test(normalized)) {
    context.add(path, "must be a single line");
  }
  if (generatedContent && URL_PATTERN.test(normalized)) {
    context.add(path, "must not contain URLs");
  }
  if (generatedContent && FOUNDRY_ENRICHER_PATTERN.test(normalized)) {
    context.add(path, "must not contain Foundry enrichers, inline rolls, or macros");
  }
  return normalized;
}

function readGeneratedSingleLine(context, value, path, max) {
  return readPlainText(context, value, path, {
    min: 1,
    max,
    singleLine: true,
    generatedContent: true,
  });
}

function readIdentifier(context, value, path, maxLength) {
  const identifier = readPlainText(context, value, path, {
    min: 1,
    max: maxLength,
    singleLine: true,
  });
  if (identifier && !IDENTIFIER_PATTERN.test(identifier)) {
    context.add(
      path,
      "must use only letters, numbers, periods, underscores, colons, or hyphens",
    );
  }
  return identifier;
}

function readLiteral(context, value, path, expected) {
  if (value !== expected) {
    context.add(path, `must equal ${JSON.stringify(expected)}`);
  }
  return expected;
}

function readInteger(context, value, path, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    context.add(path, `must be an integer between ${min} and ${max}`);
    return min;
  }
  return value;
}

function readEnum(context, value, path, allowedValues) {
  if (typeof value !== "string" || !allowedValues.includes(value)) {
    context.add(path, `must be one of: ${allowedValues.join(", ")}`);
    return allowedValues[0];
  }
  return value;
}

function readPlainTextArray(context, value, path, options) {
  const { minItems = 0, maxItems, itemMax, singleLine = false } = options;
  if (!Array.isArray(value)) {
    context.add(path, "must be an array");
    return [];
  }
  if (value.length < minItems || value.length > maxItems) {
    context.add(path, `must contain between ${minItems} and ${maxItems} items`);
  }
  const result = value.map((item, index) =>
    readPlainText(context, item, `${path}[${index}]`, {
      min: 1,
      max: itemMax,
      singleLine,
    }),
  );
  assertUniqueStrings(context, result, path);
  return result;
}

function readObjectArray(context, value, path, { minItems, maxItems }, readItem) {
  if (!Array.isArray(value)) {
    context.add(path, "must be an array");
    return [];
  }
  if (value.length < minItems || value.length > maxItems) {
    context.add(path, `must contain between ${minItems} and ${maxItems} items`);
  }
  return value.map((item, index) => readItem(item, `${path}[${index}]`));
}

function assertUniqueStrings(context, values, path) {
  const seen = new Set();
  values.forEach((value, index) => {
    const key = value.toLocaleLowerCase("en-US");
    if (seen.has(key)) {
      context.add(`${path}[${index}]`, "duplicates an earlier value");
    }
    seen.add(key);
  });
}

function assertUniqueField(context, values, field, path) {
  const seen = new Set();
  values.forEach((value, index) => {
    const candidate = value[field];
    const key = typeof candidate === "string"
      ? candidate.toLocaleLowerCase("en-US")
      : candidate;
    if (seen.has(key)) {
      context.add(`${path}[${index}].${field}`, `duplicates an earlier ${field}`);
    }
    seen.add(key);
  });
}

function sliderControl(id, label, description, value) {
  return { id, label, description, type: "slider", value };
}

function boundedString(minLength, maxLength) {
  return { type: "string", minLength, maxLength };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * @typedef {object} GenerationRequest
 * @property {"2"} schemaVersion
 * @property {string} requestId
 * @property {{uuid: string, name: string}} scene
 * @property {{uuid: string|null, name: string, description: string}} region
 * @property {string} prompt
 * @property {number} count
 * @property {{id:string,label:string,description:string}[]} fields
 * @property {{id:string,label:string,description:string,type:"slider"|"text",value:number|string}[]} controls
 * @property {{existingNames: string[], excludedThemes: string[]}} constraints
 * @property {{seed?: number}=} generation
 */

/**
 * @typedef {object} NpcDraft
 * @property {string} id
 * @property {string} key
 * @property {number} slot
 * @property {string} name
 * @property {string} tokenLabel
 * @property {Record<string,string>} fields
 */
