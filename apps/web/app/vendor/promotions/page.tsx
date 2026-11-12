"use client";

import {
  CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3,
  Copy, PackageSearch, Search, Tag, TicketPercent, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { createAuthenticatedWebApi } from "../../../src/lib/api";
import { StoreRequired } from "../components/store-required";
import { useVendor, type Product } from "../components/vendor-context";

type Promotion = {
  id: string; kind: "direct" | "coupon"; code?: string; title: string; description?: string;
  status: string; start_date?: string; end_date?: string; usage_limit?: number; redemptions?: number;
  discount?: { type: string; value?: number; buy_quantity?: number; gift_quantity?: number };
};

type SelectOption = { value: string; label: string };
const discountOptions: SelectOption[] = [
  { value: "percentage", label: "Percentage discount" },
  { value: "fixed_amount", label: "Direct subtraction (RM)" },
  { value: "buy_x_get_y", label: "Buy X, get Y free" },
];
const timeOptions: SelectOption[] = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2), minute = index % 2 ? "30" : "00";
  const period = hour < 12 ? "AM" : "PM", displayHour = hour % 12 || 12;
  return { value: `${String(hour).padStart(2, "0")}:${minute}`, label: `${displayHour}:${minute} ${period}` };
});
const emptyDraft = () => ({
  promotionKind: "direct" as "direct" | "coupon", title: "", description: "",
  discountType: "percentage", value: "", buyQuantity: "1", giftQuantity: "1",
  productIds: [] as string[], code: "", minimumOrderAmount: "", usageLimit: "",
  startDate: "", startTime: "00:00", endDate: "", endTime: "23:30",
});

