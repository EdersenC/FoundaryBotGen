import {JOB_STATUS} from "./constants.mjs";

const JOBS_PATH = "v1/npc-generation-jobs";
const DEFAULT_TIMEOUT_MS = 30_000;

export class CompanionRequestError extends Error {
  constructor(message, {status = null, code = null, retryable = false, cause} = {}) {
    super(message, {cause});
    this.name = "CompanionRequestError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }

}

export class CompanionClient {
  #baseUrl;
  #pairingToken;
  #fetch;

  constructor({endpoint, pairingToken, fetchWithTimeout}) {
    this.#baseUrl = normalizeEndpoint(endpoint);
    this.#pairingToken = String(pairingToken ?? "").trim();
    if (!this.#pairingToken) throw new CompanionRequestError("A companion pairing token is required.");
    if (typeof fetchWithTimeout !== "function") {
      throw new TypeError("fetchWithTimeout must be a function.");
    }
    this.#fetch = fetchWithTimeout;
  }

  async health({signal} = {}) {
    const health = await this.#request("v1/health", {
      method: "GET",
      signal,
    }, {timeoutMs: 7_500});
    if (!health || typeof health !== "object" || !new Set(["ok", "degraded"]).has(health.status)) {
      throw new CompanionRequestError("The NPC companion returned an invalid health response.");
    }
    return health;
  }

  async queueGeneration(request, {signal} = {}) {
    const snapshot = await this.#request(JOBS_PATH, {
      method: "POST",
      body: JSON.stringify(request),
      signal,
    });
    assertJobSnapshot(snapshot, new Set([JOB_STATUS.queued, JOB_STATUS.running]));
    return snapshot;
  }

  async getGeneration(jobId, {signal} = {}) {
    const snapshot = await this.#request(`${JOBS_PATH}/${encodeURIComponent(assertJobId(jobId))}`, {
      method: "GET",
      signal,
    }, {timeoutMs: 15_000});
    assertJobSnapshot(snapshot);
    return snapshot;
  }

  async cancelGeneration(jobId, {signal} = {}) {
    const snapshot = await this.#request(`${JOBS_PATH}/${encodeURIComponent(assertJobId(jobId))}`, {
      method: "DELETE",
      signal,
    });
    assertJobSnapshot(snapshot);
    return snapshot;
  }

  async #request(path, requestInit, {timeoutMs = DEFAULT_TIMEOUT_MS} = {}) {
    const headers = new Headers(requestInit.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${this.#pairingToken}`);
    if (requestInit.body !== undefined) headers.set("Content-Type", "application/json");

    let response;
    try {
      response = await this.#fetch(
        new URL(path, this.#baseUrl).href,
        {...requestInit, headers},
        {timeoutMs},
      );
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new CompanionRequestError("The NPC companion could not be reached.", {cause: error});
    }

    const payload = await readJsonResponse(response);
    if (!response.ok) {
      const message = typeof payload?.error?.message === "string"
        ? payload.error.message
        : typeof payload?.message === "string"
          ? payload.message
          : `The NPC companion returned HTTP ${response.status}.`;
      throw new CompanionRequestError(message, {
        status: response.status,
        code: typeof payload?.error?.code === "string" ? payload.error.code : null,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    return payload;
  }
}

export function normalizeEndpoint(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch (error) {
    throw new CompanionRequestError("The companion endpoint must be a valid HTTP or HTTPS URL.", {cause: error});
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new CompanionRequestError("The companion endpoint must use HTTP or HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new CompanionRequestError("The companion endpoint cannot include credentials, a query, or a fragment.");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

function assertJobId(jobId) {
  const value = String(jobId ?? "").trim();
  if (!value || value.length > 200) throw new CompanionRequestError("The companion returned an invalid job ID.");
  return value;
}

function assertJobSnapshot(value, allowedStatuses) {
  if (!value || typeof value !== "object") {
    throw new CompanionRequestError("The companion returned an invalid job response.");
  }
  assertJobId(value.jobId);
  const knownStatuses = new Set(Object.values(JOB_STATUS));
  if (!knownStatuses.has(value.status) || (allowedStatuses && !allowedStatuses.has(value.status))) {
    throw new CompanionRequestError("The companion returned an unexpected job status.");
  }
}

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new CompanionRequestError("The NPC companion did not return JSON.", {status: response.status});
  }
  try {
    return await response.json();
  } catch (error) {
    throw new CompanionRequestError("The NPC companion returned malformed JSON.", {
      status: response.status,
      cause: error,
    });
  }
}
