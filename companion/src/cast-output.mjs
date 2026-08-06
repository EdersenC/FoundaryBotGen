import {
  ContractValidationError,
  validateNpcDraft,
} from "../../shared/contracts/npc-generation.mjs";

export class ModelOutputError extends Error {
  constructor(path, message, options) {
    super(`${path}: ${message}`, options);
    this.name = "ModelOutputError";
    this.issues = [{ path, message }];
  }
}

export function parseCastEnvelope(content) {
  const parsed = parseJsonObject(content);
  assertOnlyKeys(parsed, ["npcs"], "$");
  if (!Array.isArray(parsed.npcs)) {
    throw new ModelOutputError("$.npcs", "must be an array");
  }
  return parsed.npcs;
}

export function parseNpcEnvelope(content) {
  const parsed = parseJsonObject(content);
  assertOnlyKeys(parsed, ["npc"], "$");
  if (!isRecord(parsed.npc)) {
    throw new ModelOutputError("$.npc", "must be an object");
  }
  return parsed.npc;
}

export function validateModelNpc(candidate, {
  slot,
  fieldDefinitions,
  unavailableNames,
  unavailableTokenLabels,
  idFactory,
}) {
  if (!isRecord(candidate)) {
    throw new ModelOutputError("$.npc", "must be an object");
  }
  assertOnlyKeys(candidate, ["name", "tokenLabel", "fields"], "$.npc");
  const draft = validateNpcDraft({
    id: "pending-application-id",
    key: `npc-${slot}`,
    slot,
    name: candidate.name,
    tokenLabel: candidate.tokenLabel,
    fields: candidate.fields,
  }, fieldDefinitions);

  if (unavailableNames.has(normalizeComparableText(draft.name))) {
    throw new ModelOutputError(
      "$.npc.name",
      "must not duplicate an existing or generated name",
    );
  }
  if (unavailableTokenLabels.has(normalizeComparableText(draft.tokenLabel))) {
    throw new ModelOutputError(
      "$.npc.tokenLabel",
      "must not duplicate a generated token label",
    );
  }
  return validateNpcDraft({...draft, id: idFactory()}, fieldDefinitions);
}

export function isRepairableOutputError(error) {
  return error instanceof ContractValidationError || error instanceof ModelOutputError;
}

export function formatValidationError(error) {
  if (!Array.isArray(error?.issues)) {
    return "The response did not match the required contract.";
  }
  return error.issues
    .slice(0, 20)
    .map(({ path, message }) => `${path}: ${message}`)
    .join("\n");
}

export function firstValidationMessage(error) {
  const issue = Array.isArray(error?.issues) ? error.issues[0] : null;
  return issue ? `${issue.path}: ${issue.message}` : "invalid model output";
}

export function normalizeComparableText(value) {
  return value.trim().toLocaleLowerCase("en-US");
}

function parseJsonObject(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new ModelOutputError("$", "must be valid JSON", { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new ModelOutputError("$", "must be an object");
  }
  return parsed;
}

function assertOnlyKeys(value, allowedKeys, path) {
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.includes(key));
  if (unknownKey) {
    throw new ModelOutputError(`${path}.${unknownKey}`, "is not allowed");
  }
  if (Object.keys(value).length !== allowedKeys.length) {
    const missingKey = allowedKeys.find((key) => !Object.hasOwn(value, key));
    if (missingKey) throw new ModelOutputError(`${path}.${missingKey}`, "is required");
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
