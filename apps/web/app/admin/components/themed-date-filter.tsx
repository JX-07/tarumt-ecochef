"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const pad = (value: number) => String(value).padStart(2, "0");
const dateValue = (value: Date) =>
  `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
const parsedDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : undefined;
};
const displayDate = (value: string) => {
  const parsed = parsedDate(value);
  return parsed
    ? new Intl.DateTimeFormat("en-MY", { dateStyle: "medium" }).format(parsed)
    : "Any date";
};

export function ThemedDateRangeFilter({
  id,
  label,
  from,
  to,
  onChange,
}: {
  id: string;
  label: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const selected = parsedDate(from || to) ?? new Date();
    return new Date(selected.getFullYear(), selected.getMonth(), 1);
  });
  const [fromDraft, setFromDraft] = useState(from);
  const [toDraft, setToDraft] = useState(to);
  const dragAnchor = useRef("");
  const dragging = useRef(false);
  const dragMoved = useRef(false);
  const ignoreClick = useRef(false);
  useEffect(() => {
    setFromDraft(from);
    setToDraft(to);
  }, [from, to]);
  useEffect(() => {
    const closeForOtherFilters = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setOpen(false);
    };
    const endDrag = () => {
      dragging.current = false;
    };
    window.addEventListener("ecochef:filter-open", closeForOtherFilters);
    window.addEventListener("pointerup", endDrag);
    return () => {
      window.removeEventListener("ecochef:filter-open", closeForOtherFilters);
      window.removeEventListener("pointerup", endDrag);
    };
  }, [id]);
  const days = useMemo(() => {
    const firstWeekday = visibleMonth.getDay();
    const start = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1 - firstWeekday);
    return Array.from(
      { length: 42 },
      (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index),
    );
  }, [visibleMonth]);
  const today = dateValue(new Date());
  const monthTitle = new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric" }).format(
    visibleMonth,
  );
  const ordered = (first: string, second: string): [string, string] =>
    first <= second ? [first, second] : [second, first];
  const chooseDate = (option: string) => {
    if (!from || to) onChange(option, "");
    else {
      const [start, end] = ordered(from, option);
      onChange(start, end);
    }
  };
  const commitDrafts = () => {
    const valid = (value: string) =>
      !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Boolean(parsedDate(value)));
    if (!valid(fromDraft) || !valid(toDraft)) return;
    if (fromDraft && toDraft) {
      const [start, end] = ordered(fromDraft, toDraft);
      onChange(start, end);
    } else onChange(fromDraft, toDraft);
  };
  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const selected = parsedDate(from || to);
    if (selected) setVisibleMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    window.dispatchEvent(new CustomEvent("ecochef:filter-open", { detail: id }));
    setOpen(true);
  };
  const selectionLabel =
    from && to
      ? `${displayDate(from)} – ${displayDate(to)}`
      : from
        ? `From ${displayDate(from)}`
        : to
          ? `Until ${displayDate(to)}`
          : "Any date";
  return (
    <div className={`themed-date-filter range${open ? " open" : ""}`}>
      <button
        className="themed-date-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <span>
          <small>{label}</small>
          <strong>{selectionLabel}</strong>
        </span>
        <CalendarDays />
      </button>
      {open && (
        <section
          className="themed-calendar range-calendar"
          role="dialog"
          aria-label={`${label} range calendar`}
        >
          <div className="calendar-range-fields">
            <label>
              <span>From</span>
              <input
                inputMode="numeric"
                placeholder="YYYY-MM-DD"
                value={fromDraft}
                onChange={(event) => setFromDraft(event.target.value)}
                onBlur={commitDrafts}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitDrafts();
                }}
              />
            </label>
            <span>to</span>
            <label>
              <span>To</span>
              <input
                inputMode="numeric"
                placeholder="YYYY-MM-DD"
                value={toDraft}
                onChange={(event) => setToDraft(event.target.value)}
                onBlur={commitDrafts}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitDrafts();
                }}
              />
            </label>
          </div>
          <p className="calendar-range-help">Tap a start and end date, or drag across dates.</p>
          <header>
            <button
              type="button"
              aria-label="Previous month"
              onClick={() =>
                setVisibleMonth(
                  (current) => new Date(current.getFullYear(), current.getMonth() - 1, 1),
                )
              }
            >
              <ChevronLeft />
            </button>
            <strong>{monthTitle}</strong>
            <button
              type="button"
              aria-label="Next month"
              onClick={() =>
                setVisibleMonth(
                  (current) => new Date(current.getFullYear(), current.getMonth() + 1, 1),
                )
              }
            >
              <ChevronRight />
            </button>
          </header>
          <div className="calendar-weekdays">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-days">
            {days.map((day) => {
              const option = dateValue(day);
              const outside = day.getMonth() !== visibleMonth.getMonth();
              const inRange = Boolean(from && to && option >= from && option <= to);
              const edge = option === from || option === to;
              return (
                <button
                  type="button"
                  className={`${outside ? "outside " : ""}${option === today ? "today " : ""}${inRange ? "in-range " : ""}${edge ? "selected" : ""}`}
                  aria-pressed={edge}
                  key={option}
                  onPointerDown={() => {
                    dragAnchor.current = option;
                    dragging.current = true;
                    dragMoved.current = false;
                  }}
                  onPointerEnter={() => {
                    if (!dragging.current || !dragAnchor.current || option === dragAnchor.current)
                      return;
                    dragMoved.current = true;
                    const [start, end] = ordered(dragAnchor.current, option);
                    onChange(start, end);
                  }}
                  onPointerUp={() => {
                    ignoreClick.current = true;
                    if (!dragMoved.current) chooseDate(option);
                    dragging.current = false;
                  }}
                  onClick={() => {
                    if (ignoreClick.current) {
                      ignoreClick.current = false;
                      return;
                    }
                    chooseDate(option);
                  }}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
          <footer>
            <button
              type="button"
              onClick={() => {
                onChange(today, today);
                setOpen(false);
              }}
            >
              Today
            </button>
            <button
              type="button"
              disabled={!from && !to}
              onClick={() => {
                onChange("", "");
                setOpen(false);
              }}
            >
              Clear range
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
