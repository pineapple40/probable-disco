"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getJson, postJson } from "@/lib/api-client";
import { formatCurrency, formatPercent, formatCompactNumber } from "@/lib/format";

interface ScannerRow {
  symbol: string;
  name: string;
  last: number;
  changePct: number;
  volume: number;
  dayHigh: number;
  dayLow: number;
}

interface Preset {
  id: string;
  name: string;
  filters: Record<string, unknown>;
}

export default function ScannerPage() {
  const [filters, setFilters] = React.useState({
    minPrice: "",
    maxPrice: "",
    minChangePct: "",
    maxChangePct: "",
    minVolume: "",
  });
  const [presetName, setPresetName] = React.useState("");
  const queryClient = useQueryClient();

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);

  const { data, isLoading } = useQuery({
    queryKey: ["scanner", params.toString()],
    queryFn: () => getJson<ScannerRow[]>(`/api/scanner?${params.toString()}`),
    refetchInterval: 10000,
  });

  const { data: presets } = useQuery({
    queryKey: ["scanner-presets"],
    queryFn: () => getJson<Preset[]>("/api/scanner/presets"),
  });

  const savePreset = useMutation({
    mutationFn: () => postJson("/api/scanner/presets", { name: presetName, filters }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scanner-presets"] });
      setPresetName("");
    },
  });

  function applyPreset(preset: Preset) {
    setFilters({
      minPrice: String(preset.filters.minPrice ?? ""),
      maxPrice: String(preset.filters.maxPrice ?? ""),
      minChangePct: String(preset.filters.minChangePct ?? ""),
      maxChangePct: String(preset.filters.maxChangePct ?? ""),
      minVolume: String(preset.filters.minVolume ?? ""),
    });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Scanner</h1>
      <p className="text-xs text-slate-500">
        Scans the local simulated instrument universe. Only price, % change, and volume are
        supported by the simulated provider - fields like market cap or relative volume are not
        fabricated and are intentionally omitted.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div>
              <Label>Min price</Label>
              <Input
                type="number"
                value={filters.minPrice}
                onChange={(e) => setFilters((f) => ({ ...f, minPrice: e.target.value }))}
              />
            </div>
            <div>
              <Label>Max price</Label>
              <Input
                type="number"
                value={filters.maxPrice}
                onChange={(e) => setFilters((f) => ({ ...f, maxPrice: e.target.value }))}
              />
            </div>
            <div>
              <Label>Min % change</Label>
              <Input
                type="number"
                value={filters.minChangePct}
                onChange={(e) => setFilters((f) => ({ ...f, minChangePct: e.target.value }))}
              />
            </div>
            <div>
              <Label>Max % change</Label>
              <Input
                type="number"
                value={filters.maxChangePct}
                onChange={(e) => setFilters((f) => ({ ...f, maxChangePct: e.target.value }))}
              />
            </div>
            <div>
              <Label>Min volume</Label>
              <Input
                type="number"
                value={filters.minVolume}
                onChange={(e) => setFilters((f) => ({ ...f, minVolume: e.target.value }))}
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              placeholder="Preset name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              className="w-48"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!presetName || savePreset.isPending}
              onClick={() => savePreset.mutate()}
            >
              Save preset
            </Button>
            {presets?.map((p) => (
              <Button key={p.id} variant="ghost" size="sm" onClick={() => applyPreset(p)}>
                {p.name}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Results {data ? `(${data.length})` : ""}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-400">Scanning…</p>
          ) : !data || data.length === 0 ? (
            <p className="text-sm text-slate-500">No matches.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-400">
                <tr>
                  <th className="pb-2">Symbol</th>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Last</th>
                  <th className="pb-2">Change</th>
                  <th className="pb-2">Volume</th>
                  <th className="pb-2">Day range</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.symbol} className="border-t border-slate-800">
                    <td className="py-2 font-medium">
                      <Link href={`/charts?symbol=${row.symbol}`} className="hover:underline">
                        {row.symbol}
                      </Link>
                    </td>
                    <td className="py-2 text-slate-400">{row.name}</td>
                    <td className="py-2">{formatCurrency(row.last)}</td>
                    <td className={`py-2 ${row.changePct >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {formatPercent(row.changePct)}
                    </td>
                    <td className="py-2 text-slate-400">{formatCompactNumber(row.volume)}</td>
                    <td className="py-2 text-xs text-slate-400">
                      {formatCurrency(row.dayLow)} - {formatCurrency(row.dayHigh)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
