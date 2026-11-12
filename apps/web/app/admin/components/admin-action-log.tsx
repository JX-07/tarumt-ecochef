"use client";

import { Check, ChevronDown, History, Search, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createAuthenticatedWebApi } from "../../../src/lib/api";
import { ThemedDateRangeFilter } from "./themed-date-filter";

type AdminArea = "moderation" | "recipes" | "users" | "vendors" | "products" | "orders" | "promotions" | "administrators";
type State = Record<string, unknown>;
type ActionItem = {
  id: string;
  administrator_id: string;
  administrator_email: string;
  area: AdminArea;
  action_type: string;
  entity_type: string;
  entity_id: string;
  entity_label: string;
  summary: string;
  before_state: State;
  after_state: State;
  metadata: State;
  created_at: string;
  undone_at: string | null;
  undone_by_email: string | null;
  can_undo: boolean;
};
type ActionList = { items: ActionItem[]; total: number; limit: number; offset: number; current_administrator_id: string; access_level: string };
type UndoPreview = {
  action: ActionItem;
  newer_actions: ActionItem[];
  requires_choice: boolean;
  cascade_allowed: boolean;
  strategies: Array<{ value: "preserve_newer" | "cascade"; label: string; description: string }>;
};

const pageSize = 20;
const pretty = (value: string) => value.replaceAll("_", " ").replaceAll(".", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const valueText = (value: unknown) => value === null || value === undefined ? "Not set" : typeof value === "boolean" ? value ? "Yes" : "No" : String(value).replaceAll("_", " ");
const dateTime = (value: string) => new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

function Changes({ item }: { item: ActionItem }) {
  const keys = Array.from(new Set([...Object.keys(item.before_state), ...Object.keys(item.after_state)]));
  if (!keys.length) return <span className="action-log-no-changes">No field-level changes recorded.</span>;
  return <div className="action-log-changes">{keys.map((key) => <span key={key}><b>{pretty(key)}</b><del>{valueText(item.before_state[key])}</del><i>→</i><ins>{valueText(item.after_state[key])}</ins></span>)}</div>;
}

function ActionTypeFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const options = [
    { value: "", label: "All action types" },
    { value: "store.approved", label: "Store approved" },
    { value: "store.strike_issued", label: "Store strike issued" },
    { value: "store.revoked", label: "Store approval revoked" },
    { value: "administrator.invited", label: "Administrator invited" },
    { value: "administrator.invite_permission_updated", label: "Invitation privilege changed" },
    { value: "administrator.undo_permission_updated", label: "Undo privilege changed" },
    { value: "action.undo", label: "Undo operations" },
  ];
  const selected = options.find((option) => option.value === value)?.label ?? options[0].label;
  useEffect(() => {
    const closeForOtherFilters = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== "history-action-type") setOpen(false);
    };
    window.addEventListener("ecochef:filter-open", closeForOtherFilters);
    return () => window.removeEventListener("ecochef:filter-open", closeForOtherFilters);
  }, []);
  return <div className={`action-type-filter${open ? " open" : ""}`}><button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => {
    if (open) setOpen(false);
    else { window.dispatchEvent(new CustomEvent("ecochef:filter-open", { detail: "history-action-type" })); setOpen(true); }
  }}><span><small>Action type</small><strong>{selected}</strong></span><ChevronDown /></button>{open && <div role="listbox" aria-label="Filter by action type">{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? "selected" : ""} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span>{option.value === value && <Check />}</button>)}</div>}</div>;
}

