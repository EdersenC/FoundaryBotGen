import {DEFAULT_CONTROLS} from "../../shared/generation-contract.mjs";

export function createGenerationRequest(overrides = {}) {
  return {
    schemaVersion: "1",
    requestId: "request-1",
    scene: {uuid: "Scene.scene-1", name: "Harbor Ward"},
    region: {
      uuid: "Scene.scene-1.Region.region-1",
      name: "Lantern Quay",
      description: "A crowded waterfront market.",
    },
    prompt: "Generate residents with competing civic interests.",
    count: 2,
    controls: {...DEFAULT_CONTROLS},
    constraints: {
      existingNames: ["Mara Venn"],
      excludedThemes: ["graphic violence"],
    },
    generation: {seed: 42},
    ...overrides,
  };
}

export function createNpcDraft(overrides = {}) {
  return {
    id: "npc-1",
    key: "dock-clerk",
    name: "Mara Venn",
    tokenLabel: "Mara",
    socialRole: "Harbor clerk",
    occupation: "Records keeper",
    appearance: "Ink-stained sleeves and a blue coat.",
    personalityTraits: ["Exacting", "Quietly compassionate"],
    ideal: "Every debt should be recorded.",
    bond: "Protects the night-shift porters.",
    flaw: "Cannot ignore a discrepancy.",
    mannerisms: ["Counts on her fingers", "Straightens nearby papers"],
    motivations: ["Expose a smuggling route"],
    publicBiography: "A familiar face at the harbor office.",
    gmSecret: "She altered one manifest.",
    complication: "A supervisor suspects her.",
    faction: "Harbor Office",
    family: {
      members: [
        {key: "mara", name: "Mara Venn", description: "The generated NPC."},
        {key: "ivo", name: "Ivo Venn", description: "Her adult brother."},
      ],
      relationships: [
        {fromKey: "mara", toKey: "ivo", type: "siblingOf"},
      ],
    },
    tags: ["harbor", "bureaucrat"],
    ...overrides,
  };
}

export function createGenerationResult(npcs = [createNpcDraft()]) {
  return {
    schemaVersion: "1",
    npcs,
    provenance: {
      provider: "ollama",
      model: "qwen3:4b-instruct",
      promptTemplateVersion: "1",
    },
  };
}
