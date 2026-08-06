/**
 * Shared, runtime-independent contract for NPC generation.
 *
 * Validation functions return trimmed defensive copies and throw
 * ContractValidationError when the value is outside the contract.
 */

export const GENERATION_SCHEMA_VERSION = "1";

export const DEFAULT_CONTROLS = Object.freeze({
  detail: 50,
  socialDiversity: 50,
  interconnectedness: 50,
  familyDepth: 50,
  eccentricity: 50,
  danger: 50,
  magic: 50,
});

const CONTROL_NAMES = Object.freeze(Object.keys(DEFAULT_CONTROLS));
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
  shortText: 240,
  mediumText: 1_000,
  longText: 2_500,
  traits: 8,
  mannerisms: 8,
  motivations: 8,
  tags: 12,
  tag: 64,
  familyMembers: 16,
  familyRelationships: 24,
});

const LIMITS = GENERATION_LIMITS;

const FAMILY_RELATIONSHIP_TYPES = Object.freeze([
  "parentOf",
  "childOf",
  "siblingOf",
  "spouseOf",
  "partnerOf",
  "guardianOf",
  "wardOf",
  "adoptiveParentOf",
  "adoptiveChildOf",
  "other",
]);

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
    /** @type {{path: string, message: string}[]} */
    this.issues = [];
  }

  /** @param {string} path @param {string} message */
  add(path, message) {
    this.issues.push({ path, message });
  }

  throwIfInvalid() {
    if (this.issues.length > 0) {
      throw new ContractValidationError(this.issues);
    }
  }
}

/**
 * Validate and normalize a generation request.
 *
 * @param {unknown} value
 * @returns {GenerationRequest}
 */
