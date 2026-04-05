export function formatApiError(
  status: number,
  data: any,
): { isError: true; content: Array<{ type: "text"; text: string }> } {
  const errorObj = data?.error;
  let message: string;

  switch (status) {
    case 401:
      message = "Authentication failed. Check your API key.";
      break;
    case 403:
      message =
        errorObj?.message ??
        "This endpoint requires a higher-tier plan. Upgrade at https://tickerdb.com/pricing";
      break;
    case 404:
      message = errorObj?.message ?? "Resource not found.";
      break;
    case 429:
      message = errorObj?.message ?? "Rate limit exceeded. Try again later.";
      break;
    case 503:
      message = errorObj?.message ?? "Data temporarily unavailable.";
      break;
    default:
      message = errorObj?.message ?? `API error (${status})`;
  }

  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}
