import {
  escapeHtml,
  normalizePlainText,
  normalizeSingleLine,
  plainTextToParagraphs,
} from "./text.mjs";
import {GENERATION_LIMITS} from "../contracts/npc-generation-contract.mjs";

export function applyNpcReviewEdits(draft, edits, fieldDefinitions) {
  const fields = Object.fromEntries(
    fieldDefinitions.map(({id}) => [
      id,
      normalizePlainText(edits?.fields?.[id] ?? draft.fields[id], {
        maxLength: GENERATION_LIMITS.fieldValue,
      }),
    ]),
  );
  return {
    ...structuredClone(draft),
    name: normalizeSingleLine(edits?.name ?? draft.name, {
      maxLength: GENERATION_LIMITS.name,
    }),
    tokenLabel: normalizeSingleLine(edits?.tokenLabel ?? draft.tokenLabel, {
      maxLength: GENERATION_LIMITS.name,
    }),
    fields,
  };
}

export function buildBiographyHtml(draft, fieldDefinitions) {
  const biography = fieldDefinitions
    .map(({id, label}) => [
      normalizeSingleLine(label, {maxLength: GENERATION_LIMITS.definitionLabel}),
      normalizePlainText(draft.fields?.[id], {maxLength: GENERATION_LIMITS.fieldValue}),
    ])
    .filter(([label, value]) => label && value)
    .map(([label, value]) => `<h3>${escapeHtml(label)}</h3>${plainTextToParagraphs(value)}`)
    .join("");
  return biography || "<p></p>";
}

export function buildPublicBiographyHtml() {
  return "<p></p>";
}

export function buildSafeNpcFlags(draft, generation) {
  return {
    schemaVersion: String(generation.schemaVersion ?? "2"),
    draftId: normalizeSingleLine(draft.id, {maxLength: GENERATION_LIMITS.uuid}),
    key: normalizeSingleLine(draft.key, {maxLength: GENERATION_LIMITS.uuid}),
    slot: Number(draft.slot),
    sceneUuid: normalizeSingleLine(generation.sceneUuid, {maxLength: GENERATION_LIMITS.uuid}),
    regionUuid: normalizeSingleLine(generation.regionUuid, {maxLength: GENERATION_LIMITS.uuid}) || null,
    jobId: normalizeSingleLine(generation.jobId, {maxLength: GENERATION_LIMITS.uuid}),
    generatedAt: normalizeSingleLine(generation.generatedAt, {maxLength: 100}),
    provenance: normalizeProvenance(generation.provenance),
    definitions: {
      fields: normalizeFieldDefinitions(generation.fields),
      controls: normalizeControlDefinitions(generation.controls),
    },
    fields: normalizeFieldValues(draft.fields, generation.fields),
  };
}

export function createActorSource(draft, {folderId = null, generation, moduleId}) {
  const name = normalizeSingleLine(draft.name, {maxLength: GENERATION_LIMITS.name});
  if (!name) throw new Error("An approved NPC must have a name.");
  const tokenName = normalizeSingleLine(draft.tokenLabel, {
    maxLength: GENERATION_LIMITS.name,
  }) || name;
  return {
    name,
    type: "npc",
    folder: folderId,
    system: {
      details: {
        biography: {
          value: buildBiographyHtml(draft, generation.fields),
          public: buildPublicBiographyHtml(),
        },
      },
    },
    prototypeToken: {
      name: tokenName,
      actorLink: true,
    },
    flags: {
      [moduleId]: buildSafeNpcFlags(draft, generation),
    },
  };
}

function normalizeFieldDefinitions(definitions) {
  if (!Array.isArray(definitions)) return [];
  return definitions
    .slice(0, GENERATION_LIMITS.fieldDefinitions)
    .map((definition) => ({
      id: normalizeSingleLine(definition?.id, {maxLength: GENERATION_LIMITS.definitionId}),
      label: normalizeSingleLine(definition?.label, {maxLength: GENERATION_LIMITS.definitionLabel}),
      description: normalizePlainText(definition?.description, {
        maxLength: GENERATION_LIMITS.definitionDescription,
      }),
    }));
}

function normalizeControlDefinitions(definitions) {
  if (!Array.isArray(definitions)) return [];
  return definitions
    .slice(0, GENERATION_LIMITS.controlDefinitions)
    .map((definition) => ({
      id: normalizeSingleLine(definition?.id, {maxLength: GENERATION_LIMITS.definitionId}),
      label: normalizeSingleLine(definition?.label, {maxLength: GENERATION_LIMITS.definitionLabel}),
      description: normalizePlainText(definition?.description, {
        maxLength: GENERATION_LIMITS.definitionDescription,
      }),
      type: definition?.type === "text" ? "text" : "slider",
      value: definition?.type === "text"
        ? normalizePlainText(definition?.value, {maxLength: GENERATION_LIMITS.controlText})
        : Math.min(100, Math.max(0, Math.round(Number(definition?.value) || 0))),
    }));
}

function normalizeFieldValues(values, definitions) {
  return Object.fromEntries(
    normalizeFieldDefinitions(definitions).map(({id}) => [
      id,
      normalizePlainText(values?.[id], {maxLength: GENERATION_LIMITS.fieldValue}),
    ]),
  );
}

function normalizeProvenance(provenance) {
  if (!provenance || typeof provenance !== "object") return {};
  return Object.fromEntries(
    ["provider", "model", "promptTemplateVersion", "modelDigest"]
      .filter((key) => provenance[key] !== undefined)
      .map((key) => [
        key,
        normalizeSingleLine(provenance[key], {maxLength: GENERATION_LIMITS.shortText}),
      ]),
  );
}
