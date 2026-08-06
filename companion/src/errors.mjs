export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ProviderError extends Error {
  constructor(code, message, { retryable = false, cause, providerStatus = null } = {}) {
    super(message, { cause });
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
    this.providerStatus = providerStatus;
  }
}
