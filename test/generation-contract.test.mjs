import assert from "node:assert/strict";
import test from "node:test";

import {
  ContractValidationError,
  DEFAULT_CONTROL_DEFINITIONS,
  DEFAULT_FIELD_DEFINITIONS,
  GENERATION_LIMITS,
  validateGenerationRequest,
  validateGenerationResult,
  validateNpcDraft,
} from "../shared/generation-contract.mjs";
import {buildGenerationRequest} from "../scripts/contracts/npc-generation-contract.mjs";
import {
  createGenerationRequest,
  createGenerationResult,
  createNpcDraft,
} from "./fixtures/generation.mjs";

test("request validation returns normalized defensive definition snapshots", () => {
  const request = createGenerationRequest({prompt: "  Generate careful residents.  "});

  const validated = validateGenerationRequest(request);

  assert.notStrictEqual(validated, request);
  assert.equal(validated.prompt, "Generate careful residents.");
  assert.deepEqual(validated.fields, DEFAULT_FIELD_DEFINITIONS);
  assert.deepEqual(validated.controls, DEFAULT_CONTROL_DEFINITIONS);
  assert.equal(validated.generation.seed, 42);
});

test("module request builder supports a Scene without an optional Region", () => {
  const request = buildGenerationRequest({
    requestId: "request-1",
    scene: {uuid: "Scene.scene-1", name: "Harbor Ward"},
    region: null,
    prompt: "Generate residents.",
    count: 2,
    fields: DEFAULT_FIELD_DEFINITIONS,
    controls: DEFAULT_CONTROL_DEFINITIONS,
    existingNames: ["Goblin", "goblin", "  Harbor Mage  ", "Harbor Mage"],
    seed: 42,
  });

  assert.deepEqual(request.region, {uuid: null, name: "", description: ""});
  assert.equal(request.generation.seed, 42);
  assert.deepEqual(request.constraints.existingNames, ["Goblin", "Harbor Mage"]);
});

test("module request builder applies canonical prompt limits before validation", () => {
  const request = buildGenerationRequest({
    requestId: "request-1",
    scene: {uuid: "Scene.scene-1", name: "Harbor Ward"},
    region: {uuid: null, name: "", description: "r".repeat(5_000)},
    prompt: "p".repeat(10_000),
    count: 1,
    fields: DEFAULT_FIELD_DEFINITIONS,
    controls: DEFAULT_CONTROL_DEFINITIONS,
  });

  assert.equal(request.region.description.length, GENERATION_LIMITS.regionDescription);
  assert.equal(request.prompt.length, GENERATION_LIMITS.prompt);
});

test("dynamic draft validation rejects HTML, URLs, and unknown field IDs", () => {
  const draft = createNpcDraft({
    fields: {
      ...createNpcDraft().fields,
      appearance: "Carries directions to https://example.invalid/vault",
      "gm-notes": "Invokes @Macro[OpenVault].",
      unexpected: "must not cross the boundary",
    },
  });

  assert.throws(
    () => validateNpcDraft(draft, DEFAULT_FIELD_DEFINITIONS),
    (error) => error instanceof ContractValidationError
      && error.issues.some(({path, message}) => path === "$.fields.appearance" && /URLs/.test(message))
      && error.issues.some(({path, message}) => path === "$.fields.gm-notes" && /Foundry enrichers/.test(message))
      && error.issues.some(({path}) => path === "$.fields.unexpected"),
  );
});

test("definition validation rejects duplicate IDs and labels", () => {
  const request = createGenerationRequest({
    fields: [
      {id: "role", label: "Role", description: "First field."},
      {id: "role", label: "ROLE", description: "Second field."},
    ],
  });

  assert.throws(
    () => validateGenerationRequest(request),
    (error) => error instanceof ContractValidationError
      && error.issues.some(({path}) => path === "$.fields[1].id")
      && error.issues.some(({path}) => path === "$.fields[1].label"),
  );
});

test("result validation accepts partial success only when every slot is accounted for", () => {
  const result = validateGenerationResult(createGenerationResult(
    [createNpcDraft()],
    {
      requestedCount: 2,
      failures: [{slot: 2, code: "NPC_OUTPUT_INVALID", message: "Slot 2 failed validation."}],
    },
  ));

  assert.equal(result.npcs.length, 1);
  assert.equal(result.failures[0].slot, 2);

  assert.throws(
    () => validateGenerationResult(createGenerationResult(
      [createNpcDraft()],
      {requestedCount: 2, failures: []},
    )),
    /account for every requested slot/,
  );
});

test("result validation enforces unique names and token labels", () => {
  const duplicate = createNpcDraft({id: "npc-id-2", key: "npc-2", slot: 2});

  assert.throws(
    () => validateGenerationResult(createGenerationResult([createNpcDraft(), duplicate])),
    (error) => error instanceof ContractValidationError
      && error.issues.some(({path}) => path === "$.npcs[1].name")
      && error.issues.some(({path}) => path === "$.npcs[1].tokenLabel"),
  );
});

test("result validation preserves definition-keyed narrative values", () => {
  const result = validateGenerationResult(createGenerationResult());

  assert.equal(result.npcs[0].fields.personality, "Personality for the harbor clerk.");
  assert.equal(result.fields.find(({id}) => id === "family-tree").label, "Family Tree");
});
