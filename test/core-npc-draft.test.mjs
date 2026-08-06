import assert from "node:assert/strict";
import test from "node:test";

import {
  applyNpcReviewEdits,
  buildBiographyHtml,
  buildPublicBiographyHtml,
  createActorSource,
} from "../scripts/core/npc-draft.mjs";

const FIELDS = Object.freeze([
  {id: "role", label: "Social Role", description: "Place in society."},
  {id: "appearance", label: "Appearance", description: "Visible details."},
  {id: "secret", label: "GM Notes", description: "Private campaign notes."},
]);

function createDraft(overrides = {}) {
  return {
    id: "npc-id-1",
    key: "npc-1",
    slot: 1,
    name: "Mara Venn",
    tokenLabel: "Mara",
    fields: {
      role: "Harbor clerk",
      appearance: "Ink-stained sleeves",
      secret: "She altered one manifest.",
    },
    ...overrides,
  };
}

test("review edits normalize configured fields without mutating the generated draft", () => {
  const draft = createDraft();

  const edited = applyNpcReviewEdits(draft, {
    name: "  Mara\nVenn  ",
    tokenLabel: "  Clerk Mara ",
    fields: {
      role: "  Night clerk  ",
      appearance: "  Blue coat\r\n\r\nSilver pin  ",
      secret: " Keeps a copied ledger. ",
      ignored: "must not be copied",
    },
  }, FIELDS);

  assert.notStrictEqual(edited, draft);
  assert.equal(draft.name, "Mara Venn");
  assert.equal(edited.name, "Mara Venn");
  assert.equal(edited.tokenLabel, "Clerk Mara");
  assert.equal(edited.fields.appearance, "Blue coat\n\nSilver pin");
  assert.equal(Object.hasOwn(edited.fields, "ignored"), false);
});

test("biography builder escapes dynamic labels and reviewed values", () => {
  const draft = createDraft({
    fields: {
      role: '<script>alert("role")</script>',
      appearance: "Tall & watchful\nCarries <keys>",
      secret: "Known as <Mara> & trusted.",
    },
  });
  const unsafeDefinitions = [
    {...FIELDS[0], label: "Role <admin>"},
    ...FIELDS.slice(1),
  ];

  const biography = buildBiographyHtml(draft, unsafeDefinitions);

  assert.doesNotMatch(biography, /<script>/);
  assert.match(biography, /Role &lt;admin&gt;/);
  assert.match(biography, /&lt;script&gt;alert\(&quot;role&quot;\)&lt;\/script&gt;/);
  assert.match(biography, /Tall &amp; watchful<br>Carries &lt;keys&gt;/);
  assert.equal(buildPublicBiographyHtml(), "<p></p>");
});

test("Actor source uses dnd5e npc and snapshots dynamic definitions in flags", () => {
  const source = createActorSource(createDraft(), {
    folderId: "folder-1",
    moduleId: "foundry-npcbot",
    generation: {
      schemaVersion: "2",
      sceneUuid: "Scene.scene-1",
      regionUuid: null,
      jobId: "job-1",
      generatedAt: "2026-08-05T00:00:00.000Z",
      provenance: {provider: "ollama", model: "qwen3:4b-instruct"},
      fields: FIELDS,
      controls: [{
        id: "detail",
        label: "Detail",
        description: "Amount of detail.",
        type: "slider",
        value: 75,
      }],
    },
  });

  assert.equal(source.type, "npc");
  assert.equal(source.folder, "folder-1");
  assert.equal(source.prototypeToken.actorLink, true);
  assert.equal(source.prototypeToken.name, "Mara");
  assert.equal(source.flags["foundry-npcbot"].schemaVersion, "2");
  assert.equal(source.flags["foundry-npcbot"].definitions.fields[0].label, "Social Role");
  assert.equal(source.flags["foundry-npcbot"].definitions.controls[0].value, 75);
  assert.equal(source.flags["foundry-npcbot"].fields.secret, "She altered one manifest.");
  assert.equal(source.system.details.biography.public, "<p></p>");
});
