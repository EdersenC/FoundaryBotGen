import assert from "node:assert/strict";
import test from "node:test";

import {
  createControlDefinition,
  createFieldDefinition,
  normalizeStoredControlDefinitions,
  normalizeStoredFieldDefinitions,
  readControlDefinitions,
  readFieldDefinitions,
} from "../scripts/core/generation-definitions.mjs";

test("stored v1 slider values migrate into editable v2 control definitions", () => {
  const controls = normalizeStoredControlDefinitions({
    detail: 85,
    familyDepth: 20,
    magic: 0,
  });

  assert.equal(controls.find(({id}) => id === "detail").value, 85);
  assert.equal(controls.find(({id}) => id === "family-depth").value, 20);
  assert.equal(controls.find(({id}) => id === "magic").value, 0);
  assert.equal(controls.find(({id}) => id === "additional-direction").type, "text");
});

test("stored definitions retain stable IDs when visible labels change", () => {
  const fields = normalizeStoredFieldDefinitions([
    {id: "stable-field", label: "Original Label", description: "Original guidance."},
  ]);
  fields[0].label = "Renamed Label";

  const normalized = normalizeStoredFieldDefinitions(fields);

  assert.equal(normalized[0].id, "stable-field");
  assert.equal(normalized[0].label, "Renamed Label");
});

test("form readers support slider and text control values", () => {
  const data = new FormData();
  data.set("fields.0.id", "role");
  data.set("fields.0.label", "Social Role");
  data.set("fields.0.description", "Place in society.");
  data.set("controls.0.id", "danger");
  data.set("controls.0.label", "Danger");
  data.set("controls.0.description", "Threat level.");
  data.set("controls.0.type", "slider");
  data.set("controls.0.value", "101");
  data.set("controls.1.id", "tone");
  data.set("controls.1.label", "Tone");
  data.set("controls.1.description", "Style guidance.");
  data.set("controls.1.type", "text");
  data.set("controls.1.value", "  Quiet political tension.  ");

  assert.deepEqual(readFieldDefinitions(data), [
    {id: "role", label: "Social Role", description: "Place in society."},
  ]);
  assert.deepEqual(readControlDefinitions(data), [
    {
      id: "danger",
      label: "Danger",
      description: "Threat level.",
      type: "slider",
      value: 100,
    },
    {
      id: "tone",
      label: "Tone",
      description: "Style guidance.",
      type: "text",
      value: "Quiet political tension.",
    },
  ]);
});

test("new definition factories choose unique stable IDs", () => {
  const fields = [{id: "field"}, {id: "field-2"}];
  const controls = [{id: "control"}];

  assert.equal(createFieldDefinition(fields).id, "field-3");
  assert.equal(createControlDefinition(controls).id, "control-2");
});
