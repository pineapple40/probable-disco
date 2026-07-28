"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ConditionEditor, conditionToPayload, type ConditionDraft } from "@/components/trading/condition-editor";
import { getJson, postJson, ApiError } from "@/lib/api-client";

interface StrategyVersion {
  id: string;
  version: number;
  isValid: boolean;
  validationErrors: string[] | null;
}
interface Strategy {
  id: string;
  name: string;
  description: string | null;
  status: string;
  versions: StrategyVersion[];
}

export default function StrategiesPage() {
  const queryClient = useQueryClient();
  const { data: strategies, isLoading } = useQuery({
    queryKey: ["strategies"],
    queryFn: () => getJson<Strategy[]>("/api/strategies"),
  });

  const [name, setName] = React.useState("");
  const [symbols, setSymbols] = React.useState("AAPL");
  const [sizingMethod, setSizingMethod] = React.useState<"fixed_quantity" | "fixed_notional">("fixed_quantity");
  const [sizingValue, setSizingValue] = React.useState("10");
  const [maxTradesPerDay, setMaxTradesPerDay] = React.useState("3");
  const [stopLossPct, setStopLossPct] = React.useState("2");
  const [takeProfitPct, setTakeProfitPct] = React.useState("4");
  const [entryRules, setEntryRules] = React.useState<ConditionDraft[]>([
    { type: "sma_cross_above", period: "20" },
  ]);
  const [exitRules, setExitRules] = React.useState<ConditionDraft[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const createStrategy = useMutation({
    mutationFn: () =>
      postJson("/api/strategies", {
        name,
        definition: {
          symbols: symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
          maxTradesPerDay: Number(maxTradesPerDay),
          positionSizing: { method: sizingMethod, value: Number(sizingValue) },
          entryRules: entryRules.map(conditionToPayload),
          exitRules: exitRules.map(conditionToPayload),
          stopLossPct: stopLossPct ? Number(stopLossPct) : undefined,
          takeProfitPct: takeProfitPct ? Number(takeProfitPct) : undefined,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategies"] });
      setName("");
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to create strategy."),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      postJson(`/api/strategies/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["strategies"] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to update status."),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Strategies</h1>
      <p className="text-xs text-slate-500">
        Rule-based, long-only strategies. All entry conditions must be true simultaneously to
        enter; any exit condition (or stop-loss/take-profit) closes the position.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>New strategy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Symbols (comma-separated)</Label>
              <Input value={symbols} onChange={(e) => setSymbols(e.target.value.toUpperCase())} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <Label>Position sizing</Label>
              <Select value={sizingMethod} onChange={(e) => setSizingMethod(e.target.value as never)}>
                <option value="fixed_quantity">Fixed quantity</option>
                <option value="fixed_notional">Fixed notional ($)</option>
              </Select>
            </div>
            <div>
              <Label>Sizing value</Label>
              <Input value={sizingValue} onChange={(e) => setSizingValue(e.target.value)} />
            </div>
            <div>
              <Label>Max trades/day</Label>
              <Input value={maxTradesPerDay} onChange={(e) => setMaxTradesPerDay(e.target.value)} />
            </div>
            <div>
              <Label>Stop-loss %</Label>
              <Input value={stopLossPct} onChange={(e) => setStopLossPct(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <Label>Take-profit %</Label>
              <Input value={takeProfitPct} onChange={(e) => setTakeProfitPct(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Entry rules (all must be true)</Label>
            <ConditionEditor conditions={entryRules} onChange={setEntryRules} />
          </div>
          <div>
            <Label>Exit rules (any triggers exit)</Label>
            <ConditionEditor conditions={exitRules} onChange={setExitRules} />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <Button
            disabled={!name || entryRules.length === 0 || createStrategy.isPending}
            onClick={() => {
              setError(null);
              createStrategy.mutate();
            }}
          >
            Create strategy
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : !strategies || strategies.length === 0 ? (
        <p className="text-sm text-slate-500">No strategies yet.</p>
      ) : (
        <div className="space-y-3">
          {strategies.map((s) => {
            const latest = s.versions[0];
            return (
              <Card key={s.id}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">
                        {s.name} <span className="text-xs text-slate-500">v{latest?.version}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        Status: <span className="text-slate-300">{s.status}</span> ·{" "}
                        {latest?.isValid ? (
                          <span className="text-green-400">valid</span>
                        ) : (
                          <span className="text-red-400">invalid</span>
                        )}
                      </p>
                      {!latest?.isValid && latest?.validationErrors && (
                        <ul className="mt-1 text-xs text-red-400">
                          {latest.validationErrors.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {s.status !== "ACTIVE" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setStatus.mutate({ id: s.id, status: "ACTIVE" })}
                        >
                          Activate
                        </Button>
                      )}
                      {s.status === "ACTIVE" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setStatus.mutate({ id: s.id, status: "PAUSED" })}
                        >
                          Pause
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setStatus.mutate({ id: s.id, status: "ARCHIVED" })}
                      >
                        Archive
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
