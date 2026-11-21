export class AiProviderError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export class AiTimeoutError extends Error {
  public constructor() {
    super("The AI provider request timed out.");
    this.name = "AiTimeoutError";
  }
}

export class AiNetworkError extends Error {
  public constructor() {
    super("The AI provider could not be reached.");
    this.name = "AiNetworkError";
  }
}

export class AiRefusalError extends Error {
  public constructor() {
    super("The AI provider refused the request.");
    this.name = "AiRefusalError";
  }
}

export class AiIncompleteResponseError extends Error {
  public constructor(public readonly reason?: string) {
    super("The AI provider could not finish the response.");
    this.name = "AiIncompleteResponseError";
  }
}

export class AiAllModelsFailedError extends AiProviderError {
  public constructor(
    message: string,
    public readonly attempts: Array<{
      attempt: number;
      error: unknown;
      model: string;
      providerStyle: string;
    }>,
    lastStatus = 503,
  ) {
    super(message, lastStatus);
    this.name = "AiAllModelsFailedError";
  }
}
