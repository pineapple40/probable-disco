"use client";

import * as React from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { CandleRow } from "@/hooks/useCandles";
import { sma, ema, rsi, vwap as vwapCalc } from "@/lib/indicators";

export interface IndicatorToggles {
  sma20: boolean;
  ema50: boolean;
  vwap: boolean;
  rsi: boolean;
}

export function PriceChart({
  candles,
  indicators,
}: {
  candles: CandleRow[];
  indicators: IndicatorToggles;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const candleSeriesRef = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = React.useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlaySeriesRef = React.useRef<Record<string, ISeriesApi<"Line">>>({});
  const rsiSeriesRef = React.useRef<ISeriesApi<"Line"> | null>(null);

  React.useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#cbd5e1" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: "#334155" },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      color: "#475569",
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeriesRef.current = volumeSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      overlaySeriesRef.current = {};
      rsiSeriesRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries || candles.length === 0) return;

    const times = candles.map((c) => Math.floor(new Date(c.ts).getTime() / 1000) as UTCTimestamp);
    candleSeries.setData(
      candles.map((c, i) => ({ time: times[i]!, open: c.open, high: c.high, low: c.low, close: c.close })),
    );
    volumeSeries.setData(
      candles.map((c, i) => ({
        time: times[i]!,
        value: Number(c.volume),
        color: c.close >= c.open ? "#16653480" : "#7f1d1d80",
      })),
    );

    const closes = candles.map((c) => c.close);
    const chart = chartRef.current;
    if (!chart) return;

    function upsertOverlay(key: string, values: Array<number | null>, color: string) {
      if (!chart) return;
      let series = overlaySeriesRef.current[key];
      if (!series) {
        series = chart.addSeries(LineSeries, { color, lineWidth: 2 });
        overlaySeriesRef.current[key] = series;
      }
      series.setData(
        values
          .map((v, i) => (v === null ? null : { time: times[i]!, value: v }))
          .filter((v): v is { time: UTCTimestamp; value: number } => v !== null),
      );
    }

    function removeOverlay(key: string) {
      const series = overlaySeriesRef.current[key];
      if (series && chart) {
        chart.removeSeries(series);
        delete overlaySeriesRef.current[key];
      }
    }

    if (indicators.sma20) upsertOverlay("sma20", sma(closes, 20), "#38bdf8");
    else removeOverlay("sma20");

    if (indicators.ema50) upsertOverlay("ema50", ema(closes, 50), "#f59e0b");
    else removeOverlay("ema50");

    if (indicators.vwap) {
      const vwapValues = vwapCalc(
        candles.map((c) => ({ open: c.open, high: c.high, low: c.low, close: c.close, volume: Number(c.volume) })),
      );
      upsertOverlay("vwap", vwapValues, "#a78bfa");
    } else removeOverlay("vwap");

    if (indicators.rsi) {
      if (!rsiSeriesRef.current) {
        rsiSeriesRef.current = chart.addSeries(
          LineSeries,
          { color: "#f472b6", lineWidth: 2 },
          1,
        );
      }
      const rsiValues = rsi(closes, 14);
      rsiSeriesRef.current.setData(
        rsiValues
          .map((v, i) => (v === null ? null : { time: times[i]!, value: v }))
          .filter((v): v is { time: UTCTimestamp; value: number } => v !== null),
      );
    } else if (rsiSeriesRef.current) {
      chart.removeSeries(rsiSeriesRef.current);
      rsiSeriesRef.current = null;
    }

    chart.timeScale().fitContent();
  }, [candles, indicators]);

  return <div ref={containerRef} className="h-[420px] w-full" />;
}
