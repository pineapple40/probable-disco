import { z } from "zod";

export const placeOrderSchema = z
  .object({
    symbol: z.string().min(1).max(10),
    side: z.enum(["BUY", "SELL"]),
    type: z.enum(["MARKET", "LIMIT", "STOP", "STOP_LIMIT"]),
    quantity: z.coerce.number().positive().max(1_000_000),
    duration: z.enum(["DAY", "GTC"]).default("DAY"),
    limitPrice: z.coerce.number().positive().optional(),
    stopPrice: z.coerce.number().positive().optional(),
    stopLossPrice: z.coerce.number().positive().optional(),
    takeProfitPrice: z.coerce.number().positive().optional(),
    isExtendedHours: z.boolean().default(false),
    idempotencyKey: z.string().min(8).max(200),
  })
  .refine((v) => (v.type === "LIMIT" || v.type === "STOP_LIMIT" ? v.limitPrice !== undefined : true), {
    message: "limitPrice is required for LIMIT and STOP_LIMIT orders.",
    path: ["limitPrice"],
  })
  .refine((v) => (v.type === "STOP" || v.type === "STOP_LIMIT" ? v.stopPrice !== undefined : true), {
    message: "stopPrice is required for STOP and STOP_LIMIT orders.",
    path: ["stopPrice"],
  });

export type PlaceOrderRequest = z.infer<typeof placeOrderSchema>;
