"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";

type RevenueDay = { day: string; amount: number };
const WIDTH = 700;
const HEIGHT = 230;
const LEFT = 64;
const RIGHT = 18;
const TOP = 16;
const BOTTOM = 202;
const money = (amount: number) =>
  `RM ${amount.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayDate = (day: string) => new Date(day.length === 10 ? `${day}T12:00:00+08:00` : day);

export function RevenueChart({
  rows,
  labelMode = "weekday",
}: {
  rows: RevenueDay[];
  labelMode?: "weekday" | "date" | "month";
}) {
  const [active, setActive] = useState<number>();
  if (!rows.length) return <p className="data-empty">No revenue recorded in this period.</p>;
  const values = rows.map((row) => Number(row.amount) || 0);
  const maximum = Math.max(...values, 1);
  const x = (index: number) =>
    rows.length === 1
      ? (LEFT + WIDTH - RIGHT) / 2
      : LEFT + (index * (WIDTH - LEFT - RIGHT)) / (rows.length - 1);
  const y = (value: number) => BOTTOM - (value / maximum) * (BOTTOM - TOP);
  const selected = active === undefined ? undefined : rows[Math.min(active, rows.length - 1)];
  const selectedIndex = active === undefined ? 0 : Math.min(active, rows.length - 1);
  const point = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const cursor = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
    // Daily revenue is discrete: snap to the nearest recorded day rather than
    // presenting interpolated currency amounts as actual sales.
    setActive(
      Math.max(
        0,
        Math.min(
          rows.length - 1,
          Math.round(((cursor - LEFT) / (WIDTH - LEFT - RIGHT)) * (rows.length - 1)),
        ),
      ),
    );
  };
  const key = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") setActive(undefined);
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(rows.length - 1);
    else
      setActive((current) =>
        Math.max(
          0,
          Math.min(rows.length - 1, (current ?? 0) + (event.key === "ArrowRight" ? 1 : -1)),
        ),
      );
  };
  return (
    <div className="revenue-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        tabIndex={0}
        role="group"
        aria-label="Daily revenue chart. Hover or tap a day, or use the left and right arrow keys to read revenue."
        onPointerMove={point}
        onPointerDown={point}
        onPointerLeave={() => setActive(undefined)}
        onFocus={() => setActive((current) => current ?? 0)}
        onBlur={() => setActive(undefined)}
        onKeyDown={key}
      >
        {[0, 1, 2, 3].map((tick) => {
          const value = (maximum * tick) / 3;
          return (
            <g key={tick} className="revenue-chart-grid">
              <line x1={LEFT} x2={WIDTH - RIGHT} y1={y(value)} y2={y(value)} />
              <text x={LEFT - 8} y={y(value)} dy=".35em" textAnchor="end">
                {value.toLocaleString("en-MY", { maximumFractionDigits: 2 })}
              </text>
            </g>
          );
        })}
        <polyline
          className="revenue-chart-series"
          points={values.map((value, index) => `${x(index)},${y(value)}`).join(" ")}
        />
        {rows.length === 1 ? (
          <circle className="revenue-chart-point" cx={x(0)} cy={y(values[0])} r={4} />
        ) : null}
        {rows.map((row, index) => {
          if (labelMode === "date") {
            const day = Number(row.day.slice(8, 10));
            if (![1, 7, 14, 21, 28].includes(day) && index !== rows.length - 1) return null;
          }
          return (
            <text
              className="revenue-chart-day"
              key={`${row.day}-${index}`}
              x={x(index)}
              y={HEIGHT - 5}
              textAnchor="middle"
            >
              {dayDate(row.day).toLocaleDateString("en-MY", {
                ...(labelMode === "date"
                  ? { day: "numeric" as const, month: "short" as const }
                  : labelMode === "month"
                    ? { month: "short" as const }
                    : { weekday: "short" as const }),
                timeZone: "Asia/Kuala_Lumpur",
              })}
            </text>
          );
        })}
        {selected ? (
          <g pointerEvents="none">
            <line
              className="revenue-chart-guide"
              x1={x(selectedIndex)}
              x2={x(selectedIndex)}
              y1={TOP}
              y2={BOTTOM}
            />
            <circle
              className="revenue-chart-point"
              cx={x(selectedIndex)}
              cy={y(values[selectedIndex])}
              r={5}
            />
          </g>
        ) : null}
      </svg>
      {selected ? (
        <div
          className={`revenue-chart-tooltip${selectedIndex >= rows.length / 2 ? " align-left" : ""}`}
          role="status"
          style={{ left: `${(x(selectedIndex) / WIDTH) * 100}%` }}
        >
          <span>
            {dayDate(selected.day).toLocaleDateString("en-MY", {
              weekday: "short",
              day: "numeric",
              month: "short",
              timeZone: "Asia/Kuala_Lumpur",
            })}
          </span>
          <strong>{money(values[selectedIndex])}</strong>
        </div>
      ) : null}
    </div>
  );
}
