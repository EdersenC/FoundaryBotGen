import assert from "node:assert/strict";
import test from "node:test";

import { OllamaProvider } from "../src/ollama-provider.mjs";

test("Ollama adapter sends bounded structured chat requests", async () => {
  const requests = [];
  const provider = new OllamaProvider({
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen3:4b-instruct",
    timeoutMs: 5_000,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return Response.json({ message: { content: '{"npc":{}}' } });
    },
  });
  const schema = { type: "object", properties: { npc: { type: "object" } } };

  const content = await provider.chatStructured({
    messages: [{ role: "user", content: "Generate" }],
    schema,
    seed: 17,
    temperature: 0.2,
  });

  assert.equal(content, '{"npc":{}}');
  assert.equal(requests[0].url, "http://127.0.0.1:11434/api/chat");
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.model, "qwen3:4b-instruct");
  assert.equal(body.stream, false);
  assert.deepEqual(body.format, schema);
  assert.equal(body.options.seed, 17);
  assert.equal(body.options.temperature, 0.2);
  assert.equal(body.options.num_ctx, 8_192);
});

test("Ollama health reports the configured local model digest", async () => {
  const provider = new OllamaProvider({
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen3:4b-instruct",
    timeoutMs: 5_000,
    fetchImpl: async () => Response.json({
      models: [
        {
          name: "qwen3:4b-instruct",
          digest: "0123456789abcdef",
        },
      ],
    }),
  });

  assert.deepEqual(await provider.health(), {
    status: "ready",
    model: "qwen3:4b-instruct",
    outputFormatMode: "json-schema",
    modelDigest: "0123456789abcdef",
  });
});

test("Ollama adapter falls back to JSON mode when schema grammar initialization fails", async () => {
  const requests = [];
  const events = [];
  const responses = [
    Response.json({error: "failed to initialize samplers: failed to parse grammar"}, {status: 400}),
    Response.json({message: {content: '{"npc":{}}'}}),
  ];
  const provider = new OllamaProvider({
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen3:4b-instruct",
    timeoutMs: 5_000,
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return responses.shift();
    },
  });
  const schema = {type: "object", properties: {npc: {type: "object"}}};

  const content = await provider.chatStructured({
    messages: [{role: "user", content: "Generate"}],
    schema,
    seed: 17,
    temperature: 0.2,
    onEvent: (event) => events.push(event),
  });

  assert.equal(content, '{"npc":{}}');
  assert.deepEqual(requests.map(({format}) => format), [schema, "json"]);
  assert.equal(provider.outputFormatMode, "json");
  assert.ok(events.some(({code}) => code === "ollama.schema-fallback"));
});

test("Ollama adapter enforces generated-output and request deadlines", async () => {
  const oversizedProvider = new OllamaProvider({
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen3:4b-instruct",
    timeoutMs: 5_000,
    fetchImpl: async () => Response.json({
      message: { content: "x".repeat(524_289) },
    }),
  });
  await assert.rejects(
    () => oversizedProvider.chatStructured({
      messages: [],
      schema: {},
      seed: 1,
      temperature: 0,
    }),
    (error) => error.code === "OLLAMA_OUTPUT_TOO_LARGE",
  );

  const timedProvider = new OllamaProvider({
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen3:4b-instruct",
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });
  await assert.rejects(
    () => timedProvider.chatStructured({
      messages: [],
      schema: {},
      seed: 1,
      temperature: 0,
    }),
    (error) => error.code === "OLLAMA_TIMEOUT" && error.retryable === true,
  );
});
