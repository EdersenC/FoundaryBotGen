import assert from "node:assert/strict";
import test from "node:test";

import {
  ContractValidationError,
  DEFAULT_CONTROLS,
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

test("request validation returns a normalized defensive copy", () => {
  const request = createGenerationRequest({prompt: "  Generate careful residents.  "});

  const validated = validateGenerationRequest(request);

  assert.notStrictEqual(validated, request);
  assert.equal(validated.prompt, "Generate careful residents.");
  assert.deepEqual(validated.controls, DEFAULT_CONTROLS);
  assert.equal(validated.generation.seed, 42);
});

test("the module request builder supports a Scene without an optional Region", () => {
  const request = buildGenerationRequest({
    requestId: "request-1",
    scene: {uuid: "Scene.scene-1", name: "Harbor Ward"},
    region: null,
    prompt: "Generate residents.",
    count: 2,
    controls: DEFAULT_CONTROLS,
    existingNames: ["Goblin", "goblin", "  Harbor Mage  ", "Harbor Mage"],
    seed: 42,
  });

  assert.deepEqual(request.region, {uuid: null, name: "", description: ""});
  assert.equal(request.generation.seed, 42);
  assert.deepEqual(request.constraints.existingNames, ["Goblin", "Harbor Mage"]);
});

test("the module request builder applies canonical text limits before validation", () => {
  const request = buildGenerationRequest({
    requestId: "request-1",
    scene: {uuid: "Scene.scene-1", name: "Harbor Ward"},
    region: {uuid: null, name: "", description: "r".repeat(5_000)},
    prompt: "p".repeat(10_000),
    count: 1,
    controls: DEFAULT_CONTROLS,
  });

  assert.equal(request.region.description.length, GENERATION_LIMITS.regionDescription);
  assert.equal(request.prompt.length, GENERATION_LIMITS.prompt);
});

test("draft validation rejects HTML and unknown properties", () => {
  const draft = createNpcDraft({
    appearance: "<strong>Untrusted model markup</strong>",
    unrecognized: "must not cross the boundary",
  });

  assert.throws(
    () => validateNpcDraft(draft),
    (error) => error instanceof ContractValidationError
      && error.issues.some(({path}) => path === "$.appearance")
      && error.issues.some(({path}) => path === "$.unrecognized"),
  );
});

test("draft validation rejects URLs and Foundry active-content syntax", () => {
  const draft = createNpcDraft({
    appearance: "Carries a note pointing to https://example.invalid/secret",
    gmSecret: "Trigger @Macro[OpenTheVault] when confronted.",
    publicBiography: "Usually settles disputes with [[/roll 1d20]].",
  });

  assert.throws(
    () => validateNpcDraft(draft),
    (error) => error instanceof ContractValidationError
      && error.issues.some(({path, message}) => path === "$.appearance" && /URLs/.test(message))
      && error.issues.some(({path, message}) => path === "$.gmSecret" && /Foundry enrichers/.test(message))
      && error.issues.some(({path, message}) => path === "$.publicBiography" && /Foundry enrichers/.test(message)),
  );
});

test("draft validation rejects dangling and cyclic family relationships", () => {
  const draft = createNpcDraft({
    family: {
      members: [
        {key: "a", name: "A", description: "First relative"},
        {key: "b", name: "B", description: "Second relative"},
      ],
      relationships: [
        {fromKey: "a", toKey: "b", type: "parentOf"},
        {fromKey: "b", toKey: "a", type: "parentOf"},
        {fromKey: "a", toKey: "missing", type: "siblingOf"},
      ],
    },
  });

  assert.throws(
    () => validateNpcDraft(draft),
    (error) => error instanceof ContractValidationError
      && error.issues.some(({message}) => /must reference a family member/.test(message))
      && error.issues.some(({message}) => /must be acyclic/.test(message)),
  );
});

test("result validation enforces unique names and token labels", () => {
  const duplicate = createNpcDraft({id: "npc-2", key: "night-clerk"});

  assert.throws(
    () => validateGenerationResult(createGenerationResult([createNpcDraft(), duplicate])),
    (error) => error instanceof ContractValidationError
      && error.issues.some(({path}) => path === "$.npcs[1].name")
      && error.issues.some(({path}) => path === "$.npcs[1].tokenLabel"),
  );
});

test("result validation preserves array-valued narrative fields", () => {
  const result = validateGenerationResult(createGenerationResult());

  assert.deepEqual(result.npcs[0].personalityTraits, ["Exacting", "Quietly compassionate"]);
  assert.deepEqual(result.npcs[0].mannerisms, ["Counts on her fingers", "Straightens nearby papers"]);
  assert.deepEqual(result.npcs[0].motivations, ["Expose a smuggling route"]);
});
