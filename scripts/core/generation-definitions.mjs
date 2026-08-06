import {
  CONTROL_TYPES,
  DEFAULT_CONTROL_DEFINITIONS,
  DEFAULT_FIELD_DEFINITIONS,
  GENERATION_LIMITS,
} from "../contracts/npc-generation-contract.mjs";
import {normalizePlainText, normalizeSingleLine} from "./text.mjs";

const LEGACY_CONTROL_IDS = Object.freeze({
  detail: "detail",
  socialDiversity: "social-diversity",
  interconnectedness: "interconnectedness",
  familyDepth: "family-depth",
  eccentricity: "eccentricity",
  danger: "danger",
  magic: "magic",
});

export function normalizeStoredFieldDefinitions(value) {
  const source = Array.isArray(value) && value.length > 0
    ? value
    : DEFAULT_FIELD_DEFINITIONS;
  const definitions = normalizeFieldCandidates(source);
  return definitions.length > 0
    ? definitions
    : structuredClone(DEFAULT_FIELD_DEFINITIONS);
}

export function normalizeStoredControlDefinitions(value) {
  const source = Array.isArray(value)
    ? value
    : migrateLegacyControls(value);
  return normalizeControlCandidates(source);
}

export function readFieldDefinitions(data, prefix = "fields") {
  return definitionIndexes(data, prefix)
    .slice(0, GENERATION_LIMITS.fieldDefinitions)
    .map((index) => ({
      id: normalizeDefinitionId(data.get(`${prefix}.${index}.id`)),
      label: normalizeSingleLine(data.get(`${prefix}.${index}.label`), {
        maxLength: GENERATION_LIMITS.definitionLabel,
      }),
      description: normalizePlainText(data.get(`${prefix}.${index}.description`), {
        maxLength: GENERATION_LIMITS.definitionDescription,
      }),
    }));
}

export function readControlDefinitions(data, prefix = "controls") {
  return definitionIndexes(data, prefix)
    .slice(0, GENERATION_LIMITS.controlDefinitions)
    .map((index) => {
      const type = CONTROL_TYPES.includes(data.get(`${prefix}.${index}.type`))
        ? data.get(`${prefix}.${index}.type`)
        : "slider";
      return {
        id: normalizeDefinitionId(data.get(`${prefix}.${index}.id`)),
        label: normalizeSingleLine(data.get(`${prefix}.${index}.label`), {
          maxLength: GENERATION_LIMITS.definitionLabel,
        }),
        description: normalizePlainText(data.get(`${prefix}.${index}.description`), {
          maxLength: GENERATION_LIMITS.definitionDescription,
        }),
        type,
        value: type === "slider"
          ? clampSlider(data.get(`${prefix}.${index}.value`))
          : normalizePlainText(data.get(`${prefix}.${index}.value`), {
            maxLength: GENERATION_LIMITS.controlText,
          }),
      };
    });
}

export function createFieldDefinition(existingDefinitions) {
  return {
    id: nextDefinitionId("field", existingDefinitions),
    label: "New Field",
    description: "Describe the NPC information the model should generate for this field.",
  };
}

export function createControlDefinition(existingDefinitions) {
  return {
    id: nextDefinitionId("control", existingDefinitions),
    label: "New Control",
    description: "Describe how this control should influence the generated cast.",
    type: "slider",
    value: 50,
  };
}

export function toFieldDefinitionContext(definitions) {
  return definitions.map((definition, index) => ({...definition, index}));
}

export function toControlDefinitionContext(definitions) {
  return definitions.map((definition, index) => ({
    ...definition,
    index,
    isSlider: definition.type === "slider",
    isText: definition.type === "text",
  }));
}

function normalizeFieldCandidates(value) {
  const usedIds = new Set();
  const result = [];
  for (const candidate of value.slice(0, GENERATION_LIMITS.fieldDefinitions)) {
    const label = normalizeSingleLine(candidate?.label, {
      maxLength: GENERATION_LIMITS.definitionLabel,
    });
    const description = normalizePlainText(candidate?.description, {
      maxLength: GENERATION_LIMITS.definitionDescription,
    });
    if (!label || !description) continue;
    const id = uniqueDefinitionId(
      normalizeDefinitionId(candidate?.id) || slugify(label) || "field",
      usedIds,
    );
    result.push({id, label, description});
  }
  return result;
}

function normalizeControlCandidates(value) {
  const usedIds = new Set();
  const result = [];
  for (const candidate of value.slice(0, GENERATION_LIMITS.controlDefinitions)) {
    const label = normalizeSingleLine(candidate?.label, {
      maxLength: GENERATION_LIMITS.definitionLabel,
    });
    const description = normalizePlainText(candidate?.description, {
      maxLength: GENERATION_LIMITS.definitionDescription,
    });
    if (!label || !description) continue;
    const id = uniqueDefinitionId(
      normalizeDefinitionId(candidate?.id) || slugify(label) || "control",
      usedIds,
    );
    const type = CONTROL_TYPES.includes(candidate?.type) ? candidate.type : "slider";
    result.push({
      id,
      label,
      description,
      type,
      value: type === "slider"
        ? clampSlider(candidate?.value)
        : normalizePlainText(candidate?.value, {maxLength: GENERATION_LIMITS.controlText}),
    });
  }
  return result;
}

function migrateLegacyControls(value) {
  if (!value || typeof value !== "object") {
    return structuredClone(DEFAULT_CONTROL_DEFINITIONS);
  }
  const valuesById = Object.fromEntries(
    Object.entries(LEGACY_CONTROL_IDS).map(([legacyId, currentId]) => [
      currentId,
      value[legacyId],
    ]),
  );
  return DEFAULT_CONTROL_DEFINITIONS.map((definition) => ({
    ...definition,
    ...(valuesById[definition.id] === undefined
      ? {}
      : {value: valuesById[definition.id]}),
  }));
}

function definitionIndexes(data, prefix) {
  const indexes = new Set();
  const pattern = new RegExp(`^${prefix}\\.(\\d+)\\.`);
  for (const key of data.keys()) {
    const match = String(key).match(pattern);
    if (match) indexes.add(Number(match[1]));
  }
  return [...indexes].sort((left, right) => left - right);
}

function nextDefinitionId(prefix, definitions) {
  const used = new Set(definitions.map(({id}) => id));
  return uniqueDefinitionId(prefix, used);
}

function uniqueDefinitionId(base, usedIds) {
  let candidate = base.slice(0, GENERATION_LIMITS.definitionId);
  let suffix = 2;
  while (usedIds.has(candidate)) {
    const ending = `-${suffix}`;
    candidate = `${base.slice(0, GENERATION_LIMITS.definitionId - ending.length)}${ending}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function normalizeDefinitionId(value) {
  return normalizeSingleLine(value, {maxLength: GENERATION_LIMITS.definitionId})
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/^-+|-+$/g, "");
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, GENERATION_LIMITS.definitionId);
}

function clampSlider(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 50;
  return Math.min(100, Math.max(0, Math.round(number)));
}
