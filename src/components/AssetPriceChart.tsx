/**
 * Compact SVG asset price chart for the extension popup.
 * Rendering approach mirrors wartbunker AssetPriceChart (line + area + hover).
 */
import { useId, useMemo, useState } from "react";
import type {
  CandlePoint,
  ChartMode,
  TradePoint,
} from "../utils/assetChart";
import { computeChartStats, toChartSeries } from "../utils/assetChart";
import { formatDisplayNumber } from "../utils/numberDisplay";

const W = 360;
const H = 150;
const PAD = { top: 12, right: 10, bottom: 24, left: 48 };

type Props = {
  points: CandlePoint[] | TradePoint[];
  mode?: ChartMode;
  assetName?: string;
  intervalLabel?: string;
  loading?: boolean;
  error?: string | null;
  poolSpot?: number | null;
  note?: string | null;
};

function buildPath(
  series: { x: number; y: number }[],
  xScale: (x: number) => number,
  yScale: (y: number) => number,
): string {
  if (!series.length) return "";
  if (series.length === 1) {
    const x = xScale(series[0].x);
    const y = yScale(series[0].y);
    const x2 = Math.min(x + 20, W - PAD.right);
    return `M${x.toFixed(1)},${y.toFixed(1)} L${x2.toFixed(1)},${y.toFixed(1)}`;
  }
  return series
    .map((pt, i) => {
      const cmd = i === 0 ? "M" : "L";
      return `${cmd}${xScale(pt.x).toFixed(1)},${yScale(pt.y).toFixed(1)}`;
    })
    .join(" ");
}

