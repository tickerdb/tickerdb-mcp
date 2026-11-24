/**
 * An API error as a tool result: the message first (what an agent reads), then the
 * whole error on a second line as JSON, so status, error type and the route's extras
 * (retry_after_seconds, credits_required, credit_balance, upgrade_url, buy_credits_url,
 * max_limit, requested_date ...) reach the agent instead of being dropped (audit K13).
 */
export function formatApiError(
  status: number,
  data: any,
): { isError: true; content: Array<{ type: "text"; text: string }> } {
  const errorObj = data?.error && typeof data.error === "object" ? data.error : undefined;
  let message: string;

  switch (status) {
    case 401:
      message = errorObj?.message ?? "Authentication failed. Check your API key.";
      break;
    case 402:
      message = errorObj?.message ?? "Your credits are used up. See get_account; paid plans can add credits.";
      break;
    case 403:
      message =
        errorObj?.message ??
        "Your plan does not include this. See https://tickerdb.com/pricing.";
      break;
    case 404:
      message = errorObj?.message ?? "Not found. Check the ticker, slug or id.";
      break;
    case 429:
      message = errorObj?.message ?? "Rate limit reached. Wait 10 seconds and retry; if it repeats, check get_account for credits left.";
      break;
    case 503:
      message = errorObj?.message ?? "Data temporarily unavailable. Retry in a minute.";
      break;
    default:
      message = errorObj?.message ?? `API error (${status})`;
  }

  const { message: _message, ...rest } = errorObj ?? {};
  const detail = { status, ...(typeof data === "string" && !errorObj ? { body: data } : {}), ...rest };
  return {
    isError: true,
    content: [{ type: "text", text: `${message}\nerror: ${JSON.stringify(detail)}` }],
  };
}
