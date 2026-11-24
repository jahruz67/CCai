export function parseJson(rawBody: string): unknown | undefined {
  if (!rawBody.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return undefined;
  }
}

export function extractProviderError(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const body = data as { error?: unknown; message?: unknown };
  const nestedMessage = body.error && typeof body.error === "object"
    ? (body.error as { message?: unknown }).message
    : body.error;
  const message = nestedMessage ?? body.message;
  return typeof message === "string"
    ? message.trim().slice(0, 240) || undefined
    : undefined;
}
