import * as sharedContract from "../../shared/contracts/npc-generation.mjs";
import {MAX_NPC_COUNT, MIN_NPC_COUNT} from "../constants.mjs";
import {normalizePlainText, normalizeSingleLine} from "../core/text.mjs";

const EXPECTED_SCHEMA_VERSION = "2";

export const GENERATION_SCHEMA_VERSION = String(
  sharedContract.GENERATION_SCHEMA_VERSION ?? EXPECTED_SCHEMA_VERSION,
);

export const GENERATION_LIMITS = Object.freeze({
  requestId: sharedContract.GENERATION_LIMITS?.requestId ?? 128,
  uuid: sharedContract.GENERATION_LIMITS?.uuid ?? 128,
  name: sharedContract.GENERATION_LIMITS?.name ?? 128,
  regionDescription: sharedContract.GENERATION_LIMITS?.regionDescription ?? 4_000,
  prompt: sharedContract.GENERATION_LIMITS?.prompt ?? 8_000,
  existingNames: sharedContract.GENERATION_LIMITS?.existingNames ?? 500,
  excludedThemes: sharedContract.GENERATION_LIMITS?.excludedThemes ?? 100,
  excludedTheme: sharedContract.GENERATION_LIMITS?.excludedTheme ?? 240,
  fieldDefinitions: sharedContract.GENERATION_LIMITS?.fieldDefinitions ?? 16,
  controlDefinitions: sharedContract.GENERATION_LIMITS?.controlDefinitions ?? 16,
  definitionId: sharedContract.GENERATION_LIMITS?.definitionId ?? 64,
  definitionLabel: sharedContract.GENERATION_LIMITS?.definitionLabel ?? 80,
  definitionDescription: sharedContract.GENERATION_LIMITS?.definitionDescription ?? 500,
  controlText: sharedContract.GENERATION_LIMITS?.controlText ?? 1_000,
  fieldValue: sharedContract.GENERATION_LIMITS?.fieldValue ?? 2_500,
  failureMessage: sharedContract.GENERATION_LIMITS?.failureMessage ?? 500,
  shortText: sharedContract.GENERATION_LIMITS?.shortText ?? 240,
  mediumText: sharedContract.GENERATION_LIMITS?.mediumText ?? 1_000,
  longText: sharedContract.GENERATION_LIMITS?.longText ?? 2_500,
});

export const CONTROL_TYPES = Object.freeze(
  [...(sharedContract.CONTROL_TYPES ?? ["slider", "text"])],
);

export const DEFAULT_FIELD_DEFINITIONS = sharedContract.DEFAULT_FIELD_DEFINITIONS;
export const DEFAULT_CONTROL_DEFINITIONS = sharedContract.DEFAULT_CONTROL_DEFINITIONS;
export const ContractValidationError = sharedContract.ContractValidationError ?? Error;

export function validateGenerationRequest(value) {
  return callRequiredValidator("validateGenerationRequest", value);
}

export function validateFieldDefinitions(value) {
  return callRequiredValidator("validateFieldDefinitions", value);
}

export function validateControlDefinitions(value) {
  return callRequiredValidator("validateControlDefinitions", value);
}

export function validateNpcDraft(value, fieldDefinitions) {
  const validator = requiredValidator("validateNpcDraft");
  return validator(value, fieldDefinitions);
}

export function validateGenerationResult(value) {
  return callRequiredValidator("validateGenerationResult", value);
}

export function buildGenerationRequest({
  requestId,
  scene,
  region,
  prompt,
  count,
  fields,
  controls,
  existingNames = [],
  excludedThemes = [],
  seed,
}) {
  const request = {
    schemaVersion: GENERATION_SCHEMA_VERSION,
    requestId: normalizeSingleLine(requestId, {maxLength: GENERATION_LIMITS.requestId}),
    scene: {
      uuid: normalizeSingleLine(scene?.uuid, {maxLength: GENERATION_LIMITS.uuid}),
      name: normalizeSingleLine(scene?.name, {maxLength: GENERATION_LIMITS.name}),
    },
    region: {
      uuid: normalizeSingleLine(region?.uuid, {maxLength: GENERATION_LIMITS.uuid}) || null,
      name: normalizeSingleLine(region?.name, {maxLength: GENERATION_LIMITS.name}),
      description: normalizePlainText(region?.description, {
        maxLength: GENERATION_LIMITS.regionDescription,
      }),
    },
    prompt: normalizePlainText(prompt, {maxLength: GENERATION_LIMITS.prompt}),
    count: clampInteger(count, MIN_NPC_COUNT, MAX_NPC_COUNT),
    fields: structuredClone(fields),
    controls: structuredClone(controls),
    constraints: {
      existingNames: normalizeStringList(
        existingNames,
        GENERATION_LIMITS.existingNames,
        GENERATION_LIMITS.name,
      ),
      excludedThemes: normalizeStringList(
        excludedThemes,
        GENERATION_LIMITS.excludedThemes,
        GENERATION_LIMITS.excludedTheme,
      ),
    },
  };

  if (seed !== undefined && seed !== null && seed !== "") {
    request.generation = {seed: Number(seed)};
  }
  return validateGenerationRequest(request);
}

function callRequiredValidator(exportName, value) {
  return requiredValidator(exportName)(value);
}

function requiredValidator(exportName) {
  const validator = sharedContract[exportName];
  if (typeof validator !== "function") {
    throw new Error(`Shared contract export ${exportName} is unavailable.`);
  }
  return validator;
}

function clampInteger(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function normalizeStringList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  const seen = new Set();
  for (const entry of value) {
    const item = normalizeSingleLine(entry, {maxLength});
    const key = item.toLocaleLowerCase("en-US");
    if (!item || seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
    if (normalized.length === maxItems) break;
  }
  return normalized;
}
