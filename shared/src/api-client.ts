const API_BASE = "https://api.tickerdb.com/v1";

export interface ApiCallOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
}

// When running as a Cloudflare Worker, set this to env.TICKERDB so outbound API calls
// go through a service binding instead of HTTP fetch (which bypasses Worker routes on
// same-zone subrequests and hits the asset layer instead).
let _serviceBinding: { fetch: typeof fetch } | undefined;

export function initApiClient(binding: { fetch: typeof fetch } | undefined) {
  _serviceBinding = binding;
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

  const fetchFn = (_serviceBinding?.fetch.bind(_serviceBinding) ?? fetch) as typeof fetch;

  try {
    const resp = await fetchFn(url.toString(), {
      method: options?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
    });

    const contentType = resp.headers.get("content-type") ?? "";
    let data: unknown;

    if (contentType.includes("application/json")) {
      data = await resp.json();
    } else {
      const text = await resp.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = {
          error: {
            message:
              text.trim() || `TickerDB upstream returned a non-JSON response (${resp.status}).`,
          },
        };
      }
    }

    return { status: resp.status, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 503,
      data: {
        error: {
          message: `TickerDB upstream request failed: ${message}`,
        },
      },
    };
  }
}
