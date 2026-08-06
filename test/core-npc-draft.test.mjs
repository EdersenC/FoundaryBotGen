import assert from "node:assert/strict";
import test from "node:test";

import {
  applyNpcReviewEdits,
  buildBiographyHtml,
  buildPublicBiographyHtml,
  createActorSource,
} from "../scripts/core/npc-draft.mjs";

function createDraft(overrides = {}) {
  return {
    id: "npc-1",
    key: "dock-clerk",
    name: "Mara Venn",
    tokenLabel: "Mara",
    socialRole: "Harbor clerk",
    occupation: "Records keeper",
    appearance: "Ink-stained sleeves",
    personalityTraits: ["Exacting", "Quietly compassionate"],
    ideal: "Every debt should be recorded.",
    bond: "Protects the night-shift porters.",
    flaw: "Cannot ignore a discrepancy.",
    mannerisms: ["Counts on her fingers"],
    motivations: ["Expose a smuggling route"],
    publicBiography: "A familiar face at the harbor office.",
    gmSecret: "She altered one manifest.",
    complication: "A supervisor suspects her.",
    faction: "Harbor Office",
    family: {members: [], relationships: []},
    tags: [],
    ...overrides,
  };
}

test("review edits normalize editable text without mutating the generated draft", () => {
  const draft = createDraft();

  const edited = applyNpcReviewEdits(draft, {
    name: "  Mara\nVenn  ",
    appearance: "  Blue coat\r\n\r\nSilver pin  ",
    personalityTraits: "  Patient\nObservant\nPatient  ",
    mannerisms: "Counts doors\nTaps her ring",
    ignoredField: "must not be copied",
  });

  assert.notStrictEqual(edited, draft);
  assert.equal(draft.name, "Mara Venn");
  assert.equal(edited.name, "Mara Venn");
  assert.equal(edited.appearance, "Blue coat\n\nSilver pin");
  assert.deepEqual(edited.personalityTraits, ["Patient", "Observant"]);
  assert.deepEqual(edited.mannerisms, ["Counts doors", "Taps her ring"]);
  assert.equal(Object.hasOwn(edited, "ignoredField"), false);
});

test("biography builders escape model and review text before producing HTML", () => {
  const draft = createDraft({
    socialRole: '<script>alert("role")</script>',
    appearance: "Tall & watchful\nCarries <keys>",
    personalityTraits: ["Patient & alert", "Avoids <arguments>"],
    publicBiography: "Known as <Mara> & trusted.",
  });

  const gmBiography = buildBiographyHtml(draft);
  const publicBiography = buildPublicBiographyHtml(draft);

  assert.doesNotMatch(gmBiography, /<script>/);
  assert.match(gmBiography, /&lt;script&gt;alert\(&quot;role&quot;\)&lt;\/script&gt;/);
  assert.match(gmBiography, /Tall &amp; watchful<br>Carries &lt;keys&gt;/);
  assert.match(gmBiography, /Patient &amp; alert/);
  assert.match(gmBiography, /Avoids &lt;arguments&gt;/);
  assert.match(gmBiography, /<section class="secret">/);
  assert.equal(publicBiography, "<p>Known as &lt;Mara&gt; &amp; trusted.</p>");
});

test("Actor source uses the dnd5e npc type and keeps module data namespaced", () => {
  const source = createActorSource(createDraft(), {
    folderId: "folder-1",
    moduleId: "foundry-npcbot",
    generation: {
      schemaVersion: "1",
      sceneUuid: "Scene.scene-1",
      regionUuid: null,
      jobId: "job-1",
      generatedAt: "2026-08-05T00:00:00.000Z",
      provenance: {provider: "ollama", model: "qwen3:4b-instruct"},
    },
  });

  assert.equal(source.type, "npc");
  assert.equal(source.folder, "folder-1");
  assert.equal(source.prototypeToken.actorLink, true);
  assert.equal(source.prototypeToken.name, "Mara");
  assert.equal(source.flags["foundry-npcbot"].sceneUuid, "Scene.scene-1");
  assert.equal(source.flags["foundry-npcbot"].provenance.model, "qwen3:4b-instruct");
  assert.equal(Object.hasOwn(source.flags["foundry-npcbot"].narrative, "gmSecret"), false);
  assert.equal(source.system.details.ideal, "Every debt should be recorded.");
});
