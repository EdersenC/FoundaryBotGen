import { ProviderError } from "./errors.mjs";

const MAX_PROVIDER_RESPONSE_BYTES = 1_048_576;
const MAX_GENERATED_CONTENT_BYTES = 524_288;
const JSON_SCHEMA_MODE = "json-schema";
const JSON_FALLBACK_MODE = "json";
const GRAMMAR_FAILURE_PATTERN = /failed to (?:initialize samplers|parse grammar)|grammar/i;

export class OllamaProvider {
  constructor({ baseUrl, model, timeoutMs, fetchImpl = globalThis.fetch }) {
    if (typeof fetchImpl !== "function") {
      throw new TypeError("A Fetch-compatible implementation is required");
    }
    this.baseUrl = baseUrl;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
    this.outputFormatMode = JSON_SCHEMA_MODE;
  }

  async health() {
    const deadline = createDeadline(undefined, Math.min(this.timeoutMs, 5_000));
    try {
      const response = await this.fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        signal: deadline.signal,
        headers: { Accept: "application/json" },
      });
      const body = await readBoundedJson(response, MAX_PROVIDER_RESPONSE_BYTES);
      if (!response.ok) {
        return {
          status: "unavailable",
          model: this.model,
          message: providerHttpMessage(response.status, body),
        };
      }
      const models = Array.isArray(body?.models) ? body.models : [];
      const configuredModel = models.find(
        (candidate) =>
          candidate?.name === this.model || candidate?.model === this.model,
      );
      if (!configuredModel) {
        return { status: "model-missing", model: this.model };
      }
      return {
        status: "ready",
        model: this.model,
        outputFormatMode: this.outputFormatMode,
        ...(typeof configuredModel.digest === "string"
          ? { modelDigest: configuredModel.digest }
          : {}),
      };
    } catch (error) {
      return {
        status: "unavailable",
        model: this.model,
        message: safeErrorMessage(error),
      };
    } finally {
      deadline.dispose();
    }
  }

  async chatStructured({
    messages,
    schema,
    seed,
    temperature,
    signal,
    onEvent = () => {},
  }) {
    const deadline = createDeadline(signal, this.timeoutMs);
    try {
      const initialMode = this.outputFormatMode;
      try {
        return await this.#chat({
          messages,
          format: initialMode === JSON_SCHEMA_MODE ? schema : "json",
          formatMode: initialMode,
          seed,
          temperature,
          signal: deadline.signal,
          onEvent,
        });
      } catch (error) {
        if (initialMode !== JSON_SCHEMA_MODE || !isGrammarFailure(error)) throw error;
        this.outputFormatMode = JSON_FALLBACK_MODE;
        onEvent({
          level: "warn",
          code: "ollama.schema-fallback",
          message: "Ollama rejected the JSON Schema grammar; retrying in compatible JSON mode.",
        });
        return await this.#chat({
          messages,
          format: "json",
          formatMode: JSON_FALLBACK_MODE,
          seed,
          temperature,
          signal: deadline.signal,
          onEvent,
        });
      }
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException("Generation cancelled", "AbortError");
      }
      if (deadline.timedOut()) {
        throw new ProviderError(
          "OLLAMA_TIMEOUT",
          `Ollama did not finish within ${this.timeoutMs}ms`,
          { retryable: true, cause: error },
        );
      }
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        "OLLAMA_UNAVAILABLE",
        "Could not reach the configured Ollama service",
        { retryable: true, cause: error },
      );
    } finally {
      deadline.dispose();
    }
  }

  async #chat({messages, format, formatMode, seed, temperature, signal, onEvent}) {
    const startedAt = Date.now();
    onEvent({
      level: "info",
      code: "ollama.request",
      message: formatMode === JSON_SCHEMA_MODE
        ? "Contacting Ollama with JSON Schema output enabled."
        : "Contacting Ollama in compatible JSON output mode.",
    });
    const response = await this.fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format,
        keep_alive: "5m",
        options: {
          num_ctx: 8_192,
          num_predict: 2_500,
          seed,
          temperature,
        },
        messages,
      }),
    });
    const body = await readBoundedJson(response, MAX_PROVIDER_RESPONSE_BYTES);
    if (!response.ok) {
      throw new ProviderError(
        "OLLAMA_HTTP_ERROR",
        providerHttpMessage(response.status, body),
        {
          retryable: response.status === 429 || response.status >= 500,
          providerStatus: response.status,
        },
      );
    }
    const content = body?.message?.content;
    if (typeof content !== "string") {
      throw new ProviderError(
        "OLLAMA_RESPONSE_INVALID",
        "Ollama returned no assistant content",
      );
    }
    if (Buffer.byteLength(content, "utf8") > MAX_GENERATED_CONTENT_BYTES) {
      throw new ProviderError(
        "OLLAMA_OUTPUT_TOO_LARGE",
        "Ollama generated content exceeds the configured output limit",
      );
    }
    onEvent({
      level: "info",
      code: "ollama.response",
      message: `Ollama returned output in ${formatDuration(Date.now() - startedAt)}.`,
    });
    return content;
  }
}

function isGrammarFailure(error) {
  return error instanceof ProviderError
    && error.code === "OLLAMA_HTTP_ERROR"
    && error.providerStatus === 400
    && GRAMMAR_FAILURE_PATTERN.test(error.message);
}

function formatDuration(milliseconds) {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

async function readBoundedJson(response, maxBytes) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ProviderError(
      "OLLAMA_RESPONSE_TOO_LARGE",
      "Ollama response exceeds the configured response limit",
    );
  }
  const text = await readBoundedText(response.body, maxBytes);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ProviderError(
      "OLLAMA_RESPONSE_INVALID",
      "Ollama returned malformed JSON",
      { cause: error },
    );
  }
}

async function readBoundedText(body, maxBytes) {
  if (!body || typeof body.getReader !== "function") {
    throw new ProviderError(
      "OLLAMA_RESPONSE_INVALID",
      "Ollama returned an unreadable response body",
    );
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > maxBytes) {
        await reader.cancel("response limit exceeded");
        throw new ProviderError(
          "OLLAMA_RESPONSE_TOO_LARGE",
          "Ollama response exceeds the configured response limit",
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function createDeadline(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let didTimeOut = false;
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }
  const timer = setTimeout(() => {
    didTimeOut = true;
    controller.abort(new DOMException("Provider timeout", "TimeoutError"));
  }, timeoutMs);

  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    dispose() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

function providerHttpMessage(status, body) {
  const providerMessage =
    typeof body?.error === "string"
      ? body.error
      : typeof body?.error?.message === "string"
        ? body.error.message
        : null;
  return providerMessage
    ? `Ollama request failed (${status}): ${providerMessage.slice(0, 500)}`
    : `Ollama request failed with HTTP ${status}`;
}

function safeErrorMessage(error) {
  if (error instanceof ProviderError) return error.message;
  if (error instanceof Error && error.name === "TimeoutError") {
    return "Ollama health check timed out";
  }
  return "Could not reach the configured Ollama service";
}
