import { z } from "zod";

const conditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("price_above"), value: z.number().positive() }),
  z.object({ type: z.literal("price_below"), value: z.number().positive() }),
  z.object({ type: z.literal("pct_change_above"), value: z.number() }),
  z.object({ type: z.literal("pct_change_below"), value: z.number() }),
  z.object({ type: z.literal("sma_cross_above"), period: z.number().int().min(2).max(200) }),
  z.object({ type: z.literal("sma_cross_below"), period: z.number().int().min(2).max(200) }),
  z.object({ type: z.literal("ema_cross_above"), period: z.number().int().min(2).max(200) }),
  z.object({ type: z.literal("ema_cross_below"), period: z.number().int().min(2).max(200) }),
  z.object({ type: z.literal("rsi_above"), period: z.number().int().min(2).max(100).default(14), value: z.number().min(0).max(100) }),
  z.object({ type: z.literal("rsi_below"), period: z.number().int().min(2).max(100).default(14), value: z.number().min(0).max(100) }),
  z.object({ type: z.literal("price_above_vwap") }),
  z.object({ type: z.literal("price_below_vwap") }),
  z.object({ type: z.literal("time_after"), minutesFromOpen: z.number().int().min(0).max(390) }),
  z.object({ type: z.literal("time_before"), minutesFromOpen: z.number().int().min(0).max(390) }),
]);

export type Condition = z.infer<typeof conditionSchema>;

export const strategyDefinitionSchema = z.object({
  symbols: z.array(z.string().min(1).max(10)).min(1).max(10),
  maxTradesPerDay: z.number().int().min(1).max(50).default(5),
  positionSizing: z.discriminatedUnion("method", [
    z.object({ method: z.literal("fixed_quantity"), value: z.number().positive() }),
    z.object({ method: z.literal("fixed_notional"), value: z.number().positive() }),
  ]),
  entryRules: z.array(conditionSchema).min(1).max(10),
  exitRules: z.array(conditionSchema).max(10).default([]),
  stopLossPct: z.number().positive().max(50).optional(),
  takeProfitPct: z.number().positive().max(200).optional(),
});

export type StrategyDefinition = z.infer<typeof strategyDefinitionSchema>;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateStrategyDefinition(input: unknown): ValidationResult {
  const parsed = strategyDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return { valid: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const def = parsed.data;
  const errors: string[] = [];
  if (!def.stopLossPct) {
    errors.push("A stop-loss percentage is strongly recommended for every strategy (risk management).");
  }
  if (def.entryRules.length === 0) errors.push("At least one entry rule is required.");
  return { valid: errors.length === 0, errors };
}
