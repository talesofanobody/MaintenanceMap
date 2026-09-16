import type { ReactNode } from "react";

/**
 * Small inline SVG charts. No chart library: these are a handful of rects and a path,
 * they print cleanly, and they inherit the page's colours.
 */

export interface Series {
  label: string;
  colour: string;
  values: number[];
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 3, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

function ChartFrame({ title, subtitle, children, legend }: { title: string; subtitle?: string; children: ReactNode; legend?: ReactNode }) {
  return (
    <figure className="chart card">
      <figcaption>
        <strong>{title}</strong>
        {subtitle && <span className="muted small">{subtitle}</span>}
        {legend && <div className="chart-legend">{legend}</div>}
      </figcaption>
      {children}
    </figure>
  );
}

/** Grouped bars, one group per period. */
export function GroupedBars({
  title,
  subtitle,
  labels,
  series,
  formatValue = (n: number) => String(n),
}: {
  title: string;
  subtitle?: string;
  labels: string[];
  series: Series[];
  formatValue?: (n: number) => string;
}) {
  const width = 720;
  const height = 240;
  const padLeft = 44;
  const padBottom = 28;
  const padTop = 10;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const plotWidth = width - padLeft - 8;
  const plotHeight = height - padBottom - padTop;
  const groupWidth = plotWidth / Math.max(1, labels.length);
  const barWidth = Math.max(3, (groupWidth - 8) / series.length);
  const ticks = [0, max / 2, max];

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      legend={series.map((s) => (
        <span key={s.label}>
          <i style={{ background: s.colour }} /> {s.label}
        </span>
      ))}
    >
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label={`${title}. ${series.map((s) => `${s.label}: ${s.values.join(", ")}`).join(". ")}`}>
        {ticks.map((t) => {
          const y = padTop + plotHeight - (t / max) * plotHeight;
          return (
            <g key={t}>
              <line x1={padLeft} x2={width - 8} y1={y} y2={y} className="chart-grid" />
              <text x={padLeft - 8} y={y + 4} className="chart-axis" textAnchor="end">
                {formatValue(Math.round(t * 100) / 100)}
              </text>
            </g>
          );
        })}
        {labels.map((label, i) => (
          <g key={label}>
            {series.map((s, si) => {
              const value = s.values[i] ?? 0;
              const barHeight = (value / max) * plotHeight;
              return (
                <rect
                  key={s.label}
                  x={padLeft + i * groupWidth + 4 + si * barWidth}
                  y={padTop + plotHeight - barHeight}
                  width={barWidth - 1}
                  height={Math.max(value > 0 ? 1 : 0, barHeight)}
                  fill={s.colour}
                  rx={1.5}
                >
                  <title>{`${label} · ${s.label}: ${formatValue(value)}`}</title>
                </rect>
              );
            })}
            <text x={padLeft + i * groupWidth + groupWidth / 2} y={height - 8} className="chart-axis" textAnchor="middle">
              {label}
            </text>
          </g>
        ))}
        <line x1={padLeft} x2={width - 8} y1={padTop + plotHeight} y2={padTop + plotHeight} className="chart-axis-line" />
      </svg>
    </ChartFrame>
  );
}

/** A single line with points, for a measure like average days to resolve. */
export function LineChart({
  title,
  subtitle,
  labels,
  values,
  colour = "#2563eb",
  formatValue = (n: number) => String(n),
}: {
  title: string;
  subtitle?: string;
  labels: string[];
  values: (number | null)[];
  colour?: string;
  formatValue?: (n: number) => string;
}) {
  const width = 720;
  const height = 220;
  const padLeft = 44;
  const padBottom = 28;
  const padTop = 10;
  const present = values.filter((v): v is number => v != null);
  const max = niceMax(Math.max(1, ...present));
  const plotWidth = width - padLeft - 8;
  const plotHeight = height - padBottom - padTop;
  const step = plotWidth / Math.max(1, labels.length - 1 || 1);
  const pointAt = (i: number, v: number) => [padLeft + i * step, padTop + plotHeight - (v / max) * plotHeight] as const;

  // Gaps (months with nothing closed) break the line rather than inventing a value.
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    const [x, y] = pointAt(i, v);
    current.push(`${current.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(" "));

  return (
    <ChartFrame title={title} subtitle={subtitle}>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label={`${title}: ${values.map((v, i) => `${labels[i]} ${v ?? "none"}`).join(", ")}`}>
        {[0, max / 2, max].map((t) => {
          const y = padTop + plotHeight - (t / max) * plotHeight;
          return (
            <g key={t}>
              <line x1={padLeft} x2={width - 8} y1={y} y2={y} className="chart-grid" />
              <text x={padLeft - 8} y={y + 4} className="chart-axis" textAnchor="end">
                {formatValue(Math.round(t * 10) / 10)}
              </text>
            </g>
          );
        })}
        {segments.map((d) => (
          <path key={d} d={d} fill="none" stroke={colour} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {values.map((v, i) =>
          v == null ? null : (
            <circle key={labels[i]} cx={pointAt(i, v)[0]} cy={pointAt(i, v)[1]} r={3.5} fill={colour}>
              <title>{`${labels[i]}: ${formatValue(v)}`}</title>
            </circle>
          )
        )}
        {labels.map((label, i) => (
          // The end labels sit on the plot edges, so anchor them inward or they get clipped.
          <text
            key={label}
            x={padLeft + i * step}
            y={height - 8}
            className="chart-axis"
            textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}
          >
            {label}
          </text>
        ))}
        <line x1={padLeft} x2={width - 8} y1={padTop + plotHeight} y2={padTop + plotHeight} className="chart-axis-line" />
      </svg>
    </ChartFrame>
  );
}

/** Horizontal bars for a ranked list (properties, technicians, contractors). */
export function RankedBars({
  title,
  subtitle,
  rows,
  formatValue = (n: number) => String(n),
}: {
  title: string;
  subtitle?: string;
  rows: { label: string; value: number; colour?: string; note?: string }[];
  formatValue?: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ChartFrame title={title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <p className="muted small">Nothing to show yet.</p>
      ) : (
        <ul className="ranked">
          {rows.map((row) => (
            <li key={row.label}>
              <span className="ranked-label" title={row.label}>
                {row.label}
              </span>
              <span className="ranked-track">
                <span className="ranked-fill" style={{ width: `${(row.value / max) * 100}%`, background: row.colour ?? "var(--brand)" }} />
              </span>
              <span className="ranked-value">
                {formatValue(row.value)}
                {row.note && <span className="muted small"> {row.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ChartFrame>
  );
}
