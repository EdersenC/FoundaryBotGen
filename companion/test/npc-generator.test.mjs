import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CONTROL_DEFINITIONS,
  DEFAULT_FIELD_DEFINITIONS,
  validateGenerationRequest,
} from "../../shared/contracts/npc-generation.mjs";
import {ProviderError} from "../src/errors.mjs";
import {NpcGenerator, planCastBatches} from "../src/npc-generator.mjs";

test("generator creates a full cast batch and targets repair to one invalid NPC", async () => {
  const calls = [];
  const responses = [
    modelCastResponse([
      modelNpc({name: "Tella Reed", tokenLabel: "Tella"}),
      modelNpc({name: "Existing Name", tokenLabel: "Second"}),
    ]),
    modelNpcResponse(modelNpc({name: "Oren Pike", tokenLabel: "Oren"})),
  ];
  const generator = createGenerator(calls, responses);
  const progress = [];

  const result = await generator.generate(createRequest({count: 2}), {
    onProgress: (completed, total) => progress.push({completed, total}),
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].temperature, 0);
  assert.match(calls[1].messages.at(-1).content, /INVALID_NPC_CANDIDATE/);
  assert.match(calls[1].messages.at(-1).content, /must not duplicate/);
  assert.deepEqual(result.npcs.map(({name}) => name), ["Tella Reed", "Oren Pike"]);
  assert.deepEqual(result.npcs.map(({key}) => key), ["npc-1", "npc-2"]);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(progress, [
    {completed: 1, total: 2},
    {completed: 2, total: 2},
  ]);
  assert.equal(result.provenance.promptTemplateVersion, "2");
});

test("generator preserves valid NPCs when a targeted repair also fails", async () => {
  const invalid = modelNpc({
    fields: modelFields({appearance: "Carries directions to https://example.invalid/vault"}),
  });
  const calls = [];
  const generator = createGenerator(calls, [
    modelCastResponse([
      modelNpc({name: "Tella Reed", tokenLabel: "Tella"}),
      invalid,
    ]),
    modelNpcResponse(invalid),
  ]);

  const result = await generator.generate(createRequest({count: 2}));

  assert.equal(calls.length, 2);
  assert.equal(result.requestedCount, 2);
  assert.deepEqual(result.npcs.map(({slot, name}) => ({slot, name})), [
    {slot: 1, name: "Tella Reed"},
  ]);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].slot, 2);
  assert.equal(result.failures[0].code, "NPC_OUTPUT_INVALID");
  assert.match(result.failures[0].message, /must not contain URLs/);
});

test("generator performs one whole-batch repair only for an unreadable envelope", async () => {
  const calls = [];
  const generator = createGenerator(calls, [
    "not-json",
    modelCastResponse([modelNpc()]),
  ]);

  const result = await generator.generate(createRequest({count: 1}));

  assert.equal(calls.length, 2);
  assert.match(calls[1].messages.at(-1).content, /complete replacement/);
  assert.equal(result.npcs.length, 1);
  assert.equal(result.failures.length, 0);
});

test("generator targets a missing cast member without discarding earlier candidates", async () => {
  const calls = [];
  const generator = createGenerator(calls, [
    modelCastResponse([modelNpc({name: "First NPC", tokenLabel: "First"})]),
    modelNpcResponse(modelNpc({name: "Second NPC", tokenLabel: "Second"})),
  ]);

  const result = await generator.generate(createRequest({count: 2}));

  assert.equal(calls.length, 2);
  assert.match(calls[1].messages.at(-1).content, /INVALID_NPC_CANDIDATE:\nnull/);
  assert.deepEqual(result.npcs.map(({name}) => name), ["First NPC", "Second NPC"]);
});

test("generator retains earlier batches when the provider stops later", async () => {
  const fields = Array.from({length: 16}, (_, index) => ({
    id: `field-${index + 1}`,
    label: `Field ${index + 1}`,
    description: `Generate narrative field ${index + 1}.`,
  }));
  const calls = [];
  let invocation = 0;
  const provider = {
    model: "qwen3:4b-instruct",
    health: async () => ({status: "ready"}),
    chatStructured: async (request) => {
      calls.push(request);
      invocation += 1;
      if (invocation === 1) {
        return modelCastResponse([
          modelNpc({name: "First NPC", tokenLabel: "First", fields: modelFields({}, fields)}),
          modelNpc({name: "Second NPC", tokenLabel: "Second", fields: modelFields({}, fields)}),
          modelNpc({name: "Third NPC", tokenLabel: "Third", fields: modelFields({}, fields)}),
        ]);
      }
      throw new ProviderError("OLLAMA_TIMEOUT", "Ollama timed out", {retryable: true});
    },
  };
  let id = 0;
  const generator = new NpcGenerator({provider, idFactory: () => `application-id-${++id}`});

  const result = await generator.generate(createRequest({
    count: 4,
    fields,
    constraints: {existingNames: [], excludedThemes: []},
  }));

  assert.equal(calls.length, 2);
  assert.equal(result.npcs.length, 3);
  assert.deepEqual(result.failures.map(({slot}) => slot), [4]);
  assert.equal(result.failures[0].code, "OLLAMA_TIMEOUT");
});

test("batch planning enforces the small-model field-cell budget", () => {
  assert.deepEqual(planCastBatches(12, 8), [
    [1, 2, 3, 4, 5, 6],
    [7, 8, 9, 10, 11, 12],
  ]);
  assert.deepEqual(planCastBatches(4, 16), [[1, 2, 3], [4]]);
});

function createGenerator(calls, responses) {
  const queue = [...responses];
  const provider = {
    model: "qwen3:4b-instruct",
    health: async () => ({status: "ready", model: "qwen3:4b-instruct"}),
    chatStructured: async (request) => {
      calls.push(request);
      const response = queue.shift();
      assert.notEqual(response, undefined, "provider received an unexpected request");
      return response;
    },
  };
  let id = 0;
  return new NpcGenerator({
    provider,
    idFactory: () => `application-id-${++id}`,
  });
}

function createRequest(overrides = {}) {
  return validateGenerationRequest({
    schemaVersion: "2",
    requestId: "request-1",
    scene: {uuid: "Scene.scene-1", name: "Harbor Ward"},
    region: {uuid: null, name: "", description: ""},
    prompt: "Create residents tied to a missing caravan.",
    count: 1,
    fields: structuredClone(DEFAULT_FIELD_DEFINITIONS),
    controls: structuredClone(DEFAULT_CONTROL_DEFINITIONS),
    constraints: {
      existingNames: ["Existing Name"],
      excludedThemes: ["graphic violence"],
    },
    generation: {seed: 42},
    ...overrides,
  });
}

function modelNpc(overrides = {}) {
  return {
    name: "Tella Reed",
    tokenLabel: "Tella",
    fields: modelFields(),
    ...overrides,
  };
}

function modelFields(overrides = {}, definitions = DEFAULT_FIELD_DEFINITIONS) {
  return {
    ...Object.fromEntries(
      definitions.map(({id, label}) => [id, `${label} for this NPC.`]),
    ),
    ...overrides,
  };
}

function modelCastResponse(npcs) {
  return JSON.stringify({npcs});
}

function modelNpcResponse(npc) {
  return JSON.stringify({npc});
}
