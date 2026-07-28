export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const json: Envelope<T> = await res.json();
  if (!json.ok) {
    throw new ApiError(json.error?.code ?? "unknown_error", json.error?.message ?? "Request failed.", res.status);
  }
  return json.data as T;
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  const json: Envelope<T> = await res.json();
  if (!json.ok) {
    throw new ApiError(json.error?.code ?? "unknown_error", json.error?.message ?? "Request failed.", res.status);
  }
  return json.data as T;
}
