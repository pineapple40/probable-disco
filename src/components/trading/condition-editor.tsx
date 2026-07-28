"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export type ConditionDraft = {
  type: string;
  value?: string;
  period?: string;
  minutesFromOpen?: string;
};

interface ConditionTypeDef {
  value: string;
  label: string;
  fields: string[];
}

const CONDITION_TYPES: ConditionTypeDef[] = [
  { value: "price_above", label: "Price above", fields: ["value"] },
  { value: "price_below", label: "Price below", fields: ["value"] },
  { value: "pct_change_above", label: "% change above", fields: ["value"] },
  { value: "pct_change_below", label: "% change below", fields: ["value"] },
  { value: "sma_cross_above", label: "Price crosses above SMA", fields: ["period"] },
  { value: "sma_cross_below", label: "Price crosses below SMA", fields: ["period"] },
  { value: "ema_cross_above", label: "Price crosses above EMA", fields: ["period"] },
  { value: "ema_cross_below", label: "Price crosses below EMA", fields: ["period"] },
  { value: "rsi_above", label: "RSI above", fields: ["period", "value"] },
  { value: "rsi_below", label: "RSI below", fields: ["period", "value"] },
  { value: "price_above_vwap", label: "Price above VWAP", fields: [] },
  { value: "price_below_vwap", label: "Price below VWAP", fields: [] },
  { value: "time_after", label: "Time after (min from open)", fields: ["minutesFromOpen"] },
  { value: "time_before", label: "Time before (min from open)", fields: ["minutesFromOpen"] },
];

export function conditionToPayload(c: ConditionDraft): Record<string, unknown> {
  const def = CONDITION_TYPES.find((t) => t.value === c.type)!;
  const payload: Record<string, unknown> = { type: c.type };
  if (def.fields.includes("value")) payload.value = Number(c.value ?? 0);
  if (def.fields.includes("period")) payload.period = Number(c.period ?? 14);
  if (def.fields.includes("minutesFromOpen")) payload.minutesFromOpen = Number(c.minutesFromOpen ?? 0);
  return payload;
}

export function ConditionEditor({
  conditions,
  onChange,
}: {
  conditions: ConditionDraft[];
  onChange: (next: ConditionDraft[]) => void;
}) {
  function update(index: number, patch: Partial<ConditionDraft>) {
    onChange(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }
  function remove(index: number) {
    onChange(conditions.filter((_, i) => i !== index));
  }
  function add() {
    onChange([...conditions, { type: "price_above", value: "0" }]);
  }

  return (
    <div className="space-y-2">
      {conditions.map((c, i) => {
        const def = CONDITION_TYPES.find((t) => t.value === c.type)!;
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-md bg-slate-800/50 p-2">
            <Select
              className="w-56"
              value={c.type}
              onChange={(e) => update(i, { type: e.target.value })}
            >
              {CONDITION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
            {def.fields.includes("period") && (
              <Input
                className="w-20"
                type="number"
                placeholder="period"
                value={c.period ?? ""}
                onChange={(e) => update(i, { period: e.target.value })}
              />
            )}
            {def.fields.includes("value") && (
              <Input
                className="w-24"
                type="number"
                placeholder="value"
                value={c.value ?? ""}
                onChange={(e) => update(i, { value: e.target.value })}
              />
            )}
            {def.fields.includes("minutesFromOpen") && (
              <Input
                className="w-24"
                type="number"
                placeholder="minutes"
                value={c.minutesFromOpen ?? ""}
                onChange={(e) => update(i, { minutesFromOpen: e.target.value })}
              />
            )}
            <button type="button" className="text-xs text-slate-500 hover:text-red-400" onClick={() => remove(i)}>
              Remove
            </button>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        Add condition
      </Button>
    </div>
  );
}
