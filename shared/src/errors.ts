export function formatApiError(
  status: number,
  data: any,
): { isError: true; content: Array<{ type: "text"; text: string }> } {
  const errorObj = data?.error;
  let message: string;

  switch (status) {
    case 401:
      message = errorObj?.message ?? "Authentication failed. Check your API key.";
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

  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}
