export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    csrf?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const response = await fetch("/api" + path, {
    method: options.method || "GET",
    credentials: "same-origin",
    signal: options.signal,
    headers: {
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    let message = "Não foi possível completar a solicitação.";
    try {
      message = (await response.json()).error?.message || message;
    } catch {
      /* gateway may return a non-JSON error */
    }
    if (response.status === 401)
      window.dispatchEvent(new Event("auth:expired"));
    throw new ApiError(response.status, message);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
