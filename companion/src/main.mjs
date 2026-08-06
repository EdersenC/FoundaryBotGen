import { readConfig } from "./config.mjs";
import { loadCompanionEnvironment } from "./environment-file.mjs";
import { GenerationJobQueue } from "./job-queue.mjs";
import { createCompanionLogger } from "./logger.mjs";
import { NpcGenerator } from "./npc-generator.mjs";
import { OllamaProvider } from "./ollama-provider.mjs";
import { createCompanionServer } from "./server.mjs";

const environmentFile = await loadCompanionEnvironment();
const config = readConfig();
const logger = createCompanionLogger();
const provider = new OllamaProvider({
  baseUrl: config.ollamaUrl,
  model: config.ollamaModel,
  timeoutMs: config.requestTimeoutMs,
});
const generator = new NpcGenerator({ provider });
const jobQueue = new GenerationJobQueue({ generator, logger });
const server = createCompanionServer({ config, jobQueue, logger: console });

logger.event("info", "companion.configuration.loaded", {
  environmentFileLoaded: environmentFile.loaded,
  environmentFileKeysApplied: environmentFile.appliedKeys.length,
});
await listen(server, config.host, config.port);
logger.event("info", "companion.started", {
  endpoint: `http://${config.host}:${config.port}`,
  allowedOrigins: config.allowedOrigins.join(","),
  ollamaUrl: config.ollamaUrl,
  model: config.ollamaModel,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close((error) => {
      if (error) {
        console.error("Failed to close NPCBOT companion cleanly", error);
        process.exitCode = 1;
      }
    });
  });
}

function listen(httpServer, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      httpServer.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      httpServer.off("error", onError);
      resolve();
    };
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(port, host);
  });
}
