import { z } from "zod";

const filterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);

export const screenerFilterSchema = z.object({
  type: z
    .enum(["value", "change"])
    .optional()
    .describe("Use 'change' to compare the previous candle with the latest candle; otherwise use 'value'."),
  field: z
    .string()
    .describe("TickerDB schema field name, e.g. momentum_rsi_zone, sector, trend_ma20_slope."),
  op: z
    .enum(["eq", "neq", "in", "gt", "gte", "lt", "lte", "exists", "changed"])
    .optional()
    .describe("Filter operator. Use 'changed' with type='change'. Defaults to eq for value filters."),
  value: filterValueSchema
    .optional()
    .describe("Value for value filters. Use an array with op='in'."),
  from: z
    .union([z.string(), z.number(), z.boolean()])
    .optional()
    .describe("Previous candle value for type='change'."),
  to: z
    .union([z.string(), z.number(), z.boolean()])
    .optional()
    .describe("Latest candle value for type='change'."),
});

export const screenerSortSchema = z.object({
  field: z
    .string()
    .describe("TickerDB schema field to sort by, e.g. market_cap, volume_percentile."),
  direction: z
    .enum(["asc", "desc"])
    .optional()
    .describe("Sort direction. Defaults to desc."),
});
