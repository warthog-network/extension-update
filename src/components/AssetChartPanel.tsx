import { useEffect, useState } from "react";
import AssetPriceChart from "./AssetPriceChart";
import {
  CHART_INTERVALS,
  loadAssetPriceChart,
  type CandlePoint,
  type ChartInterval,
  type ChartMode,
  type TradePoint,
} from "../utils/assetChart";

export default function AssetChartPanel({
  nodeUrl,
  hash,
  assetName,
}: {
  nodeUrl: string;
  hash: string;
  assetName: string;
}) {
  const [interval, setInterval] = useState<ChartInterval>("1h");
  const [mode, setMode] = useState<ChartMode>("candles");
  const [loading, setLoading] = useState(false);
  const [points, setPoints] = useState<CandlePoint[] | TradePoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [poolSpot, setPoolSpot] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    void loadAssetPriceChart(nodeUrl, hash, { mode, interval, n: 80 })
      .then((result) => {
        if (!live) return;
        setPoints(result.points);
        setError(result.points.length ? null : result.error);
        setNote(result.note);
        setPoolSpot(result.poolSpot);
        if (result.mode === "trades") setMode("trades");
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : "Failed to load chart");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [nodeUrl, hash, interval, mode, tick]);

  const intervalLabel =
    mode === "trades"
      ? "Trades"
      : CHART_INTERVALS.find((i) => i.id === interval)?.label || interval;

  return (
    <div className="defi-asset-chart">
      <div className="defi-subtabs">
        {CHART_INTERVALS.map((iv) => (
          <button
            key={iv.id}
            type="button"
            className={`defi-compact-btn ${
              interval === iv.id && mode === "candles"
                ? "defi-compact-btn-active"
                : ""
            }`}
            disabled={loading}
            onClick={() => {
              setMode("candles");
              setInterval(iv.id);
            }}
          >
            {iv.label}
          </button>
        ))}
        <button
          type="button"
          className={`defi-compact-btn ${
            mode === "trades" ? "defi-compact-btn-active" : ""
          }`}
          disabled={loading}
          onClick={() => setMode("trades")}
        >
          Trades
        </button>
        <button
          type="button"
          className="defi-compact-btn"
          disabled={loading}
          onClick={() => setTick((n) => n + 1)}
        >
          {loading ? "…" : "↻"}
        </button>
      </div>
      <AssetPriceChart
        points={points}
        mode={mode}
        assetName={assetName}
        intervalLabel={intervalLabel}
        loading={loading}
        error={error}
        note={note}
        poolSpot={poolSpot}
      />
    </div>
  );
}
