import * as sharedContract from "../../shared/contracts/npc-generation.mjs";
import {MAX_NPC_COUNT, MIN_NPC_COUNT} from "../constants.mjs";
import {normalizePlainText, normalizeSingleLine} from "../core/text.mjs";

const EXPECTED_SCHEMA_VERSION = "1";

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
  shortText: sharedContract.GENERATION_LIMITS?.shortText ?? 240,
  mediumText: sharedContract.GENERATION_LIMITS?.mediumText ?? 1_000,
  longText: sharedContract.GENERATION_LIMITS?.longText ?? 2_500,
  traits: sharedContract.GENERATION_LIMITS?.traits ?? 8,
  mannerisms: sharedContract.GENERATION_LIMITS?.mannerisms ?? 8,
  motivations: sharedContract.GENERATION_LIMITS?.motivations ?? 8,
  tags: sharedContract.GENERATION_LIMITS?.tags ?? 12,
  tag: sharedContract.GENERATION_LIMITS?.tag ?? 64,
  familyMembers: sharedContract.GENERATION_LIMITS?.familyMembers ?? 16,
  familyRelationships: sharedContract.GENERATION_LIMITS?.familyRelationships ?? 24,
});

export const DEFAULT_CONTROLS = Object.freeze(normalizeDefaultControls(
  sharedContract.DEFAULT_CONTROLS,
));

export const CONTROL_KEYS = Object.freeze(Object.keys(DEFAULT_CONTROLS));

export const ContractValidationError = sharedContract.ContractValidationError ?? Error;

export function validateGenerationRequest(value) {
  return callRequiredValidator("validateGenerationRequest", value);
}

export function validateNpcDraft(value) {
  return callRequiredValidator("validateNpcDraft", value);
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
    controls: normalizeControls(controls),
  };

  if (seed !== undefined && seed !== null && seed !== "") {
    request.generation = {seed: Number(seed)};
  }

  return validateGenerationRequest(request);
}

export function normalizeControls(value) {
  return Object.fromEntries(
    CONTROL_KEYS.map((key) => [key, clampInteger(value?.[key], 0, 100, DEFAULT_CONTROLS[key])]),
  );
}

export function createControlDefinitions(value = DEFAULT_CONTROLS) {
  const controls = normalizeControls(value);
  return CONTROL_KEYS.map((key) => ({
    key,
    value: controls[key],
    min: 0,
    max: 100,
    step: 1,
  }));
}

function normalizeDefaultControls(value) {
  const fallbacks = {
    detail: 50,
    socialDiversity: 50,
    interconnectedness: 50,
    familyDepth: 50,
    eccentricity: 50,
    danger: 50,
    magic: 50,
  };
  if (!value || typeof value !== "object") return fallbacks;
  return Object.fromEntries(
    Object.keys(fallbacks).map((key) => [key, clampInteger(value[key], 0, 100, fallbacks[key])]),
  );
}

function callRequiredValidator(exportName, value) {
  const validator = sharedContract[exportName];
  if (typeof validator !== "function") {
    throw new Error(`Shared contract export ${exportName} is unavailable.`);
  }
  const result = validator(value);
  if (result === undefined || result === true) return value;
  return result;
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
