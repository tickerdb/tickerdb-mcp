const API_BASE = "https://api.tickerdb.com/v1";

export interface ApiCallOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
}

export async function callTickerDb(
  apiKey: string,
  path: string,
  params?: Record<string, string | undefined>,
  options?: ApiCallOptions,
): Promise<{ status: number; data: unknown }> {
  const url = new URL(`${API_BASE}${path}`);

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const resp = await fetch(url.toString(), {
    method: options?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
  });

  const data = await resp.json();
  return { status: resp.status, data };
}