export function validateGenerationRequest(value) {
  const context = new ValidationContext();
  const input = readRecord(context, value, "$", [
    "schemaVersion",
    "requestId",
    "scene",
    "region",
    "prompt",
    "count",
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
  const controls = readControls(context, input?.controls);
  const constraints = readConstraints(context, input?.constraints);
  const generation =
    input && Object.hasOwn(input, "generation")
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
    controls,
    constraints,
    ...(generation === undefined ? {} : { generation }),
  };
}

/**
 * Validate and normalize one application-assigned NPC draft.
 *
 * @param {unknown} value
 * @returns {NpcDraft}
 */
export function validateNpcDraft(value) {
  const context = new ValidationContext();
  const draft = readNpcDraft(context, value, "$", { validateGraph: true });
  context.throwIfInvalid();
  return draft;
}

/**
 * Validate and normalize a completed generation result.
 *
 * @param {unknown} value
 * @returns {GenerationResult}
 */
export function validateGenerationResult(value) {
  const context = new ValidationContext();
  const input = readRecord(context, value, "$", [
    "schemaVersion",
    "npcs",
    "provenance",
  ]);
  const schemaVersion = readLiteral(
    context,
    input?.schemaVersion,
    "$.schemaVersion",
    GENERATION_SCHEMA_VERSION,
  );
  const npcs = readNpcDraftArray(context, input?.npcs, "$.npcs");
  const provenance = readProvenance(context, input?.provenance);

  assertUniqueField(context, npcs, "id", "$.npcs");
  assertUniqueField(context, npcs, "key", "$.npcs");
  assertUniqueField(context, npcs, "name", "$.npcs");
  assertUniqueField(context, npcs, "tokenLabel", "$.npcs");
  context.throwIfInvalid();

  return { schemaVersion, npcs, provenance };
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
  const uuid =
    input?.uuid === null
      ? null
      : readIdentifier(context, input?.uuid, "$.region.uuid", LIMITS.uuid);
  const regionNameMinimum = uuid === null ? 0 : 1;
  return {
    uuid,
    name: readPlainText(context, input?.name, "$.region.name", {
      min: regionNameMinimum,
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

function readControls(context, value) {
  const input = readRecord(context, value, "$.controls", CONTROL_NAMES);
  return Object.fromEntries(
    CONTROL_NAMES.map((name) => [
      name,
      readInteger(context, input?.[name], `$.controls.${name}`, 0, 100),
    ]),
  );
}

function readConstraints(context, value) {
  const input = readRecord(context, value, "$.constraints", [
    "existingNames",
    "excludedThemes",
  ]);
  const existingNames = readPlainTextArray(
    context,
    input?.existingNames,
    "$.constraints.existingNames",
    {
      maxItems: LIMITS.existingNames,
      itemMax: LIMITS.name,
      singleLine: true,
    },
  );
  const excludedThemes = readPlainTextArray(
    context,
    input?.excludedThemes,
    "$.constraints.excludedThemes",
    {
      maxItems: LIMITS.excludedThemes,
      itemMax: LIMITS.excludedTheme,
      singleLine: true,
    },
  );
  return { existingNames, excludedThemes };
}

function readGenerationOptions(context, value) {
  const input = readRecord(context, value, "$.generation", ["seed"]);
  if (!input || !Object.hasOwn(input, "seed")) {
    return {};
  }
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

function readNpcDraftArray(context, value, path) {
  if (!Array.isArray(value)) {
    context.add(path, "must be an array");
    return [];
  }
  if (value.length < 1 || value.length > LIMITS.npcs) {
    context.add(path, `must contain between 1 and ${LIMITS.npcs} NPCs`);
  }
  return value.map((draft, index) =>
    readNpcDraft(context, draft, `${path}[${index}]`, { validateGraph: true }),
  );
}

function readNpcDraft(context, value, path, { validateGraph }) {
  const input = readRecord(context, value, path, [
    "id",
    "key",
    "name",
    "tokenLabel",
    "socialRole",
    "occupation",
    "appearance",
    "personalityTraits",
    "ideal",
    "bond",
    "flaw",
    "mannerisms",
    "motivations",
    "publicBiography",
    "gmSecret",
    "complication",
    "faction",
    "family",
    "tags",
  ]);
  const family = readFamily(context, input?.family, `${path}.family`);
  if (validateGraph) {
    validateFamilyGraph(context, family, `${path}.family`);
  }

  return {
    id: readIdentifier(context, input?.id, `${path}.id`, LIMITS.uuid),
    key: readIdentifier(context, input?.key, `${path}.key`, LIMITS.uuid),
    name: readShortText(context, input?.name, `${path}.name`),
    tokenLabel: readShortText(context, input?.tokenLabel, `${path}.tokenLabel`),
    socialRole: readShortText(context, input?.socialRole, `${path}.socialRole`),
    occupation: readShortText(context, input?.occupation, `${path}.occupation`),
    appearance: readPlainText(context, input?.appearance, `${path}.appearance`, {
      min: 1,
      max: LIMITS.mediumText,
      generatedContent: true,
    }),
    personalityTraits: readPlainTextArray(
      context,
      input?.personalityTraits,
      `${path}.personalityTraits`,
      {
        minItems: 1,
        maxItems: LIMITS.traits,
        itemMax: LIMITS.shortText,
        generatedContent: true,
      },
    ),
    ideal: readShortText(context, input?.ideal, `${path}.ideal`),
    bond: readShortText(context, input?.bond, `${path}.bond`),
    flaw: readShortText(context, input?.flaw, `${path}.flaw`),
    mannerisms: readPlainTextArray(
      context,
      input?.mannerisms,
      `${path}.mannerisms`,
      {
        minItems: 1,
        maxItems: LIMITS.mannerisms,
        itemMax: LIMITS.shortText,
        generatedContent: true,
      },
    ),
    motivations: readPlainTextArray(
      context,
      input?.motivations,
      `${path}.motivations`,
      {
        minItems: 1,
        maxItems: LIMITS.motivations,
        itemMax: LIMITS.shortText,
        generatedContent: true,
      },
    ),
    publicBiography: readPlainText(
      context,
      input?.publicBiography,
      `${path}.publicBiography`,
      { min: 1, max: LIMITS.longText, generatedContent: true },
    ),
    gmSecret: readPlainText(context, input?.gmSecret, `${path}.gmSecret`, {
      min: 0,
      max: LIMITS.longText,
      generatedContent: true,
    }),
    complication: readPlainText(
      context,
      input?.complication,
      `${path}.complication`,
      { min: 0, max: LIMITS.mediumText, generatedContent: true },
    ),
    faction: readPlainText(context, input?.faction, `${path}.faction`, {
      min: 0,
      max: LIMITS.shortText,
      singleLine: true,
      generatedContent: true,
    }),
    family,
    tags: readPlainTextArray(context, input?.tags, `${path}.tags`, {
      maxItems: LIMITS.tags,
      itemMax: LIMITS.tag,
      singleLine: true,
      generatedContent: true,
    }),
  };
}

function readFamily(context, value, path) {
  const input = readRecord(context, value, path, ["members", "relationships"]);
  const members = readObjectArray(
    context,
    input?.members,
    `${path}.members`,
    LIMITS.familyMembers,
    (member, memberPath) => readFamilyMember(context, member, memberPath),
  );
  const relationships = readObjectArray(
    context,
    input?.relationships,
    `${path}.relationships`,
    LIMITS.familyRelationships,
    (relationship, relationshipPath) =>
      readFamilyRelationship(context, relationship, relationshipPath),
  );
  return { members, relationships };
}

function readFamilyMember(context, value, path) {
  const input = readRecord(context, value, path, ["key", "name", "description"]);
  return {
    key: readIdentifier(context, input?.key, `${path}.key`, LIMITS.uuid),
    name: readShortText(context, input?.name, `${path}.name`),
    description: readPlainText(
      context,
      input?.description,
      `${path}.description`,
      { min: 0, max: LIMITS.mediumText, generatedContent: true },
    ),
  };
}

function readFamilyRelationship(context, value, path) {
  const input = readRecord(context, value, path, ["fromKey", "toKey", "type"]);
  return {
    fromKey: readIdentifier(context, input?.fromKey, `${path}.fromKey`, LIMITS.uuid),
    toKey: readIdentifier(context, input?.toKey, `${path}.toKey`, LIMITS.uuid),
    type: readEnum(
      context,
      input?.type,
      `${path}.type`,
      FAMILY_RELATIONSHIP_TYPES,
    ),
  };
}

function readProvenance(context, value) {
  const input = readRecord(context, value, "$.provenance", [
    "provider",
    "model",
    "promptTemplateVersion",
    "modelDigest",
  ]);
  return {
    provider: readShortText(context, input?.provider, "$.provenance.provider"),
    model: readShortText(context, input?.model, "$.provenance.model"),
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

function validateFamilyGraph(context, family, path) {
  assertUniqueField(context, family.members, "key", `${path}.members`);
  const memberKeys = new Set(family.members.map(({ key }) => key));
  const seenRelationships = new Set();
  /** @type {Map<string, Set<string>>} */
  const parentEdges = new Map();

  family.relationships.forEach((relationship, index) => {
    const relationshipPath = `${path}.relationships[${index}]`;
    if (!memberKeys.has(relationship.fromKey)) {
      context.add(`${relationshipPath}.fromKey`, "must reference a family member");
    }
    if (!memberKeys.has(relationship.toKey)) {
      context.add(`${relationshipPath}.toKey`, "must reference a family member");
    }
    if (relationship.fromKey === relationship.toKey) {
      context.add(relationshipPath, "must not relate a member to itself");
    }

    const signature = [
      relationship.fromKey,
      relationship.toKey,
      relationship.type,
    ].join("\u0000");
    if (seenRelationships.has(signature)) {
      context.add(relationshipPath, "duplicates an earlier relationship");
    }
    seenRelationships.add(signature);

    const parentEdge = asParentEdge(relationship);
    if (parentEdge) {
      const [parent, child] = parentEdge;
      const children = parentEdges.get(parent) ?? new Set();
      children.add(child);
      parentEdges.set(parent, children);
    }
  });

  if (hasDirectedCycle(parentEdges)) {
    context.add(`${path}.relationships`, "parent-child relationships must be acyclic");
  }
}

function asParentEdge({ fromKey, toKey, type }) {
  if (type === "parentOf" || type === "adoptiveParentOf") {
    return [fromKey, toKey];
  }
  if (type === "childOf" || type === "adoptiveChildOf") {
    return [toKey, fromKey];
  }
  return null;
}

function hasDirectedCycle(edges) {
  const visiting = new Set();
  const visited = new Set();

  function visit(node) {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const child of edges.get(node) ?? []) {
      if (visit(child)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }

  return [...edges.keys()].some(visit);
}

function readRecord(context, value, path, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    context.add(path, "must be an object");
    return null;
  }
  const input = /** @type {Record<string, unknown>} */ (value);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.includes(key)) {
      context.add(`${path}.${key}`, "is not allowed");
    }
  }
  return input;
}

function readPlainText(context, value, path, options) {
  const {
    min,
    max,
    singleLine = false,
    generatedContent = false,
  } = options;
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

function readShortText(context, value, path) {
  return readPlainText(context, value, path, {
    min: 1,
    max: LIMITS.shortText,
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
    return expected;
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
  const {
    minItems = 0,
    maxItems,
    itemMax,
    singleLine = false,
    generatedContent = false,
  } = options;
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
      generatedContent,
    }),
  );
  assertUniqueStrings(context, result, path);
  return result;
}

function readObjectArray(context, value, path, maxItems, readItem) {
  if (!Array.isArray(value)) {
    context.add(path, "must be an array");
    return [];
  }
  if (value.length > maxItems) {
    context.add(path, `must contain at most ${maxItems} items`);
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
    const key =
      typeof candidate === "string"
        ? candidate.toLocaleLowerCase("en-US")
        : candidate;
    if (seen.has(key)) {
      context.add(`${path}[${index}].${field}`, `duplicates an earlier ${field}`);
    }
    seen.add(key);
  });
}

const boundedString = (minLength, maxLength) => ({
  type: "string",
  minLength,
  maxLength,
});

const stringArraySchema = (minItems, maxItems, itemMaxLength) => ({
  type: "array",
  minItems,
  maxItems,
  items: boundedString(1, itemMaxLength),
});

const familyMemberSchema = {
  type: "object",
  additionalProperties: false,
  required: ["key", "name", "description"],
  properties: {
    key: boundedString(1, LIMITS.uuid),
    name: boundedString(1, LIMITS.shortText),
    description: boundedString(0, LIMITS.mediumText),
  },
};

const familyRelationshipSchema = {
  type: "object",
  additionalProperties: false,
  required: ["fromKey", "toKey", "type"],
  properties: {
    fromKey: boundedString(1, LIMITS.uuid),
    toKey: boundedString(1, LIMITS.uuid),
    type: { type: "string", enum: [...FAMILY_RELATIONSHIP_TYPES] },
  },
};

/** JSON Schema supplied to structured-output providers for a single NPC. */
export const NPC_DRAFT_JSON_SCHEMA = deepFreeze({
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "key",
    "name",
    "tokenLabel",
    "socialRole",
    "occupation",
    "appearance",
    "personalityTraits",
    "ideal",
    "bond",
    "flaw",
    "mannerisms",
    "motivations",
    "publicBiography",
    "gmSecret",
    "complication",
    "faction",
    "family",
    "tags",
  ],
  properties: {
    id: boundedString(1, LIMITS.uuid),
    key: boundedString(1, LIMITS.uuid),
    name: boundedString(1, LIMITS.shortText),
    tokenLabel: boundedString(1, LIMITS.shortText),
    socialRole: boundedString(1, LIMITS.shortText),
    occupation: boundedString(1, LIMITS.shortText),
    appearance: boundedString(1, LIMITS.mediumText),
    personalityTraits: stringArraySchema(1, LIMITS.traits, LIMITS.shortText),
    ideal: boundedString(1, LIMITS.shortText),
    bond: boundedString(1, LIMITS.shortText),
    flaw: boundedString(1, LIMITS.shortText),
    mannerisms: stringArraySchema(1, LIMITS.mannerisms, LIMITS.shortText),
    motivations: stringArraySchema(1, LIMITS.motivations, LIMITS.shortText),
    publicBiography: boundedString(1, LIMITS.longText),
    gmSecret: boundedString(0, LIMITS.longText),
    complication: boundedString(0, LIMITS.mediumText),
    faction: boundedString(0, LIMITS.shortText),
    family: {
      type: "object",
      additionalProperties: false,
      required: ["members", "relationships"],
      properties: {
        members: {
          type: "array",
          maxItems: LIMITS.familyMembers,
          items: familyMemberSchema,
        },
        relationships: {
          type: "array",
          maxItems: LIMITS.familyRelationships,
          items: familyRelationshipSchema,
        },
      },
    },
    tags: stringArraySchema(0, LIMITS.tags, LIMITS.tag),
  },
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * @typedef {object} GenerationRequest
 * @property {"1"} schemaVersion
 * @property {string} requestId
 * @property {{uuid: string, name: string}} scene
 * @property {{uuid: string|null, name: string, description: string}} region
 * @property {string} prompt
 * @property {number} count
 * @property {Record<string, number>} controls
 * @property {{existingNames: string[], excludedThemes: string[]}} constraints
 * @property {{seed?: number}=} generation
 */

/**
 * @typedef {object} NpcDraft
 * @property {string} id
 * @property {string} key
 * @property {string} name
 * @property {string} tokenLabel
 * @property {string} socialRole
 * @property {string} occupation
 * @property {string} appearance
 * @property {string[]} personalityTraits
 * @property {string} ideal
 * @property {string} bond
 * @property {string} flaw
 * @property {string[]} mannerisms
 * @property {string[]} motivations
 * @property {string} publicBiography
 * @property {string} gmSecret
 * @property {string} complication
 * @property {string} faction
 * @property {{members: {key:string,name:string,description:string}[], relationships: {fromKey:string,toKey:string,type:string}[]}} family
 * @property {string[]} tags
 */

/**
 * @typedef {object} GenerationResult
 * @property {"1"} schemaVersion
 * @property {NpcDraft[]} npcs
 * @property {{provider:string,model:string,promptTemplateVersion:string,modelDigest?:string}} provenance
 */
