import {
  DEFAULT_CONTROL_DEFINITIONS,
  DEFAULT_FIELD_DEFINITIONS,
} from "../../shared/generation-contract.mjs";

export function createGenerationRequest(overrides = {}) {
  return {
    schemaVersion: "2",
    requestId: "request-1",
    scene: {uuid: "Scene.scene-1", name: "Harbor Ward"},
    region: {
      uuid: "Scene.scene-1.Region.region-1",
      name: "Lantern Quay",
      description: "A crowded waterfront market.",
    },
    prompt: "Generate residents with competing civic interests.",
    count: 2,
    fields: structuredClone(DEFAULT_FIELD_DEFINITIONS),
    controls: structuredClone(DEFAULT_CONTROL_DEFINITIONS),
    constraints: {
      existingNames: ["Mara Venn"],
      excludedThemes: ["graphic violence"],
    },
    generation: {seed: 42},
    ...overrides,
  };
}

export function createNpcDraft(overrides = {}) {
  const fields = Object.fromEntries(
    DEFAULT_FIELD_DEFINITIONS.map(({id, label}) => [
      id,
      `${label} for the harbor clerk.`,
    ]),
  );
  return {
    id: "npc-id-1",
    key: "npc-1",
    slot: 1,
    name: "Mara Venn",
    tokenLabel: "Mara",
    fields,
    ...overrides,
  };
}

export function createGenerationResult(
  npcs = [createNpcDraft()],
  {requestedCount = npcs.length, failures = []} = {},
) {
  return {
    schemaVersion: "2",
    requestedCount,
    fields: structuredClone(DEFAULT_FIELD_DEFINITIONS),
    controls: structuredClone(DEFAULT_CONTROL_DEFINITIONS),
    npcs,
    failures,
    provenance: {
      provider: "ollama",
      model: "qwen3:4b-instruct",
      promptTemplateVersion: "2",
    },
  };
}