export function AdminActionLog({ area, refreshKey, onActionUndone }: { area: AdminArea; refreshKey: number; onActionUndone: () => Promise<void> }) {
  const [result, setResult] = useState<ActionList>();
  const [query, setQuery] = useState("");
  const [actor, setActor] = useState("");
  const [actionType, setActionType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filters, setFilters] = useState({ query: "", actor: "", actionType: "", dateFrom: "", dateTo: "" });
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<UndoPreview>();
  const [strategy, setStrategy] = useState<"preserve_newer" | "cascade">("preserve_newer");
  const [undoing, setUndoing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await createAuthenticatedWebApi("/api/ecochef").getAdminActionLogs<ActionList>({
        area, query: filters.query, actor: filters.actor, actionType: filters.actionType,
        dateFrom: filters.dateFrom ? `${filters.dateFrom}T00:00:00` : undefined,
        dateTo: filters.dateTo ? `${filters.dateTo}T23:59:59` : undefined,
        limit: pageSize, offset,
      });
      setResult(response);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Action history could not be loaded."); }
    finally { setLoading(false); }
  }, [area, filters, offset]);

  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => { setOffset(0); setFilters({ query: "", actor: "", actionType: "", dateFrom: "", dateTo: "" }); setQuery(""); setActor(""); setActionType(""); setDateFrom(""); setDateTo(""); }, [area]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOffset(0);
      setFilters({ query, actor, actionType, dateFrom, dateTo });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, actor, actionType, dateFrom, dateTo]);

  const clearFilters = () => { setQuery(""); setActor(""); setActionType(""); setDateFrom(""); setDateTo(""); setOffset(0); setFilters({ query: "", actor: "", actionType: "", dateFrom: "", dateTo: "" }); };
  const openUndo = async (item: ActionItem) => {
    setError("");
    try { const response = await createAuthenticatedWebApi("/api/ecochef").previewAdminActionUndo<UndoPreview>(item.id); setPreview(response); setStrategy("preserve_newer"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "This action cannot be undone."); }
  };
  const undo = async () => {
    if (!preview) return;
    setUndoing(true); setError("");
    try { await createAuthenticatedWebApi("/api/ecochef").undoAdminAction(preview.action.id, strategy); setPreview(undefined); await onActionUndone(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The action could not be undone."); }
    finally { setUndoing(false); }
  };
  const pages = useMemo(() => Math.max(1, Math.ceil((result?.total ?? 0) / pageSize)), [result?.total]);
  const page = Math.floor(offset / pageSize) + 1;

  return <section className="admin-action-log"><header><div><History /><h2>Action history</h2></div><p>Permanent administrator transactions for this page. Undo operations are recorded as new transactions.</p></header><div className="action-log-filters"><label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search action, item, or administrator…" /></label><label className="action-filter-field"><span>Administrator</span><input value={actor} onChange={(event) => setActor(event.target.value)} placeholder="Email address" aria-label="Filter by administrator email" onFocus={() => window.dispatchEvent(new CustomEvent("ecochef:filter-open", { detail: "history-field" }))} /></label><ActionTypeFilter value={actionType} onChange={setActionType} /><ThemedDateRangeFilter id="history-date-range" label="Date" from={dateFrom} to={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to); }} /><button type="button" className="clear" onClick={clearFilters}>Clear filters</button></div>{error && <p className="admin-action-message error" role="alert">{error}</p>}{loading ? <p className="action-log-empty">Loading action history…</p> : result?.items.length ? <><div className="action-log-list">{result.items.map((item) => <article key={item.id} className={item.undone_at ? "undone" : ""}><div className="action-log-main"><span className={`action-kind ${item.action_type === "action.undo" ? "undo" : "change"}`}>{pretty(item.action_type)}</span><div><strong>{item.summary}</strong><p>{item.entity_type}: {item.entity_label} · {item.administrator_email} · {dateTime(item.created_at)}</p></div></div><Changes item={item} />{typeof item.metadata.reason === "string" && <p className="action-log-reason"><b>Reason:</b> {item.metadata.reason}</p>}<footer>{item.undone_at ? <span>Undone by {item.undone_by_email} on {dateTime(item.undone_at)}</span> : <span>Transaction {item.id.slice(0, 8).toUpperCase()}</span>}{item.can_undo && <button onClick={() => void openUndo(item)}><Undo2 /> Undo</button>}</footer></article>)}</div><div className="action-log-pagination"><span>{result.total.toLocaleString("en-MY")} transactions · Page {page} of {pages}</span><div><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</button><button disabled={offset + pageSize >= result.total} onClick={() => setOffset(offset + pageSize)}>Next</button></div></div></> : <p className="action-log-empty">No administrator actions match these filters.</p>}{preview && <div className="modal-backdrop"><section className="modal-card admin-undo-dialog" role="dialog" aria-modal="true" aria-labelledby="undo-action-title"><header><div><Undo2 /><h2 id="undo-action-title">Undo administrator action?</h2></div><button aria-label="Close undo dialog" onClick={() => setPreview(undefined)}><X /></button></header><p className="undo-action-summary">{preview.action.summary}</p><Changes item={preview.action} />{preview.newer_actions.length > 0 && <div className="undo-conflict"><strong>{preview.newer_actions.length} newer administrator action{preview.newer_actions.length === 1 ? "" : "s"} affect the same item.</strong><p>Choose how EcoChef should resolve the history. Newer business activity and records are never deleted.</p><ul>{preview.newer_actions.map((item) => <li key={item.id}>{item.summary} · {item.administrator_email} · {dateTime(item.created_at)}</li>)}</ul></div>}<fieldset><legend>Undo result</legend>{preview.strategies.map((option) => <label key={option.value}><input type="radio" name="undo-strategy" value={option.value} checked={strategy === option.value} onChange={() => setStrategy(option.value)} /><span><strong className="undo-strategy-title">{option.label}</strong><small>{option.description}</small></span></label>)}</fieldset>{preview.newer_actions.length > 0 && !preview.cascade_allowed && <p className="undo-permission-note">You cannot cascade this undo because one or more newer actions belong to another administrator. A super administrator can undo all administrators’ actions.</p>}<footer><button className="neutral-button" disabled={undoing} onClick={() => setPreview(undefined)}>Cancel</button><button className="danger-button" disabled={undoing} onClick={() => void undo()}>{undoing ? "Undoing…" : "Confirm undo"}</button></footer></section></div>}</section>;
}
