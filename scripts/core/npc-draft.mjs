import {
  normalizePlainText,
  normalizeSingleLine,
  plainTextToParagraphs,
} from "./text.mjs";
import {GENERATION_LIMITS} from "../contracts/npc-generation-contract.mjs";

export const REVIEW_TEXT_FIELDS = Object.freeze([
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
]);

const SINGLE_LINE_FIELDS = new Set([
  "name",
  "tokenLabel",
  "socialRole",
  "occupation",
  "ideal",
  "bond",
  "flaw",
  "faction",
]);

const TEXT_LIST_FIELDS = new Set([
  "personalityTraits",
  "mannerisms",
  "motivations",
]);

const FIELD_LIMITS = Object.freeze({
  name: GENERATION_LIMITS.shortText,
  tokenLabel: GENERATION_LIMITS.shortText,
  socialRole: GENERATION_LIMITS.shortText,
  occupation: GENERATION_LIMITS.shortText,
  appearance: GENERATION_LIMITS.mediumText,
  personalityTraits: GENERATION_LIMITS.shortText,
  ideal: GENERATION_LIMITS.shortText,
  bond: GENERATION_LIMITS.shortText,
  flaw: GENERATION_LIMITS.shortText,
  mannerisms: GENERATION_LIMITS.shortText,
  motivations: GENERATION_LIMITS.shortText,
  publicBiography: GENERATION_LIMITS.longText,
  gmSecret: GENERATION_LIMITS.longText,
  complication: GENERATION_LIMITS.mediumText,
  faction: GENERATION_LIMITS.shortText,
});

export function applyNpcReviewEdits(draft, edits) {
  const updated = structuredClone(draft);
  for (const field of REVIEW_TEXT_FIELDS) {
    if (!Object.hasOwn(edits, field)) continue;
    if (TEXT_LIST_FIELDS.has(field)) {
      updated[field] = normalizeTextList(edits[field]);
      continue;
    }
    updated[field] = SINGLE_LINE_FIELDS.has(field)
      ? normalizeSingleLine(edits[field], {maxLength: FIELD_LIMITS[field]})
      : normalizePlainText(edits[field], {maxLength: FIELD_LIMITS[field]});
  }
  return updated;
}

export function buildBiographyHtml(draft) {
  const sections = [
    ["Social Role", draft.socialRole],
    ["Occupation", draft.occupation],
    ["Appearance", draft.appearance],
    ["Personality", textListToPlainText(draft.personalityTraits)],
    ["Mannerisms", textListToPlainText(draft.mannerisms)],
    ["Motivations", textListToPlainText(draft.motivations)],
    ["Faction", draft.faction],
    ["Complication", draft.complication],
  ];

  const biography = sections
    .filter(([, value]) => normalizePlainText(value))
    .map(([heading, value]) => `<h3>${heading}</h3>${plainTextToParagraphs(value)}`)
    .join("");

  const secret = normalizePlainText(draft.gmSecret, {
    maxLength: GENERATION_LIMITS.longText,
  });
  const secretSection = secret
    ? `<section class="secret"><h3>GM Secret</h3>${plainTextToParagraphs(secret)}</section>`
    : "";

  return (biography || secretSection) ? `${biography}${secretSection}` : "<p></p>";
}

export function buildPublicBiographyHtml(draft) {
  return plainTextToParagraphs(draft.publicBiography) || "<p></p>";
}

export function buildSafeNpcFlags(draft, generation) {
  return {
    schemaVersion: String(generation.schemaVersion ?? "1"),
    draftId: normalizeSingleLine(draft.id, {maxLength: GENERATION_LIMITS.uuid}),
    key: normalizeSingleLine(draft.key, {maxLength: GENERATION_LIMITS.uuid}),
    sceneUuid: normalizeSingleLine(generation.sceneUuid, {maxLength: GENERATION_LIMITS.uuid}),
    regionUuid: normalizeSingleLine(generation.regionUuid, {maxLength: GENERATION_LIMITS.uuid}) || null,
    jobId: normalizeSingleLine(generation.jobId, {maxLength: GENERATION_LIMITS.uuid}),
    generatedAt: normalizeSingleLine(generation.generatedAt, {maxLength: 100}),
    provenance: normalizeProvenance(generation.provenance),
    narrative: {
      socialRole: normalizePlainText(draft.socialRole, {maxLength: GENERATION_LIMITS.shortText}),
      occupation: normalizePlainText(draft.occupation, {maxLength: GENERATION_LIMITS.shortText}),
      appearance: normalizePlainText(draft.appearance, {maxLength: GENERATION_LIMITS.mediumText}),
      personalityTraits: normalizeTextList(draft.personalityTraits),
      mannerisms: normalizeTextList(draft.mannerisms),
      motivations: normalizeTextList(draft.motivations),
      complication: normalizePlainText(draft.complication, {maxLength: GENERATION_LIMITS.mediumText}),
      faction: normalizePlainText(draft.faction, {maxLength: GENERATION_LIMITS.shortText}),
    },
    family: normalizeFamily(draft.family),
    tags: normalizeTags(draft.tags),
  };
}

