import assert from "node:assert/strict";
import test from "node:test";

import {placeNpcActors} from "../scripts/foundry/npc-persistence.mjs";

test("places one created Actor through Foundry's interactive placement flow", async () => {
  const original = {
    CONST: globalThis.CONST,
    canvas: globalThis.canvas,
    game: globalThis.game,
  };
  const scene = {
    id: "scene-1",
    canUserModify: () => true,
  };
  const tokenSources = [];
  const placementCalls = [];
  const actor = {
    async getTokenDocument(data, options) {
      tokenSources.push({data, options});
      return {
        toObject: () => ({actorId: "actor-1", ...data}),
      };
    },
  };

  globalThis.CONST = {USER_ROLES: {GAMEMASTER: 4}};
  globalThis.game = {
    system: {id: "dnd5e"},
    user: {
      hasRole: (role, exact) => role === 4 && exact === true,
      can: () => true,
    },
  };
  globalThis.canvas = {
    ready: true,
    scene,
    level: {id: "level-1"},
    tokens: {
      placeTokens: async (tokens) => {
        placementCalls.push(tokens);
        return tokens;
      },
    },
  };

  try {
    const placed = await placeNpcActors({actors: [actor], sceneId: scene.id});

    assert.deepEqual(tokenSources, [{
      data: {level: "level-1"},
      options: {parent: scene},
    }]);
    assert.deepEqual(placementCalls, [[{actorId: "actor-1", level: "level-1"}]]);
    assert.deepEqual(placed, [{actorId: "actor-1", level: "level-1"}]);
  } finally {
    globalThis.CONST = original.CONST;
    globalThis.canvas = original.canvas;
    globalThis.game = original.game;
  }
});