export default function PromotionsPage() {
  const { stores, reload } = useVendor();
  const shop = stores[0];
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingProducts, setPendingProducts] = useState<string[]>([]);

  const load = async () => {
    if (!shop) return;
    try {
      const result = await createAuthenticatedWebApi("/api/ecochef").getVendorPromotions<{ promotions: Promotion[] }>();
      setPromotions(result.promotions);
    } catch { setPromotions([]); }
  };
  useEffect(() => { void load(); }, [shop?.id]);
  useEffect(() => {
    const show = () => { setDraft(emptyDraft()); setError(""); setAttempted(false); setOpen(true); };
    window.addEventListener("ecochef:add-promotion", show);
    return () => window.removeEventListener("ecochef:add-promotion", show);
  }, []);

  const close = () => { if (!saving) { setOpen(false); setPickerOpen(false); setError(""); } };
  const openProducts = () => { setPendingProducts(draft.productIds); setPickerOpen(true); };
  const submit = async () => {
    setError("");
    setAttempted(true);
    if (!draft.title.trim()) return setError("Enter a promotion title.");
    if (draft.promotionKind === "direct" && !draft.productIds.length) return;
    if (draft.promotionKind === "coupon" && !draft.code.trim()) return setError("Enter a coupon code.");
    if (!draft.startDate || !draft.endDate) return setError("Choose the promotion date range.");
    const today = toDateValue(new Date());
    if (draft.startDate < today || draft.endDate < today) return setError("Promotion dates must be today or later.");
    const startsAt = new Date(`${draft.startDate}T${draft.startTime}:00`);
    const endsAt = new Date(`${draft.endDate}T${draft.endTime}:00`);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) return setError("The promotion must end after it starts.");
    if (draft.discountType !== "buy_x_get_y" && (!Number(draft.value) || Number(draft.value) <= 0)) return setError("Enter a valid discount amount.");
    try {
      setSaving(true);
      await createAuthenticatedWebApi("/api/ecochef").createVendorPromotion({
        promotion_kind: draft.promotionKind, title: draft.title.trim(), description: draft.description.trim(),
        discount_type: draft.discountType, value: draft.discountType === "buy_x_get_y" ? null : Number(draft.value),
        buy_quantity: draft.discountType === "buy_x_get_y" ? Number(draft.buyQuantity) : null,
        gift_quantity: draft.discountType === "buy_x_get_y" ? Number(draft.giftQuantity) : null,
        starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), product_ids: draft.productIds,
        code: draft.promotionKind === "coupon" ? draft.code.trim().toUpperCase() : null,
        minimum_order_amount: Number(draft.minimumOrderAmount || 0),
        usage_limit: draft.usageLimit ? Number(draft.usageLimit) : null,
      });
      setOpen(false); setDraft(emptyDraft()); await Promise.all([load(), reload()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "An unexpected error occurred.");
    } finally { setSaving(false); }
  };

  return <StoreRequired>
    <section className="workspace">
      {promotions.length ? <div className="deal-grid promotion-grid">
        {promotions.map((promotion) => <article className="promotion-card" key={promotion.id}>
          <header><em className={`promotion-kind ${promotion.kind}`}>{promotion.kind === "coupon" ? "Coupon" : "Direct promotion"}</em><span className={`pill ${promotion.status}`}>{promotion.status}</span></header>
          <div><h2>{promotion.title}</h2>{promotion.description ? <p>{promotion.description}</p> : null}</div>
          {promotion.kind === "coupon" ? <div className="promo-code"><span><small>COUPON CODE</small><strong>{promotion.code}</strong></span><button aria-label="Copy coupon code" onClick={() => void copyText(promotion.code ?? "")}><Copy size={16} /></button></div> : <div className="direct-promotion-value"><Tag size={18} /><strong>{formatDiscount(promotion.discount)}</strong><small>Automatically applied to selected products</small></div>}
          <footer><span>{formatPeriod(promotion.start_date, promotion.end_date)}</span>{promotion.kind === "coupon" && promotion.usage_limit ? <span>{promotion.redemptions ?? 0} / {promotion.usage_limit} used</span> : null}</footer>
        </article>)}
      </div> : <div className="panel-empty promotion-empty-state"><Tag size={28} /><strong>No promotions yet</strong><p>Create an automatic product discount or a coupon for your customers.</p></div>}
    </section>

    {open ? <div className="modal-backdrop" role="presentation">
      <section className="modal-card promotion-create-modal" role="dialog" aria-modal="true" aria-labelledby="promotion-title" onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}>
        <header><div><span><TicketPercent /></span><h2 id="promotion-title">Create Promotion</h2></div><button type="button" aria-label="Close" onClick={close}><X /></button></header>
        <div className="promotion-form-scroll">
          <div className="promotion-kind-picker" aria-label="Promotion type">
            <button type="button" className={draft.promotionKind === "direct" ? "active" : ""} onClick={() => setDraft((item) => ({ ...item, promotionKind: "direct" }))}><Tag /><span>Direct promotion</span><small>Applied automatically to selected products.</small></button>
            <button type="button" className={draft.promotionKind === "coupon" ? "active" : ""} onClick={() => setDraft((item) => ({ ...item, promotionKind: "coupon", discountType: item.discountType === "buy_x_get_y" ? "percentage" : item.discountType }))}><TicketPercent /><span>Coupon</span><small>Customers enter a code at checkout.</small></button>
          </div>
          <label><span>Promotion title <strong>*</strong></span><input value={draft.title} onChange={(event) => setDraft((item) => ({ ...item, title: event.target.value }))} placeholder="e.g. Weekend fresh produce deal" /></label>
          <label><span>Description</span><textarea value={draft.description} onChange={(event) => setDraft((item) => ({ ...item, description: event.target.value }))} placeholder="Tell customers what this promotion includes" /></label>
          <div className="promotion-two-columns">
            <label><span>Discount type <strong>*</strong></span><ThemedSelect value={draft.discountType} options={discountOptions.filter((option) => draft.promotionKind === "direct" || option.value !== "buy_x_get_y")} onChange={(value) => setDraft((item) => ({ ...item, discountType: value }))} /></label>
            {draft.discountType === "buy_x_get_y" ? <div className="promotion-two-columns compact"><label><span>Buy quantity <strong>*</strong></span><input type="number" min="1" value={draft.buyQuantity} onChange={(event) => setDraft((item) => ({ ...item, buyQuantity: event.target.value }))} /></label><label><span>Free quantity <strong>*</strong></span><input type="number" min="1" value={draft.giftQuantity} onChange={(event) => setDraft((item) => ({ ...item, giftQuantity: event.target.value }))} /></label></div> : <label><span>{draft.discountType === "percentage" ? "Discount percentage" : "Discount amount (RM)"} <strong>*</strong></span><input type="number" min="0.01" step="0.01" value={draft.value} onChange={(event) => setDraft((item) => ({ ...item, value: event.target.value }))} placeholder={draft.discountType === "percentage" ? "e.g. 15" : "e.g. 5.00"} /></label>}
          </div>
          {draft.promotionKind === "direct" ? <ProductField products={shop?.products ?? []} selectedIds={draft.productIds} discountType={draft.discountType} value={draft.value} buyQuantity={draft.buyQuantity} giftQuantity={draft.giftQuantity} invalid={attempted && !draft.productIds.length} onOpen={openProducts} onRemove={(id) => setDraft((item) => ({ ...item, productIds: item.productIds.filter((value) => value !== id) }))} /> : <div className="promotion-two-columns"><label><span>Coupon code <strong>*</strong></span><input value={draft.code} onChange={(event) => setDraft((item) => ({ ...item, code: event.target.value.toUpperCase() }))} placeholder="e.g. ECO15" /></label><label><span>Minimum order (RM)</span><input type="number" min="0" step="0.01" value={draft.minimumOrderAmount} onChange={(event) => setDraft((item) => ({ ...item, minimumOrderAmount: event.target.value }))} placeholder="0.00" /></label><label><span>Usage limit</span><input type="number" min="1" value={draft.usageLimit} onChange={(event) => setDraft((item) => ({ ...item, usageLimit: event.target.value }))} placeholder="Leave empty for unlimited" /></label></div>}
          <DateRangePicker start={draft.startDate} end={draft.endDate} onChange={(startDate, endDate) => setDraft((item) => ({ ...item, startDate, endDate }))} />
          <div className="promotion-two-columns"><label><span>Start time <strong>*</strong></span><ThemedSelect icon={<Clock3 size={16} />} value={draft.startTime} options={timeOptions} onChange={(value) => setDraft((item) => ({ ...item, startTime: value }))} /></label><label><span>End time <strong>*</strong></span><ThemedSelect icon={<Clock3 size={16} />} value={draft.endTime} options={timeOptions} onChange={(value) => setDraft((item) => ({ ...item, endTime: value }))} /></label></div>
          {error ? <p className="product-form-error">{error}</p> : null}
        </div>
        <footer><button type="button" className="neutral-button" onClick={close}>Cancel</button><button type="button" className="cta" disabled={saving} onClick={() => void submit()}>{saving ? "Creating…" : "Create Promotion"}</button></footer>
      </section>
      {pickerOpen ? <ProductPicker products={shop?.products ?? []} selectedIds={pendingProducts} onChange={setPendingProducts} onCancel={() => setPickerOpen(false)} onApply={() => { setDraft((item) => ({ ...item, productIds: pendingProducts })); setPickerOpen(false); }} /> : null}
    </div> : null}
  </StoreRequired>;
}

