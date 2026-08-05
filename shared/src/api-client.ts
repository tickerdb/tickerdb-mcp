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

const MAX_ERROR_BODY_CHARS = 500;

/**
 * Turn a non-JSON upstream body into something an agent can act on. An HTML body
 * means the request never reached the API handler, so say that instead of piping
 * a full web page back through the tool result.
 */
function describeNonJsonBody(text: string, status: number): string {
  const trimmed = text.trim();

  if (!trimmed) {
    return `TickerDB upstream returned an empty non-JSON response (${status}).`;
  }

  if (/^\s*<(!doctype|html)/i.test(trimmed)) {
    return `TickerDB returned an HTML page instead of JSON (${status}). The request did not reach the API. This is a server-side fault — retry, and report it at https://github.com/tickerdb/tickerdb-mcp/issues if it persists.`;
  }

  return trimmed.length > MAX_ERROR_BODY_CHARS
    ? `${trimmed.slice(0, MAX_ERROR_BODY_CHARS)}… (truncated, ${status})`
    : trimmed;
}

export async function callTickerDb(
  apiKey: string,
  path: string,
  params?: Record<string, string | undefined>,
  options?: ApiCallOptions,
): Promise<{ status: number; data: unknown }> {
  if (!apiKey) {
    return {
      status: 401,
      data: {
        error: {
          message:
            "TICKERDB_KEY is required to call TickerDB tools. Get one at https://tickerdb.com/dashboard.",
        },
      },
    };
  }

  if (!apiKey.startsWith("tdb_")) {
    return {
      status: 401,
      data: {
        error: {
          message:
            "Invalid TICKERDB_KEY format. Keys start with tdb_. Get one at https://tickerdb.com/dashboard.",
        },
      },
    };
  }

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
        data = { error: { message: describeNonJsonBody(text, resp.status) } };
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