export default function AssetPriceChart({
  points,
  mode = "candles",
  assetName = "Asset",
  intervalLabel = "",
  loading = false,
  error = null,
  poolSpot = null,
  note = null,
}: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const gradId = useId().replace(/:/g, "");

  const series = useMemo(() => toChartSeries(points, mode), [points, mode]);
  const stats = useMemo(
    () => computeChartStats(points, mode),
    [points, mode],
  );

  const plot = useMemo(() => {
    if (!series.length) return null;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const xMin = series[0].x;
    const xMax = series[series.length - 1].x;
    const yMin = Math.min(...series.map((p) => p.y));
    const yMax = Math.max(...series.map((p) => p.y));
    const yPad = (yMax - yMin) * 0.08 || yMax * 0.05 || 0.0001;
    const yLo = Math.max(0, yMin - yPad);
    const yHi = yMax + yPad;

    const xScale = (x: number) => {
      if (xMax === xMin) return PAD.left + innerW / 2;
      return PAD.left + ((x - xMin) / (xMax - xMin)) * innerW;
    };
    const yScale = (y: number) =>
      PAD.top + innerH - ((y - yLo) / (yHi - yLo || 1)) * innerH;

    const line = buildPath(series, xScale, yScale);
    const lastX = xScale(series[series.length - 1].x).toFixed(1);
    const firstX = xScale(series[0].x).toFixed(1);
    const baseY = yScale(yLo).toFixed(1);
    const area = `${line} L${lastX},${baseY} L${firstX},${baseY} Z`;

    const yTicks = [0, 0.5, 1].map((t) => {
      const val = yLo + (yHi - yLo) * (1 - t);
      return { val, y: yScale(val) };
    });

    const xTickCount = Math.min(3, series.length);
    const xTicks = Array.from({ length: xTickCount }, (_, i) => {
      const idx =
        xTickCount === 1
          ? 0
          : Math.round((i / (xTickCount - 1)) * (series.length - 1));
      const pt = series[idx];
      return { label: pt.label, x: xScale(pt.x) };
    });

    return { line, area, yTicks, xTicks, xScale, yScale, yLo };
  }, [series]);

  const changeColor =
    (stats?.change ?? 0) >= 0 ? "var(--defi-buy)" : "var(--defi-sell)";
  const hoverPt = hoverIdx != null ? series[hoverIdx] : null;

  if (loading) {
    return (
      <div className="defi-chart-shell">
        <p className="defi-empty">Loading chart…</p>
      </div>
    );
  }

  if (error && !series.length) {
    return (
      <div className="defi-chart-shell">
        <p className="defi-hint text-left mt-0 mb-0">{error}</p>
        {poolSpot != null && (
          <p className="defi-card-sub mt-1">
            Pool spot: {formatDisplayNumber(poolSpot)} WART / {assetName}
          </p>
        )}
      </div>
    );
  }

  if (!series.length || !plot || !stats) {
    return (
      <div className="defi-chart-shell">
        <p className="defi-empty">No chart data</p>
        <p className="defi-hint text-left mt-1 mb-0">
          Load a pool with trades, or wait for the chart index to sync.
        </p>
      </div>
    );
  }

  return (
    <div className="defi-chart-shell">
      <div className="defi-chart-header">
        <div>
          <div className="defi-chart-title">
            {mode === "candles" ? "OHLC close" : "Trade price"}
            {intervalLabel ? (
              <span className="defi-chart-interval"> · {intervalLabel}</span>
            ) : null}
          </div>
          <div className="defi-chart-price">
            {formatDisplayNumber(stats.last)}
            <span className="defi-chart-unit"> WART/{assetName}</span>
          </div>
        </div>
        <div className="defi-chart-change" style={{ color: changeColor }}>
          {stats.change >= 0 ? "+" : ""}
          {stats.change.toFixed(2)}%
        </div>
      </div>

      {(poolSpot != null || note) && (
        <div className="defi-chart-meta">
          {poolSpot != null && (
            <span>
              Pool spot {formatDisplayNumber(poolSpot)} WART/{assetName}
            </span>
          )}
          {note && <span className="defi-chart-note">{note}</span>}
        </div>
      )}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="defi-chart-svg"
        role="img"
        aria-label={`Price chart for ${assetName}`}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FDB913" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#FDB913" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {plot.yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={t.y}
              y2={t.y}
              stroke="rgba(63,63,70,0.8)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={PAD.left - 4}
              y={t.y + 3}
              textAnchor="end"
              fill="#71717a"
              fontSize="8"
              fontFamily="ui-monospace, monospace"
            >
              {formatDisplayNumber(t.val, { maxDecimals: 6 })}
            </text>
          </g>
        ))}
        <path d={plot.area} fill={`url(#${gradId})`} />
        <path
          d={plot.line}
          fill="none"
          stroke="#FDB913"
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {series.map((pt, idx) => (
          <circle
            key={idx}
            cx={plot.xScale(pt.x)}
            cy={plot.yScale(pt.y)}
            r={hoverIdx === idx ? 4.5 : 2.5}
            fill={hoverIdx === idx ? "#FDB913" : "#E79300"}
            stroke="#18181b"
            strokeWidth={1}
            className="cursor-pointer"
            onMouseEnter={() => setHoverIdx(idx)}
            onMouseLeave={() => setHoverIdx(null)}
          />
        ))}
        {hoverPt && (
          <line
            x1={plot.xScale(hoverPt.x)}
            y1={PAD.top}
            x2={plot.xScale(hoverPt.x)}
            y2={H - PAD.bottom}
            stroke="#c084fc"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
        {plot.xTicks.map((tick, i) => (
          <text
            key={i}
            x={tick.x}
            y={H - 6}
            textAnchor="middle"
            fill="#71717a"
            fontSize="7.5"
            fontFamily="ui-monospace, monospace"
          >
            {tick.label}
          </text>
        ))}
      </svg>

      {hoverPt && (
        <div className="defi-chart-hover">
          <span>{hoverPt.label}</span>
          <span className="defi-chart-hover-price">
            {formatDisplayNumber(hoverPt.y)} WART/{assetName}
          </span>
        </div>
      )}

      <div className="defi-chart-footer">
        <span>Low {formatDisplayNumber(stats.min)}</span>
        <span>
          {stats.count} pt{stats.count === 1 ? "" : "s"}
        </span>
        <span>High {formatDisplayNumber(stats.max)}</span>
      </div>
    </div>
  );
}