function ProductField({ products, selectedIds, discountType, value, buyQuantity, giftQuantity, invalid, onOpen, onRemove }: { products: Product[]; selectedIds: string[]; discountType: string; value: string; buyQuantity: string; giftQuantity: string; invalid: boolean; onOpen: () => void; onRemove: (id: string) => void }) {
  const selected = products.filter((product) => selectedIds.includes(product.id));
  return <section className={`promotion-product-field ${invalid ? "invalid" : ""}`}><header><div><strong>Products <span>*</span></strong><small>Select one or more products for this promotion.</small></div><button type="button" className="secondary" onClick={onOpen}><PackageSearch size={16} /> Choose products</button></header>
    {selected.length ? <div className="promotion-selected-products"><div className="promotion-selected-heading"><span>Product</span><span>Quantity left</span><span>Current price</span><span>After promotion</span><span /></div>{selected.map((product) => <div className="promotion-selected-row" key={product.id}><strong>{product.name}</strong><span>{product.stock_quantity}</span><span>RM {Number(product.price).toFixed(2)}</span><strong className="promotion-new-price">RM {promotionPrice(product, discountType, value, buyQuantity, giftQuantity).toFixed(2)}</strong><button type="button" aria-label={`Remove ${product.name}`} onClick={() => onRemove(product.id)}><X size={15} /></button></div>)}</div> : invalid ? <p className="promotion-product-error">Select at least one product.</p> : null}
  </section>;
}