function normalizeFamily(family) {
  const members = Array.isArray(family?.members)
    ? family.members.slice(0, GENERATION_LIMITS.familyMembers).map((member) => ({
        key: normalizeSingleLine(member?.key, {maxLength: GENERATION_LIMITS.uuid}),
        name: normalizeSingleLine(member?.name, {maxLength: GENERATION_LIMITS.shortText}),
        description: normalizePlainText(member?.description, {maxLength: GENERATION_LIMITS.mediumText}),
      }))
    : [];
  const relationships = Array.isArray(family?.relationships)
    ? family.relationships.slice(0, GENERATION_LIMITS.familyRelationships).map((relationship) => ({
        fromKey: normalizeSingleLine(relationship?.fromKey, {maxLength: GENERATION_LIMITS.uuid}),
        toKey: normalizeSingleLine(relationship?.toKey, {maxLength: GENERATION_LIMITS.uuid}),
        type: normalizeSingleLine(relationship?.type, {maxLength: GENERATION_LIMITS.shortText}),
      }))
    : [];
  return {members, relationships};
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .slice(0, GENERATION_LIMITS.tags)
    .map((tag) => normalizeSingleLine(tag, {maxLength: GENERATION_LIMITS.tag}))
    .filter(Boolean);
}

function normalizeProvenance(provenance) {
  if (!provenance || typeof provenance !== "object") return {};
  return Object.fromEntries(
    ["provider", "model", "promptTemplateVersion", "modelDigest"]
      .filter((key) => provenance[key] !== undefined)
      .map((key) => [key, normalizeSingleLine(provenance[key], {maxLength: GENERATION_LIMITS.shortText})]),
  );
}

export function createActorSource(draft, {folderId = null, generation, moduleId}) {
  const name = normalizeSingleLine(draft.name, {maxLength: GENERATION_LIMITS.shortText});
  if (!name) throw new Error("An approved NPC must have a name.");

  const tokenName = normalizeSingleLine(draft.tokenLabel, {maxLength: GENERATION_LIMITS.shortText}) || name;
  return {
    name,
    type: "npc",
    folder: folderId,
    system: {
      details: {
        biography: {
          value: buildBiographyHtml(draft),
          public: buildPublicBiographyHtml(draft),
        },
        ideal: normalizeSingleLine(draft.ideal, {maxLength: GENERATION_LIMITS.shortText}),
        bond: normalizeSingleLine(draft.bond, {maxLength: GENERATION_LIMITS.shortText}),
        flaw: normalizeSingleLine(draft.flaw, {maxLength: GENERATION_LIMITS.shortText}),
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

export function summarizeFamily(family) {
  const members = Array.isArray(family?.members) ? family.members : [];
  const relationships = Array.isArray(family?.relationships) ? family.relationships : [];
  const memberText = members
    .map((member) => `${normalizeSingleLine(member?.name)}: ${normalizePlainText(member?.description)}`)
    .filter((line) => line !== ": ")
    .join("\n");
  const relationshipText = relationships
    .map((relationship) => `${normalizeSingleLine(relationship?.fromKey)} — ${normalizeSingleLine(relationship?.type)} → ${normalizeSingleLine(relationship?.toKey)}`)
    .join("\n");
  return [memberText, relationshipText].filter(Boolean).join("\n\n");
}

function normalizeTextList(value) {
  const entries = Array.isArray(value)
    ? value
    : normalizePlainText(value, {maxLength: 5_000}).split("\n");
  const seen = new Set();
  const normalized = [];
  for (const entry of entries) {
    const item = normalizeSingleLine(entry, {maxLength: GENERATION_LIMITS.shortText});
    const key = item.toLocaleLowerCase("en-US");
    if (!item || seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
    if (normalized.length === GENERATION_LIMITS.traits) break;
  }
  return normalized;
}

function textListToPlainText(value) {
  return normalizeTextList(value).join("\n");
}
