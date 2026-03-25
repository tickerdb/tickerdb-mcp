export interface ApiCallOptions {
    method?: "GET" | "POST";
    body?: unknown;
}
export declare function callTickerApi(apiKey: string, path: string, params?: Record<string, string | undefined>, options?: ApiCallOptions): Promise<{
    status: number;
    data: unknown;
}>;
//# sourceMappingURL=api-client.d.ts.map