"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getJson, postJson } from "@/lib/api-client";

interface JournalEntry {
  id: string;
  title: string;
  symbol: string | null;
  setupType: string | null;
  strategyName: string | null;
  confidence: number | null;
  mistakes: string | null;
  lessons: string | null;
  emotionalState: string | null;
  prePlan: string | null;
  postReview: string | null;
  tags: string[];
  createdAt: string;
}

export default function JournalPage() {
  const queryClient = useQueryClient();
  const [symbolFilter, setSymbolFilter] = React.useState("");
  const [form, setForm] = React.useState({
    title: "",
    symbol: "",
    setupType: "",
    strategyName: "",
    confidence: "3",
    prePlan: "",
    postReview: "",
    lessons: "",
    mistakes: "",
    emotionalState: "",
    tags: "",
  });

  const params = new URLSearchParams();
  if (symbolFilter) params.set("symbol", symbolFilter);

  const { data: entries, isLoading } = useQuery({
    queryKey: ["journal", symbolFilter],
    queryFn: () => getJson<JournalEntry[]>(`/api/journal?${params.toString()}`),
  });

  const createEntry = useMutation({
    mutationFn: () =>
      postJson("/api/journal", {
        ...form,
        confidence: Number(form.confidence),
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal"] });
      setForm({
        title: "",
        symbol: "",
        setupType: "",
        strategyName: "",
        confidence: "3",
        prePlan: "",
        postReview: "",
        lessons: "",
        mistakes: "",
        emotionalState: "",
        tags: "",
      });
    },
  });

  const deleteEntry = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/journal/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete.");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["journal"] }),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Trading journal</h1>

      <Card>
        <CardHeader>
          <CardTitle>New entry</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createEntry.mutate();
            }}
            className="grid grid-cols-1 gap-3 md:grid-cols-2"
          >
            <div>
              <Label>Title</Label>
              <Input
                required
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div>
              <Label>Symbol</Label>
              <Input
                value={form.symbol}
                onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))}
              />
            </div>
            <div>
              <Label>Setup type</Label>
              <Input
                value={form.setupType}
                onChange={(e) => setForm((f) => ({ ...f, setupType: e.target.value }))}
              />
            </div>
            <div>
              <Label>Strategy</Label>
              <Input
                value={form.strategyName}
                onChange={(e) => setForm((f) => ({ ...f, strategyName: e.target.value }))}
              />
            </div>
            <div>
              <Label>Confidence (1-5)</Label>
              <Input
                type="number"
                min={1}
                max={5}
                value={form.confidence}
                onChange={(e) => setForm((f) => ({ ...f, confidence: e.target.value }))}
              />
            </div>
            <div>
              <Label>Emotional state</Label>
              <Input
                value={form.emotionalState}
                onChange={(e) => setForm((f) => ({ ...f, emotionalState: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Pre-trade plan</Label>
              <Input
                value={form.prePlan}
                onChange={(e) => setForm((f) => ({ ...f, prePlan: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Post-trade review</Label>
              <Input
                value={form.postReview}
                onChange={(e) => setForm((f) => ({ ...f, postReview: e.target.value }))}
              />
            </div>
            <div>
              <Label>Lessons learned</Label>
              <Input
                value={form.lessons}
                onChange={(e) => setForm((f) => ({ ...f, lessons: e.target.value }))}
              />
            </div>
            <div>
              <Label>Mistakes</Label>
              <Input
                value={form.mistakes}
                onChange={(e) => setForm((f) => ({ ...f, mistakes: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Tags (comma-separated)</Label>
              <Input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={createEntry.isPending}>
                Save entry
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Label className="mb-0">Filter by symbol</Label>
        <Input
          className="w-32"
          value={symbolFilter}
          onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : !entries || entries.length === 0 ? (
        <p className="text-sm text-slate-500">No journal entries yet.</p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <Card key={entry.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">
                      {entry.title} {entry.symbol && <span className="text-slate-400">· {entry.symbol}</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(entry.createdAt).toLocaleString()}
                      {entry.setupType ? ` · ${entry.setupType}` : ""}
                      {entry.strategyName ? ` · ${entry.strategyName}` : ""}
                      {entry.confidence ? ` · confidence ${entry.confidence}/5` : ""}
                    </p>
                  </div>
                  <button
                    className="text-xs text-slate-500 hover:text-red-400"
                    onClick={() => deleteEntry.mutate(entry.id)}
                  >
                    Delete
                  </button>
                </div>
                {entry.prePlan && <p className="mt-2 text-sm text-slate-300">Plan: {entry.prePlan}</p>}
                {entry.postReview && (
                  <p className="mt-1 text-sm text-slate-300">Review: {entry.postReview}</p>
                )}
                {entry.lessons && <p className="mt-1 text-sm text-green-300">Lessons: {entry.lessons}</p>}
                {entry.mistakes && <p className="mt-1 text-sm text-red-300">Mistakes: {entry.mistakes}</p>}
                {entry.tags.length > 0 && (
                  <div className="mt-2 flex gap-1">
                    {entry.tags.map((tag) => (
                      <span key={tag} className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
