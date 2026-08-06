import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import {
  ContractValidationError,
  GENERATION_SCHEMA_VERSION,
} from "../../shared/contracts/npc-generation.mjs";
import { HttpError } from "./errors.mjs";

const MAX_REQUEST_BODY_BYTES = 262_144;
const MAX_RESPONSE_BODY_BYTES = 1_048_576;
const JOB_ROUTE_PATTERN = /^\/v1\/npc-generation-jobs\/([^/]+)$/;

export function createCompanionServer({ config, jobQueue, logger = console }) {
  const requestHandler = createCompanionRequestHandler({
    config,
    jobQueue,
    logger,
  });
  const server = createServer(
    {
      headersTimeout: 10_000,
      requestTimeout: 15_000,
      keepAliveTimeout: 5_000,
      maxHeaderSize: 16_384,
    },
    (request, response) => {
      void requestHandler(request, response);
    },
  );

  server.on("clientError", (_error, socket) => {
    if (!socket.writable) return;
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  return server;
}

export function createCompanionRequestHandler({
  config,
  jobQueue,
  logger = console,
}) {
  const allowedOrigins = new Set(config.allowedOrigins);
  return async (request, response) => {
    try {
      await handleRequest({
        request,
        response,
        config,
        allowedOrigins,
        jobQueue,
      });
    } catch (error) {
      sendError(response, error, logger);
    }
  };
}

async function handleRequest({
  request,
  response,
  config,
  allowedOrigins,
  jobQueue,
}) {
  applyBaseHeaders(response);
  applyCors(request, response, allowedOrigins);

  if (request.method === "OPTIONS") {
    if (!request.headers.origin) {
      throw new HttpError(400, "ORIGIN_REQUIRED", "CORS preflight requires an Origin header");
    }
    response.statusCode = 204;
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.setHeader("Access-Control-Max-Age", "600");
    if (request.headers["access-control-request-private-network"] === "true") {
      response.setHeader("Access-Control-Allow-Private-Network", "true");
    }
    response.end();
    return;
  }

  authenticate(request, config.pairingToken);
  const url = new URL(request.url ?? "/", "http://companion.invalid");
  if (url.search) {
    throw new HttpError(400, "QUERY_NOT_ALLOWED", "Query parameters are not supported");
  }

  if (request.method === "GET" && url.pathname === "/v1/health") {
    const health = await jobQueue.health();
    sendJson(response, 200, {
      schemaVersion: GENERATION_SCHEMA_VERSION,
      ...health,
    });
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/v1/npc-generation-jobs"
  ) {
    requireJsonContentType(request);
    const body = await readJsonBody(request);
    sendJson(response, 202, jobQueue.submit(body));
    return;
  }

  const jobRoute = url.pathname.match(JOB_ROUTE_PATTERN);
  if (jobRoute) {
    const jobId = decodeJobId(jobRoute[1]);
    if (request.method === "GET") {
      sendJson(response, 200, jobQueue.get(jobId));
      return;
    }
    if (request.method === "DELETE") {
      sendJson(response, 200, jobQueue.cancel(jobId));
      return;
    }
  }

  throw new HttpError(404, "NOT_FOUND", "Endpoint not found");
}

function applyBaseHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function applyCors(request, response, allowedOrigins) {
  const origin = request.headers.origin;
  if (origin === undefined) return;
  response.setHeader("Vary", "Origin");
  if (typeof origin !== "string" || !allowedOrigins.has(origin)) {
    throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed");
  }
  response.setHeader("Access-Control-Allow-Origin", origin);
}

function authenticate(request, expectedToken) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    throw new HttpError(401, "UNAUTHORIZED", "A valid pairing token is required");
  }
  const receivedToken = authorization.slice("Bearer ".length);
  const receivedDigest = createHash("sha256").update(receivedToken).digest();
  const expectedDigest = createHash("sha256").update(expectedToken).digest();
  if (!timingSafeEqual(receivedDigest, expectedDigest)) {
    throw new HttpError(401, "UNAUTHORIZED", "A valid pairing token is required");
  }
}

function requireJsonContentType(request) {
  const contentType = request.headers["content-type"];
  const mediaType =
    typeof contentType === "string"
      ? contentType.split(";", 1)[0].trim().toLocaleLowerCase("en-US")
      : "";
  if (
    mediaType !== "application/json"
  ) {
    throw new HttpError(
      415,
      "CONTENT_TYPE_REQUIRED",
      "Content-Type must be application/json",
    );
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw new HttpError(
        413,
        "REQUEST_TOO_LARGE",
        "Request body exceeds the configured limit",
      );
    }
    chunks.push(buffer);
  }
  if (totalBytes === 0) {
    throw new HttpError(400, "INVALID_JSON", "Request body must contain JSON");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body contains malformed JSON");
  }
}

function decodeJobId(encodedJobId) {
  let jobId;
  try {
    jobId = decodeURIComponent(encodedJobId);
  } catch {
    throw new HttpError(400, "INVALID_JOB_ID", "Job ID is malformed");
  }
  if (
    !jobId ||
    jobId.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(jobId)
  ) {
    throw new HttpError(400, "INVALID_JOB_ID", "Job ID is malformed");
  }
  return jobId;
}

function sendJson(response, status, value) {
  if (response.headersSent) return;
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BODY_BYTES) {
    throw new HttpError(
      500,
      "RESPONSE_TOO_LARGE",
      "Response exceeds the configured limit",
    );
  }
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body, "utf8"));
  response.end(body);
}

function sendError(response, error, logger) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  if (error instanceof ContractValidationError) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_REQUEST",
        message: "Request does not match the generation contract",
        issues: error.issues,
      },
    });
    return;
  }
  if (error instanceof HttpError) {
    sendJson(response, error.status, {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }
  logger.error?.("Unhandled companion request error", error);
  sendJson(response, 500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "The companion encountered an unexpected error",
    },
  });
}
