import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CONTROLS,
  validateGenerationRequest,
} from "../../shared/contracts/npc-generation.mjs";
import { NpcGenerator } from "../src/npc-generator.mjs";

test("generator repairs invalid output once and assigns final application IDs", async () => {
  const calls = [];
  const responses = [
    modelResponse({ name: "Existing Name", id: "model-id", key: "model-key" }),
    modelResponse({ name: "Tella Reed", id: "other-model-id", key: "other-model-key" }),
  ];
  const provider = {
    model: "qwen3:4b-instruct",
    health: async () => ({ status: "ready", model: "qwen3:4b-instruct" }),
    chatStructured: async (request) => {
      calls.push(request);
      return responses.shift();
    },
  };
  const generator = new NpcGenerator({
    provider,
    idFactory: () => "application-id",
  });
  const progress = [];

  const result = await generator.generate(createRequest(), {
    onProgress: (completed, total) => progress.push({ completed, total }),
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].temperature, 0);
  assert.match(calls[1].messages.at(-1).content, /VALIDATION_ERRORS/);
  assert.match(calls[1].messages.at(-1).content, /must not duplicate/);
  assert.equal(result.npcs[0].id, "application-id");
  assert.equal(result.npcs[0].key, "npc-1");
  assert.equal(result.npcs[0].name, "Tella Reed");
  assert.deepEqual(progress, [{ completed: 1, total: 1 }]);
  assert.deepEqual(result.provenance, {
    provider: "ollama",
    model: "qwen3:4b-instruct",
    promptTemplateVersion: "1",
  });
});

test("generator routes URL and Foundry active-content violations through repair", async () => {
  const calls = [];
  const responses = [
    modelResponse({
      appearance: "Carries directions to https://example.invalid/vault",
      gmSecret: "Invokes @Macro[OpenVault].",
    }),
    modelResponse(),
  ];
  const provider = {
    model: "qwen3:4b-instruct",
    health: async () => ({status: "ready"}),
    chatStructured: async (request) => {
      calls.push(request);
      return responses.shift();
    },
  };
  const generator = new NpcGenerator({provider, idFactory: () => "application-id"});

  const result = await generator.generate(createRequest());

  assert.equal(calls.length, 2);
  assert.match(calls[1].messages.at(-1).content, /must not contain URLs/);
  assert.match(calls[1].messages.at(-1).content, /Foundry enrichers/);
  assert.equal(result.npcs[0].appearance, "A flour-dusted coat and carefully mended gloves.");
});

test("generator repairs a token label duplicated across a batch", async () => {
  const responses = [
    modelResponse({ name: "First NPC", tokenLabel: "Resident" }),
    modelResponse({ name: "Second NPC", tokenLabel: "Resident" }),
    modelResponse({ name: "Second NPC", tokenLabel: "Second Resident" }),
  ];
  const calls = [];
  const provider = {
    model: "qwen3:4b-instruct",
    health: async () => ({ status: "ready" }),
    chatStructured: async (request) => {
      calls.push(request);
      return responses.shift();
    },
  };
  let id = 0;
  const generator = new NpcGenerator({
    provider,
    idFactory: () => `application-id-${++id}`,
  });
  const request = createRequest();
  request.count = 2;
  request.constraints.existingNames = [];

  const result = await generator.generate(request);

  assert.equal(calls.length, 3);
  assert.match(calls[2].messages.at(-1).content, /token label/);
  assert.deepEqual(
    result.npcs.map(({ tokenLabel }) => tokenLabel),
    ["Resident", "Second Resident"],
  );
});

function createRequest() {
  return validateGenerationRequest({
    schemaVersion: "1",
    requestId: "request-1",
    scene: { uuid: "Scene.scene-1", name: "Harbor Ward" },
    region: { uuid: null, name: "", description: "" },
    prompt: "Create a resident tied to a missing caravan.",
    count: 1,
    controls: { ...DEFAULT_CONTROLS },
    constraints: {
      existingNames: ["Existing Name"],
      excludedThemes: ["graphic violence"],
    },
    generation: { seed: 42 },
  });
}

function modelResponse(overrides = {}) {
  return JSON.stringify({
    npc: {
      id: "placeholder-id",
      key: "placeholder-key",
      name: "Tella Reed",
      tokenLabel: "Tella",
      socialRole: "Village mediator",
      occupation: "Miller",
      appearance: "A flour-dusted coat and carefully mended gloves.",
      personalityTraits: ["Patient", "Watchful"],
      ideal: "Neighbors survive by sharing burdens.",
      bond: "Protects the families who use her mill.",
      flaw: "Keeps evidence long after it becomes dangerous.",
      mannerisms: ["Folds every scrap of paper twice"],
      motivations: ["Learn what happened to the caravan"],
      publicBiography: "Tella settles arguments near the old mill.",
      gmSecret: "She found a caravan seal beside the river.",
      complication: "A local reeve wants the seal destroyed.",
      faction: "Millers Guild",
      family: { members: [], relationships: [] },
      tags: ["village", "investigation"],
      ...overrides,
    },
  });
}