function ProductPicker({ products, selectedIds, onChange, onCancel, onApply }: { products: Product[]; selectedIds: string[]; onChange: (ids: string[]) => void; onCancel: () => void; onApply: () => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All products");
  const categories = useMemo(() => ["All products", ...Array.from(new Set(products.map((product) => product.category || "Uncategorised"))).sort()], [products]);
  const visible = products.filter((product) => (category === "All products" || (product.category || "Uncategorised") === category) && product.name.toLowerCase().includes(query.toLowerCase()));
  const toggle = (id: string) => onChange(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]);
  const selectVisible = () => onChange(Array.from(new Set([...selectedIds, ...visible.map((product) => product.id)])));
  return <div className="promotion-picker-backdrop" role="presentation">
    <section className="promotion-product-picker" role="dialog" aria-modal="true" aria-labelledby="product-picker-title">
      <header><div><small>PRODUCT SELECTION</small><h2 id="product-picker-title">Choose promotion products</h2></div><button type="button" aria-label="Close product picker" onClick={onCancel}><X /></button></header>
      <div className="promotion-picker-tools"><label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search store products" /></label><ThemedSelect value={category} options={categories.map((item) => ({ value: item, label: item }))} onChange={setCategory} /></div>
      <div className="promotion-picker-actions"><button type="button" onClick={selectVisible}>Select all in {category === "All products" ? "current list" : category}</button><button type="button" onClick={() => onChange(products.map((product) => product.id))}>Select all store products</button><button type="button" onClick={() => onChange([])}>Clear selection</button><span>{selectedIds.length} selected</span></div>
      <div className="promotion-product-list">{visible.length ? visible.map((product) => <button type="button" className={selectedIds.includes(product.id) ? "selected" : ""} key={product.id} onClick={() => toggle(product.id)}><span className="promotion-checkbox">{selectedIds.includes(product.id) ? <Check size={15} /> : null}</span>{product.image_url ? <img src={product.image_url} alt="" /> : <i><PackageSearch size={18} /></i>}<span><strong>{product.name}</strong><small>{product.category || "Uncategorised"} · RM {Number(product.price).toFixed(2)}</small></span></button>) : <p>No products match this search.</p>}</div>
      <footer><button type="button" className="neutral-button" onClick={onCancel}>Cancel</button><button type="button" className="cta" onClick={onApply}>Apply {selectedIds.length ? `(${selectedIds.length})` : ""}</button></footer>
    </section>
  </div>;
}

function ThemedSelect({ value, options, onChange, icon }: { value: string; options: SelectOption[]; onChange: (value: string) => void; icon?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, []);
  const current = options.find((option) => option.value === value)?.label ?? value;
  return <div className="themed-select promotion-themed-select" ref={root}><button type="button" className="themed-select-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((shown) => !shown)}>{icon}<span>{current}</span><ChevronDown size={17} /></button>{open ? <div className="themed-select-menu" role="listbox">{options.map((option) => <button type="button" role="option" aria-selected={value === option.value} className={value === option.value ? "selected" : ""} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span>{value === option.value ? <Check size={16} /> : null}</button>)}</div> : null}</div>;
}

