const API_BASE = "https://api.tickerdb.com/v1";
export async function callTickerDb(apiKey, path, params, options) {
    const url = new URL(`${API_BASE}${path}`);
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== "")
                url.searchParams.set(k, v);
        }
    }
    try {
        const resp = await fetch(url.toString(), {
            method: options?.method ?? "GET",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
        });
        const contentType = resp.headers.get("content-type") ?? "";
        let data;
        if (contentType.includes("application/json")) {
            data = await resp.json();
        }
        else {
            const text = await resp.text();
            try {
                data = JSON.parse(text);
            }
            catch {
                data = {
                    error: {
                        message: text.trim() || `TickerDB upstream returned a non-JSON response (${resp.status}).`,
                    },
                };
            }
        }
        return { status: resp.status, data };
    }
    catch (error) {
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
