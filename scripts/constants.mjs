export const MODULE_ID = "foundry-npcbot";

export const SETTINGS = Object.freeze({
  companionEndpoint: "companionEndpoint",
  pairingToken: "pairingToken",
  generationDefaults: "generationDefaults",
});

export const DEFAULT_COMPANION_ENDPOINT = "http://127.0.0.1:43129";
export const DEFAULT_NPC_COUNT = 6;
export const MIN_NPC_COUNT = 1;
export const MAX_NPC_COUNT = 12;
export const POLL_INTERVAL_MS = 1000;

export const JOB_STATUS = Object.freeze({
  queued: "queued",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
});

export const MODULE_TEMPLATE_ROOT = `/modules/${MODULE_ID}/templates`;
