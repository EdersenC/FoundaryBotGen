import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("Foundry entrypoint registers and opens a Scene-bound generator", async () => {
  const applicationInstances = new Map();
  const onceHooks = new Map();
  const hooks = new Map();
  const settings = new Map();
  const menus = new Map();

  class ApplicationV2 {
    constructor(options = {}) {
      this.options = options;
      this.rendered = false;
    }

    async _prepareContext() {
      return {};
    }

    async _onRender() {}

    _onClose() {}

    _canRender() {}

    render() {
      this.rendered = true;
      applicationInstances.set(this.constructor.DEFAULT_OPTIONS.id, this);
      return Promise.resolve(this);
    }

    async close() {
      this._onClose({});
      this.rendered = false;
      applicationInstances.delete(this.constructor.DEFAULT_OPTIONS.id);
      return this;
    }

    bringToFront() {
      this.broughtToFront = true;
    }
  }

  globalThis.foundry = {
    applications: {
      api: {
        ApplicationV2,
        HandlebarsApplicationMixin: (Base) => class extends Base {},
      },
      instances: applicationInstances,
    },
    utils: {
      fetchWithTimeout: globalThis.fetch,
      randomID: () => "request-id",
    },
  };
  globalThis.Hooks = {
    once: (name, callback) => onceHooks.set(name, callback),
    on: (name, callback) => hooks.set(name, callback),
  };
  globalThis.CONST = {
    TOKEN_DISPLAY_MODES: {HOVER: 20},
    USER_ROLES: {GAMEMASTER: 4},
  };
  globalThis.ui = {
    notifications: {error: () => {}, info: () => {}, warn: () => {}},
  };

  const user = {
    hasRole: (role, exact) => role === 4 && exact === true,
    can: () => true,
  };
  globalThis.game = {
    actors: {contents: []},
    folders: [],
    i18n: {
      format: (key) => key,
      localize: (key) => key,
    },
    scenes: {get: (id) => globalThis.canvas.scene?.id === id ? globalThis.canvas.scene : null},
    settings: {
      get: (namespace, key) => settings.get(`${namespace}.${key}`)?.default,
      register: (namespace, key, config) => settings.set(`${namespace}.${key}`, config),
      registerMenu: (namespace, key, config) => menus.set(`${namespace}.${key}`, config),
      set: async () => {},
    },
    system: {id: "dnd5e"},
    user,
  };
  globalThis.canvas = {
    ready: true,
    scene: createScene("scene-1", "Harbor Ward"),
  };

  const module = await import(`../scripts/main.mjs?smoke=${Date.now()}`);
  const {NpcGeneratorApp} = await import(`../scripts/apps/npc-generator-app.mjs?smoke=${Date.now()}`);
  assert.equal(typeof onceHooks.get("init"), "function");
  onceHooks.get("init")();

  assert.equal(settings.size, 3);
  assert.equal(menus.size, 1);
  assert.equal(typeof hooks.get("getSceneControlButtons"), "function");
  assert.equal(typeof NpcGeneratorApp.DEFAULT_OPTIONS.actions.placeActor, "function");

  const template = await readFile(new URL("../templates/npc-generator.hbs", import.meta.url), "utf8");
  assert.match(template, /data-action="placeActor"/);
  assert.match(template, /data-actor-id="{{id}}"/);

  const controls = {tokens: {tools: {select: {name: "select"}}}};
  hooks.get("getSceneControlButtons")(controls);
  assert.equal(controls.tokens.tools.npcbotGenerator.visible, true);

  const first = await module.openNpcGenerator();
  assert.equal(first.sceneId, "scene-1");

  globalThis.canvas.scene = createScene("scene-2", "Old Forest");
  const second = await module.openNpcGenerator();
  assert.notEqual(second, first);
  assert.equal(second.sceneId, "scene-2");
  assert.equal(first.rendered, false);
});

function createScene(id, name) {
  return {
    id,
    name,
    regions: {contents: [], get: () => null},
    uuid: `Scene.${id}`,
  };
}
