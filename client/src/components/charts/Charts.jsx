import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useThemeColors } from '../../hooks/useThemeColors.js';
import { PROTOCOL_SLOT } from '../../lib/format.js';

const fmtMs = (v) =>
  v === null || v === undefined
    ? '—'
    : v < 0.01
      ? v.toFixed(5)
      : v < 1
        ? v.toFixed(4)
        : v < 100
          ? v.toFixed(2)
          : v.toFixed(0);

function Chips({ label, options, value, onChange }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function TooltipBox({ active, payload, unit, format }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>
        {format(d.value)}
        {unit ? ` ${unit}` : ''}
      </strong>{' '}
      <span className="muted">{d.name}</span>
      {d.note && <div className="small muted">{d.note}</div>}
    </div>
  );
}

/**
 * One measure per chart, one bar per protocol (never dual-axis). Protocol identity is carried by
 * the category axis label as well as colour, and each bar is direct-labelled (contrast relief).
 */
export function ProtocolBarChart({
  title,
  subtitle,
  data,
  unit,
  format = fmtMs,
  log = false,
  height,
}) {
  const c = useThemeColors();
  const rows = data.filter((d) => d.value !== null && d.value !== undefined);
  const h = height ?? 56 + rows.length * 44;
  const positive = rows.every((d) => d.value > 0);
  const useLog = log && positive;
  const values = rows.map((d) => d.value);
  // Explicit numeric domain with headroom so the smallest value never sits on the axis edge.
  const domain = useLog
    ? [
        10 ** Math.floor(Math.log10(Math.min(...values) / 1.5)),
        10 ** Math.ceil(Math.log10(Math.max(...values) * 1.5)),
      ]
    : [0, 'auto'];
  return (
    <figure className="card chart-card" style={{ margin: 0 }}>
      <h3>{title}</h3>
      {subtitle && (
        <figcaption className="sub">
          {subtitle}
          {useLog ? ' · log scale, dot marks the value' : ''}
          {log && !positive ? ' · linear scale (zero values present)' : ''}
        </figcaption>
      )}
      {rows.length === 0 ? (
        <p className="muted small">No data.</p>
      ) : (
        <ResponsiveContainer width="100%" height={h}>
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 4, right: 104, bottom: 4, left: 8 }}
            barCategoryGap={10}
          >
            <CartesianGrid horizontal={false} stroke={c['--grid']} />
            <XAxis
              type="number"
              scale={useLog ? 'log' : 'auto'}
              domain={domain}
              allowDataOverflow
              tickFormatter={format}
              stroke={c['--axis']}
              tick={{ fill: c['--muted'], fontSize: 12 }}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={92}
              stroke={c['--axis']}
              tick={{ fill: c['--ink-2'], fontSize: 13 }}
            />
            <Tooltip
              cursor={{ fill: c['--grid'], opacity: 0.4 }}
              content={<TooltipBox unit={unit} format={format} />}
            />
            <Bar
              dataKey="value"
              radius={[0, 4, 4, 0]}
              maxBarSize={28}
              isAnimationActive={false}
              shape={(props) => {
                const fill = c[`--series-${PROTOCOL_SLOT[props.payload.name]}`];
                if (!useLog) {
                  return (
                    <rect
                      x={props.x}
                      y={props.y}
                      width={Math.max(0, props.width)}
                      height={props.height}
                      rx={4}
                      fill={fill}
                    />
                  );
                }
                // Log scale: bar length from an arbitrary baseline is meaningless, so mark the value with a dot.
                const cx = props.x + props.width;
                const cy = props.y + props.height / 2;
                return (
                  <g>
                    <line
                      x1={props.x}
                      x2={cx}
                      y1={cy}
                      y2={cy}
                      stroke={c['--grid']}
                      strokeWidth={2}
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={7}
                      fill={fill}
                      stroke={c['--surface']}
                      strokeWidth={2}
                    />
                  </g>
                );
              }}
            >
              <LabelList
                dataKey="value"
                position="right"
                offset={useLog ? 12 : 6}
                formatter={(v) => `${format(v)}${unit ? ` ${unit}` : ''}`}
                style={{ fill: c['--ink-2'], fontSize: 12 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </figure>
  );
}

const STATS = [
  ['mean', 'Mean'],
  ['median', 'Median'],
  ['p95', 'p95'],
  ['p99', 'p99'],
];

/** Time per authentication with measure/statistic/scale switches. */
export function TimeChart({ results }) {
  const [measure, setMeasure] = useState('latency');
  const [stat, setStat] = useState('median');
  const [scale, setScale] = useState('log');
  const data = results.map((r) => ({
    name: r.protocolName,
    value: r.metrics[measure === 'latency' ? 'latency' : 'processingTime']?.[stat],
  }));
  return (
    <div className="stack">
      <div className="row">
        <Chips
          label="Measure"
          value={measure}
          onChange={setMeasure}
          options={[
            ['latency', 'End-to-end latency'],
            ['processing', 'Server processing'],
          ]}
        />
        <Chips label="Statistic" value={stat} onChange={setStat} options={STATS} />
        <Chips
          label="Scale"
          value={scale}
          onChange={setScale}
          options={[
            ['log', 'Log'],
            ['linear', 'Linear'],
          ]}
        />
      </div>
      <ProtocolBarChart
        title={`${measure === 'latency' ? 'End-to-end latency' : 'Server processing time'} · ${STATS.find(([k]) => k === stat)[1]}`}
        subtitle={
          measure === 'latency'
            ? 'Whole transaction incl. claimant simulation, email send (OOB) and browser ceremony (WebAuthn)'
            : 'Server-side compute only (issuance + verification)'
        }
        data={data}
        unit="ms"
        log={scale === 'log'}
      />
    </div>
  );
}

/** Latency distribution: one histogram per protocol (small multiples; each with its own x-range). */
export function DistributionGrid({ results, kind = 'latency' }) {
  const c = useThemeColors();
  return (
    <div className="grid grid-2">
      {results.map((r) => {
        const bins = (r.distributions?.[kind] ?? []).map((b) => ({
          ...b,
          mid: (b.binStart + b.binEnd) / 2,
          label: b.overflow ? `> ${fmtMs(b.binStart)}` : `${fmtMs(b.binStart)}–${fmtMs(b.binEnd)}`,
        }));
        return (
          <figure key={r._id} className="card chart-card" style={{ margin: 0 }}>
            <h3>{r.protocolName}</h3>
            <figcaption className="sub">
              {kind === 'latency' ? 'Latency' : 'Processing'} distribution (ms),{' '}
              {r.metrics.latency.n} samples · median{' '}
              {fmtMs(r.metrics[kind === 'latency' ? 'latency' : 'processingTime'].median)} ms · last
              bar collects values above p99
            </figcaption>
            <ResponsiveContainer width="100%" height={170}>
              <BarChart
                data={bins}
                margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
                barCategoryGap={1}
              >
                <CartesianGrid vertical={false} stroke={c['--grid']} />
                <XAxis
                  dataKey="mid"
                  tickFormatter={fmtMs}
                  stroke={c['--axis']}
                  tick={{ fill: c['--muted'], fontSize: 11 }}
                  minTickGap={24}
                />
                <YAxis
                  allowDecimals={false}
                  width={40}
                  stroke={c['--axis']}
                  tick={{ fill: c['--muted'], fontSize: 11 }}
                />
                <Tooltip
                  cursor={{ fill: c['--grid'], opacity: 0.4 }}
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <div className="chart-tooltip">
                        <strong>{payload[0].payload.count}</strong>{' '}
                        <span className="muted">samples in {payload[0].payload.label} ms</span>
                      </div>
                    ) : null
                  }
                />
                <Bar
                  dataKey="count"
                  fill={c[`--series-${PROTOCOL_SLOT[r.protocolName]}`]}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </figure>
        );
      })}
    </div>
  );
}