function DateRangePicker({ start, end, onChange }: { start: string; end: string; onChange: (start: string, end: string) => void }) {
  const initial = parseDate(start) ?? new Date();
  const today = toDateValue(new Date());
  const [month, setMonth] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [anchor, setAnchor] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const days = calendarDays(month);
  const setRange = (first: string, second: string) => first <= second ? onChange(first, second) : onChange(second, first);
  const begin = (date: string, _event: ReactPointerEvent<HTMLButtonElement>) => { if (date < today) return; setAnchor(date); setDragging(true); setRange(date, date); };
  const extend = (date: string, event: ReactPointerEvent<HTMLButtonElement>) => { if (date >= today && dragging && anchor && event.buttons === 1) setRange(anchor, date); };
  const finish = (date: string) => { if (date >= today && dragging && anchor) setRange(anchor, date); setDragging(false); setAnchor(undefined); };
  return <section className="promotion-date-range"><header><div><strong>Promotion period <span>*</span></strong><small>Type dates manually or drag across the calendar to select the interval.</small></div><button type="button" className="secondary" onClick={() => setCalendarOpen((shown) => !shown)}><CalendarDays size={16} /> {calendarOpen ? "Hide calendar" : "Choose dates"}</button></header>
    <div className="promotion-two-columns"><label><span>Start date <strong>*</strong></span><div className="promotion-date-input"><CalendarDays size={16} /><input inputMode="numeric" value={start} placeholder="YYYY-MM-DD" maxLength={10} onFocus={() => setCalendarOpen(true)} onBlur={() => { if (start.length === 10 && start < today) onChange(today, end); }} onChange={(event) => onChange(normalizeDateInput(event.target.value), end)} /></div></label><label><span>End date <strong>*</strong></span><div className="promotion-date-input"><CalendarDays size={16} /><input inputMode="numeric" value={end} placeholder="YYYY-MM-DD" maxLength={10} onFocus={() => setCalendarOpen(true)} onBlur={() => { if (end.length === 10 && end < today) onChange(start, today); }} onChange={(event) => onChange(start, normalizeDateInput(event.target.value))} /></div></label></div>
    {calendarOpen ? <div className="promotion-calendar"><header><button type="button" aria-label="Previous month" disabled={month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth()} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></button><strong>{month.toLocaleDateString("en-MY", { month: "long", year: "numeric" })}</strong><button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></button></header><div className="promotion-weekdays">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}</div><div className="promotion-calendar-days">{days.map((day) => { const value = toDateValue(day); const outside = day.getMonth() !== month.getMonth(); const unavailable = value < today; const selected = Boolean(start && end && value >= start && value <= end); return <button type="button" disabled={unavailable} key={value} className={`${outside ? "outside" : ""} ${selected ? "in-range" : ""} ${value === start ? "range-start" : ""} ${value === end ? "range-end" : ""}`} onPointerDown={(event) => begin(value, event)} onPointerEnter={(event) => extend(value, event)} onPointerUp={() => finish(value)}>{day.getDate()}</button>; })}</div></div> : null}
  </section>;
}

function parseDate(value: string) { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!match) return undefined; const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])); return Number.isNaN(date.getTime()) ? undefined : date; }
function toDateValue(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function normalizeDateInput(value: string) { const digits = value.replace(/[^0-9]/g, "").slice(0, 8); return [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean).join("-"); }
function calendarDays(month: Date) { const mondayOffset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7; const first = new Date(month.getFullYear(), month.getMonth(), 1 - mondayOffset); return Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index)); }
function formatPeriod(start?: string, end?: string) { if (!start || !end) return "Promotion period not set"; return `${new Date(start).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })} – ${new Date(end).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}`; }
function formatDiscount(discount?: Promotion["discount"]) { if (!discount) return "Direct discount"; if (discount.type === "percentage") return `${discount.value}% off`; if (discount.type === "fixed_amount") return `RM ${Number(discount.value).toFixed(2)} off`; return `Buy ${discount.buy_quantity}, get ${discount.gift_quantity} free`; }
function promotionPrice(product: Product, type: string, value: string, buyQuantity: string, giftQuantity: string) { const price = Number(product.price), amount = Number(value); if (type === "percentage" && amount > 0) return Math.max(0, price * (1 - amount / 100)); if (type === "fixed_amount" && amount > 0) return Math.max(0, price - amount); if (type === "buy_x_get_y") { const buy = Number(buyQuantity), gift = Number(giftQuantity); if (buy > 0 && gift > 0) return price * buy / (buy + gift); } return price; }
async function copyText(value: string) { try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return; } } catch { /* Use the fallback when Clipboard API access is blocked. */ } const field = document.createElement("textarea"); field.value = value; field.style.position = "fixed"; field.style.opacity = "0"; document.body.appendChild(field); field.select(); document.execCommand("copy"); field.remove(); }
