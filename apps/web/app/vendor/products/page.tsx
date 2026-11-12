"use client";

import {
  CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Grid2X2, ImagePlus,
  List, Minus, PackagePlus, Pencil, Plus, Search, Tag, Trash2, TriangleAlert, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { MARKETPLACE_PRODUCT_CATEGORIES } from "@ecochef/contracts";

import { createAuthenticatedWebApi } from "../../../src/lib/api";
import { StoreRequired } from "../components/store-required";
import { useVendor, type Product } from "../components/vendor-context";

const categories = [...MARKETPLACE_PRODUCT_CATEGORIES];
const subcategories: Record<string, string[]> = {
  Produce: ["Fruits", "Vegetables", "Herbs & Aromatics", "Mushrooms"],
  Bakery: ["Bread", "Pastries", "Cakes", "Biscuits & Cookies"],
  Pantry: ["Rice, Pasta & Noodles", "Canned & Jarred Food", "Sauces & Condiments", "Cooking Essentials"],
  "Prepared Food": ["Ready Meals", "Sandwiches & Wraps", "Salads", "Soups"],
  Beverages: ["Waters", "Carbonated Beverages", "Sports & Energy Drinks", "Juices", "Tea & Coffee"],
  Dairy: ["Milk", "Cheese", "Yoghurt", "Butter & Cream", "Plant-based Alternatives"],
  "Snacks & Confectionery": ["Chips & Crisps", "Chocolate & Candy", "Biscuits & Cookies", "Nuts & Seeds"],
};
const acceptedImages = ["image/jpeg", "image/png", "image/webp"] as const;
type AcceptedImage = typeof acceptedImages[number];
type AddonOptionDraft = { id: string; name: string; price: string };
type AddonDraft = { id: string; name: string; required: boolean; selectionMode: "single" | "multiple"; maxSelections: string; options: AddonOptionDraft[] };
type DeleteTarget = { kind: "group"; groupId: string } | { kind: "option"; groupId: string; optionId: string };
type QuantityTarget = { product: Product; amount: number };
type DiscountPeriod = { starts_at: string; ends_at: string };
type DiscountPayload = ({ type: "percentage" | "fixed_amount"; value: number } | { type: "buy_x_get_y"; buy_quantity: number; gift_quantity: number }) & DiscountPeriod;

const emptyDraft = () => ({
  name: "", description: "", category: "", subcategory: "", brand: "", size: "", stockQuantity: "", listingPrice: "",
  discountType: "No discount", discountValue: "", buyQuantity: "", giftQuantity: "",
  discountStartDate: "", discountStartTime: "00:00", discountEndDate: "", discountEndTime: "23:59",
  expiryDate: "", imageDataUrl: "", imageFile: undefined as File | undefined,
  addons: [] as AddonDraft[],
});

const makeId = () => Math.random().toString(36).slice(2);

function vendorProductImageSrc(value: string) {
  if (value.startsWith("data:") || value.startsWith("blob:")) return value;
  try {
    const pathname = new URL(value, "http://ecochef.local").pathname;
    const marker = "/api/v1/vendor/product-images/";
    if (pathname.includes(marker)) return `/api/ecochef/vendor/product-images/${pathname.split(marker)[1]}`;
  } catch { /* The image error fallback handles malformed legacy URLs. */ }
  return value;
}

function isProductExpired(product: Product) {
  if (!product.expiry_date) return false;
  const expiry = new Date(product.expiry_date);
  return Number.isFinite(expiry.getTime()) && Math.ceil((expiry.getTime() - Date.now()) / 86_400_000) < 0;
}

export default function Products() {
  const { stores, reload, refreshProducts } = useVendor();
  const shop = stores[0];
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [grid, setGrid] = useState(true);
  const [modal, setModal] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>();
  const [pendingImage, setPendingImage] = useState<{ source: string; name: string }>();
  const [editingProduct, setEditingProduct] = useState<Product>();
  const [productDeleteTarget, setProductDeleteTarget] = useState<Product>();
  const [deletingProduct, setDeletingProduct] = useState(false);
  const [productDeleteError, setProductDeleteError] = useState("");
  const [quantityTarget, setQuantityTarget] = useState<QuantityTarget>();
  const [applyingQuantity, setApplyingQuantity] = useState(false);
  const formScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const open = () => setModal(true); window.addEventListener("ecochef:add-product", open); return () => window.removeEventListener("ecochef:add-product", open); }, []);
  useEffect(() => {
    let inFlight = false;
    const refresh = () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      void refreshProducts().catch(() => undefined).finally(() => { inFlight = false; });
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [refreshProducts]);

  const products = useMemo(() => (shop?.products ?? []).filter((product) =>
    (filter === "All" || filter === "Active" && product.status === "active" && product.stock_quantity > 0 && !isProductExpired(product) ||
      filter === "Low Stock" && product.stock_quantity > 0 && product.stock_quantity < 5 ||
      filter === "Out of Stock" && product.stock_quantity === 0) &&
    product.name.toLowerCase().includes(query.toLowerCase())), [shop, filter, query]);

  const close = () => { if (!saving) { setModal(false); setEditingProduct(undefined); setDraft(emptyDraft()); setError(""); } };
  const showFormError = (message: string) => {
    setError(message);
    requestAnimationFrame(() => formScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
  };
  const editProduct = (product: Product) => {
    const localParts = (value?: string) => { if (!value) return { date: "", time: "" }; const date = new Date(value); return { date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`, time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}` }; };
    const start = localParts(product.discount?.starts_at); const end = localParts(product.discount?.ends_at);
    setEditingProduct(product);
    setDraft({
      name: product.name, description: product.description ?? "", category: product.category ?? "", subcategory: product.subcategory ?? "", brand: product.brand ?? "", size: product.size ?? "", stockQuantity: String(product.stock_quantity), listingPrice: String(product.price),
      discountType: product.discount?.type === "percentage" ? "Percentage" : product.discount?.type === "fixed_amount" ? "Fixed amount" : product.discount?.type === "buy_x_get_y" ? "Buy X, get Y free" : "No discount",
      discountValue: product.discount && product.discount.type !== "buy_x_get_y" ? String(product.discount.value) : "",
      buyQuantity: product.discount?.type === "buy_x_get_y" ? String(product.discount.buy_quantity) : "", giftQuantity: product.discount?.type === "buy_x_get_y" ? String(product.discount.gift_quantity) : "",
      discountStartDate: start.date, discountStartTime: start.time || "00:00", discountEndDate: end.date, discountEndTime: end.time || "23:59",
      expiryDate: product.expiry_date ? localParts(product.expiry_date).date : "", imageDataUrl: product.image_url ?? "", imageFile: undefined,
      addons: (product.addons ?? []).map((group) => ({ id: makeId(), name: group.name, required: group.required, selectionMode: group.selection_mode, maxSelections: String(group.max_selections), options: group.options.map((option) => ({ id: makeId(), name: option.name, price: option.price ? String(option.price) : "" })) })),
    });
    setError(""); setModal(true);
  };

  const selectImage = (file?: File) => {
    if (!file) return;
    if (!acceptedImages.includes(file.type as AcceptedImage)) {
      setError("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("Product images must be smaller than 8 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPendingImage({ source: String(reader.result), name: file.name });
      setError("");
    };
    reader.readAsDataURL(file);
  };

  const addGroup = () => setDraft((current) => ({
    ...current,
    addons: [...current.addons, {
      id: makeId(), name: "", required: false, selectionMode: "single", maxSelections: "1",
      options: [{ id: makeId(), name: "", price: "" }],
    }],
  }));

  const updateGroup = (groupId: string, update: Partial<AddonDraft>) => setDraft((current) => ({
    ...current,
    addons: current.addons.map((group) => group.id === groupId ? { ...group, ...update } : group),
  }));

  const updateOption = (groupId: string, optionId: string, update: Partial<AddonOptionDraft>) =>
    setDraft((current) => ({
      ...current,
      addons: current.addons.map((group) => group.id === groupId ? {
        ...group, options: group.options.map((option) => option.id === optionId ? { ...option, ...update } : option),
      } : group),
    }));

  const removeGroup = (group: AddonDraft) => {
    const hasContent = !!group.name.trim() || group.options.some((option) => !!option.name.trim() || option.price !== "");
    if (hasContent) return setDeleteTarget({ kind: "group", groupId: group.id });
    setDraft((current) => ({ ...current, addons: current.addons.filter((item) => item.id !== group.id) }));
  };

  const removeOption = (group: AddonDraft, option: AddonOptionDraft) => {
    if (option.name.trim() || option.price !== "") return setDeleteTarget({ kind: "option", groupId: group.id, optionId: option.id });
    const options = group.options.filter((item) => item.id !== option.id);
    updateGroup(group.id, { options, maxSelections: String(Math.min(Number(group.maxSelections) || 1, options.length)) });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    setDraft((current) => ({ ...current, addons: deleteTarget.kind === "group"
      ? current.addons.filter((group) => group.id !== deleteTarget.groupId)
      : current.addons.map((group) => group.id === deleteTarget.groupId
        ? (() => { const options = group.options.filter((option) => option.id !== deleteTarget.optionId); return { ...group, options, maxSelections: String(Math.min(Number(group.maxSelections) || 1, options.length)) }; })()
        : group) }));
    setDeleteTarget(undefined);
  };

  const save = async () => {
    if (!shop || saving) return;
    const listingPrice = Number(draft.listingPrice);
    if (!draft.name.trim() || !draft.category || !draft.subcategory || draft.stockQuantity === "" || draft.listingPrice === "") {
      showFormError("Complete the product name, category, product type, stock quantity, and listing price.");
      return;
    }
    let discount: DiscountPayload | undefined;
    const period = draft.discountStartDate && draft.discountEndDate ? { starts_at: new Date(`${draft.discountStartDate}T${draft.discountStartTime}`).toISOString(), ends_at: new Date(`${draft.discountEndDate}T${draft.discountEndTime}`).toISOString() } : undefined;
    if (draft.discountType !== "No discount" && !period) return showFormError("Choose the discount start and end date and time.");
    if (period && new Date(period.ends_at) <= new Date(period.starts_at)) return showFormError("The discount must end after it starts.");
    if (draft.discountType === "Percentage") discount = { type: "percentage", value: Number(draft.discountValue), ...period! };
    if (draft.discountType === "Fixed amount") discount = { type: "fixed_amount", value: Number(draft.discountValue), ...period! };
    if (draft.discountType === "Buy X, get Y free") discount = { type: "buy_x_get_y", buy_quantity: Number(draft.buyQuantity), gift_quantity: Number(draft.giftQuantity), ...period! };
    if (discount?.type === "percentage" && (discount.value <= 0 || discount.value >= 100)) return showFormError("The discount must be below 100% so the product does not become free.");
    if (discount?.type === "fixed_amount" && (discount.value <= 0 || discount.value >= listingPrice)) return showFormError("The fixed discount must be greater than RM 0 and less than the listing price.");
    if (discount?.type === "buy_x_get_y" && (discount.buy_quantity < 1 || discount.gift_quantity < 1)) return showFormError("Enter at least one purchased item and one free item for the gift offer.");
    if (draft.addons.some((group) => !group.name.trim() || group.options.length === 0 ||
      group.options.some((option) => !option.name.trim() || Number(option.price || 0) < 0) ||
      Number(group.maxSelections) < 1 || Number(group.maxSelections) > group.options.length)) {
      showFormError("Complete every add-on group and option, including a valid price.");
      return;
    }
    setSaving(true); setError("");
    try {
      const api = createAuthenticatedWebApi("/api/ecochef");
      let imageUrl: string | undefined = draft.imageDataUrl ? editingProduct?.image_url : undefined;
      if (draft.imageFile && draft.imageDataUrl) {
        const encoded = draft.imageDataUrl.split(",", 2)[1];
        const uploaded = await api.uploadVendorProductImage({ data: encoded, content_type: draft.imageFile.type as AcceptedImage });
        imageUrl = uploaded.image_url;
      }
      const payload = {
        name: draft.name.trim(), description: draft.description.trim() || undefined, category: draft.category, subcategory: draft.subcategory,
        brand: draft.brand.trim() || undefined, size: draft.size.trim() || undefined,
        stock_quantity: Number(draft.stockQuantity), price: listingPrice,
        expiry_date: draft.expiryDate ? new Date(draft.expiryDate).toISOString() : undefined,
        image_url: imageUrl, status: Number(draft.stockQuantity) === 0 ? "sold_out" as const : (editingProduct?.status === "hidden" ? "hidden" as const : "active" as const), unit_label: editingProduct?.unit_label ?? "item",
        addons: draft.addons.map((group) => ({
          name: group.name.trim(), required: group.required, selection_mode: group.selectionMode,
          max_selections: group.selectionMode === "single" ? 1 : Number(group.maxSelections),
          options: group.options.map((option) => ({ name: option.name.trim(), price: Number(option.price || 0) })),
        })),
        discount,
      };
      if (editingProduct) await api.updateVendorProduct(shop.id, editingProduct.id, payload);
      else await api.createVendorProduct(shop.id, payload);
      await reload(); close();
    } catch (reason) {
      showFormError(reason instanceof Error ? reason.message : "The product could not be saved.");
    } finally { setSaving(false); }
  };

  const confirmQuantity = async () => {
    if (!shop || !quantityTarget || applyingQuantity) return;
    setApplyingQuantity(true);
    try {
      await createAuthenticatedWebApi("/api/ecochef").updateVendorProduct(shop.id, quantityTarget.product.id, { ...quantityTarget.product, stock_quantity: quantityTarget.amount, status: quantityTarget.amount === 0 ? "sold_out" : quantityTarget.product.status === "hidden" ? "hidden" : "active" });
      setQuantityTarget(undefined); await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The stock quantity could not be updated."); }
    finally { setApplyingQuantity(false); }
  };
  const confirmProductDelete = async () => {
    if (!shop || !productDeleteTarget || deletingProduct) return;
    setDeletingProduct(true); setProductDeleteError("");
    try {
      await createAuthenticatedWebApi("/api/ecochef").deleteVendorProduct(shop.id, productDeleteTarget.id);
      setProductDeleteTarget(undefined); await reload();
    } catch (reason) {
      setProductDeleteError(reason instanceof Error ? reason.message : "The product could not be deleted.");
    } finally { setDeletingProduct(false); }
  };

  const priceReference = calculatePriceReference(
    Number(draft.listingPrice), draft.discountType, Number(draft.discountValue),
    Number(draft.buyQuantity), Number(draft.giftQuantity),
  );
  const discountWarning = draft.discountType === "Percentage" && Number(draft.discountValue) >= 100
    ? "This discount makes the product free. Enter a percentage below 100%."
    : draft.discountType === "Fixed amount" && draft.discountValue !== "" && Number(draft.discountValue) >= Number(draft.listingPrice)
      ? "This discount makes the final price zero or negative. Enter an amount below the listing price."
      : "";

  return <StoreRequired><main className="workspace">
    <PageHead title="Products" badge={`${shop?.products.length ?? 0} Items Listed`} action={<button className="cta" onClick={() => setModal(true)}>+ Add New Product</button>} />
    <div className="filterbar product-filterbar"><div>{["All", "Active", "Low Stock", "Out of Stock"].map((value) => <button className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{value}</button>)}</div><label><Search size={15} /><input placeholder="Search inventory" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="layout-toggle"><button aria-label="Grid view" onClick={() => setGrid(true)} className={grid ? "active" : ""}><Grid2X2 size={16} /></button><button aria-label="List view" onClick={() => setGrid(false)} className={!grid ? "active" : ""}><List size={16} /></button></div></div>
    {products.length ? <div className={grid ? "product-grid" : "product-table"}>{products.map((product) => <ProductInventoryItem key={product.id} product={product} requestQuantity={(amount) => setQuantityTarget({ product, amount })} edit={() => editProduct(product)} requestDelete={() => { setProductDeleteError(""); setProductDeleteTarget(product); }} />)}</div> : <div className="product-filter-empty"><PackagePlus size={28} /><strong>No result found</strong><p>Try another search term or inventory filter.</p></div>}
    {quantityTarget ? <div className="modal-backdrop"><section className="modal-card confirm-card quantity-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="quantity-confirm-title"><span><PackagePlus /></span><h2 id="quantity-confirm-title">Apply stock change?</h2><p>Change <strong>{quantityTarget.product.name}</strong> from {quantityTarget.product.stock_quantity} to {quantityTarget.amount} item{quantityTarget.amount === 1 ? "" : "s"}?</p><footer><button type="button" className="neutral-button" disabled={applyingQuantity} onClick={() => setQuantityTarget(undefined)}>Keep Editing</button><button type="button" className="cta" disabled={applyingQuantity} onClick={() => void confirmQuantity()}>{applyingQuantity ? "Applying…" : "Apply Change"}</button></footer></section></div> : null}
    {productDeleteTarget ? <div className="modal-backdrop"><section className="modal-card confirm-card product-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-product-title"><span><Trash2 /></span><h2 id="delete-product-title">Delete {productDeleteTarget.name}?</h2><p>This product will be permanently removed from your inventory. This action cannot be undone.</p>{productDeleteError ? <p className="product-form-error" role="alert">{productDeleteError}</p> : null}<footer><button type="button" className="neutral-button" disabled={deletingProduct} onClick={() => setProductDeleteTarget(undefined)}>Keep Product</button><button type="button" className="danger-button" disabled={deletingProduct} onClick={() => void confirmProductDelete()}>{deletingProduct ? "Deleting…" : "Delete Product"}</button></footer></section></div> : null}
    {modal ? <div className="modal-backdrop"><form className="modal-card product-create-modal" onSubmit={(event) => event.preventDefault()} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}>
      <header><div><span>{editingProduct ? <Pencil /> : <PackagePlus />}</span><div><small>INVENTORY</small><h2>{editingProduct ? "Edit Product" : "Add New Product"}</h2></div></div><button type="button" aria-label="Close product form" onClick={close}><X /></button></header>
      <div className="product-form-scroll" ref={formScrollRef}>
        {error ? <p className="product-form-error" role="alert">{error}</p> : null}
        <section className="product-form-section">
          <h3>Product details</h3>
          <label><span className="product-field-title">Product name <b>*</b></span><input required maxLength={100} placeholder="e.g. Honeycrisp Apple" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label><span className="product-field-title">Description</span><textarea className="product-description-input" maxLength={100} rows={3} placeholder="Describe the product, portion, or important details" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /><small>{draft.description.length}/100 characters</small></label>
          <label><span className="product-field-title">Category <b>*</b></span><ThemedSelect value={draft.category} placeholder="Select category" options={categories} onChange={(category) => setDraft({ ...draft, category, subcategory: "" })} /></label>
          <label><span className="product-field-title">Product type <b>*</b></span><ThemedSelect value={draft.subcategory} placeholder={draft.category ? "Select product type" : "Select a category first"} options={subcategories[draft.category] ?? []} onChange={(subcategory) => setDraft({ ...draft, subcategory })} /></label>
          <div className="product-two-fields"><label><span className="product-field-title">Brand</span><input maxLength={100} placeholder="e.g. DOREMI" value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /><small>Optional</small></label><label><span className="product-field-title">Size</span><input maxLength={40} placeholder="e.g. 500 g or 6 per pack" value={draft.size} onChange={(event) => setDraft({ ...draft, size: event.target.value })} /><small>Optional</small></label></div>
          <label className="stock-field"><span className="product-field-title">Stock quantity <b>*</b></span><input required type="number" min="0" step="1" placeholder="0" value={draft.stockQuantity} onChange={(event) => setDraft({ ...draft, stockQuantity: event.target.value })} /></label>
          <label><span className="product-field-title">Listing price (RM) <b>*</b></span><MoneyInput required value={draft.listingPrice} onChange={(listingPrice) => setDraft({ ...draft, listingPrice })} /></label>
          <div className="discount-builder">
            <label>Discount type<ThemedSelect value={draft.discountType} placeholder="Select discount" options={["No discount", "Percentage", "Fixed amount", "Buy X, get Y free"]} onChange={(discountType) => setDraft({ ...draft, discountType, discountValue: "", buyQuantity: "", giftQuantity: "" })} /></label>
            {draft.discountType === "Percentage" ? <label>Discount percentage<input type="number" min="0.01" max="99.99" step="0.01" placeholder="10" value={draft.discountValue} onChange={(event) => setDraft({ ...draft, discountValue: event.target.value })} /></label> : null}
            {draft.discountType === "Fixed amount" ? <label>Subtract from price<MoneyInput value={draft.discountValue} onChange={(discountValue) => setDraft({ ...draft, discountValue })} /></label> : null}
            {draft.discountType === "Buy X, get Y free" ? <div className="gift-discount-fields"><label>Customer buys<input type="number" min="1" step="1" placeholder="1" value={draft.buyQuantity} onChange={(event) => setDraft({ ...draft, buyQuantity: event.target.value })} /></label><label>Customer receives free<input type="number" min="1" step="1" placeholder="1" value={draft.giftQuantity} onChange={(event) => setDraft({ ...draft, giftQuantity: event.target.value })} /></label></div> : null}
            {draft.discountType !== "No discount" ? <DiscountPeriodPicker startDate={draft.discountStartDate} endDate={draft.discountEndDate} startTime={draft.discountStartTime} endTime={draft.discountEndTime} onChange={(values) => setDraft({ ...draft, ...values })} /> : null}
          </div>
          {discountWarning ? <p className="discount-warning" role="alert"><TriangleAlert />{discountWarning}</p> : null}
          {priceReference ? <div className="price-reference"><header><strong>Price reference</strong><span>{priceReference.offerLabel}</span></header><dl><div><dt>Listing price</dt><dd>RM {priceReference.listingPrice.toFixed(2)}</dd></div>{priceReference.discountAmount > 0 ? <div><dt>Product discount</dt><dd className="fee">− RM {priceReference.discountAmount.toFixed(2)}</dd></div> : null}<div><dt>{priceReference.customerLabel}</dt><dd>RM {priceReference.customerPrice.toFixed(2)}</dd></div><div><dt>EcoChef service fee (15%)</dt><dd className="fee">− RM {priceReference.fee.toFixed(2)}</dd></div><div className="proceeds"><dt>Your estimated proceeds</dt><dd>RM {priceReference.proceeds.toFixed(2)}</dd></div></dl></div> : null}
          <label>Best before / expiry<ProductDatePicker value={draft.expiryDate} onChange={(expiryDate) => setDraft({ ...draft, expiryDate })} /><small>Optional. Expired products are automatically hidden from shoppers.</small></label>
        </section>
        <section className="product-form-section">
          <h3>Product image</h3>
          <label className={`product-image-upload${draft.imageDataUrl ? " has-image" : ""}`}>{draft.imageDataUrl ? <img src={vendorProductImageSrc(draft.imageDataUrl)} alt="Selected product preview" /> : <span><ImagePlus /><strong>Tap to upload an image</strong><small>JPG, PNG or WebP · maximum 8 MB</small></span>}<input type="file" accept={acceptedImages.join(",")} onChange={(event) => { selectImage(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
          {draft.imageDataUrl ? <button type="button" className="product-image-remove" onClick={() => setDraft({ ...draft, imageDataUrl: "", imageFile: undefined })}><Trash2 /> Remove image</button> : null}
        </section>
        <section className="product-form-section addon-section">
          <div className="section-heading"><div><h3>Add-ons</h3><p>Create optional or required choices that customers can add to this product.</p></div><button type="button" onClick={addGroup}><Plus /> Add group</button></div>
          {draft.addons.length === 0 ? <div className="addon-empty"><PackagePlus /><p>No add-ons yet. For example, add a “Packaging” group with an “Eco gift box” option for + RM 1.00.</p></div> : null}
          {draft.addons.map((group, groupIndex) => <article className="addon-group" key={group.id}>
            <header><strong>Add-on group {groupIndex + 1}</strong><button type="button" aria-label={`Remove add-on group ${groupIndex + 1}`} onClick={() => removeGroup(group)}><Trash2 /></button></header>
            <div className="addon-group-grid"><label><span className="product-field-title">Group name <b>*</b></span><input required placeholder="e.g. Packaging" value={group.name} onChange={(event) => updateGroup(group.id, { name: event.target.value })} /></label><label><span className="product-field-title">Customer selection <b>*</b></span><ThemedSelect value={group.required ? "Required" : "Optional"} placeholder="Select requirement" options={["Optional", "Required"]} onChange={(value) => updateGroup(group.id, { required: value === "Required" })} /></label><label><span className="product-field-title">Option style <b>*</b></span><ThemedSelect value={group.selectionMode === "single" ? "Radio button (single)" : "Multi-select"} placeholder="Select option style" options={["Radio button (single)", "Multi-select"]} onChange={(value) => updateGroup(group.id, { selectionMode: value === "Multi-select" ? "multiple" : "single", maxSelections: value === "Multi-select" ? group.maxSelections : "1" })} /></label>{group.selectionMode === "multiple" ? <label><span className="product-field-title">Maximum selections <b>*</b></span><input type="number" required min="1" max={group.options.length} step="1" value={group.maxSelections} onChange={(event) => updateGroup(group.id, { maxSelections: event.target.value })} /><small>Must not exceed the {group.options.length} available option{group.options.length === 1 ? "" : "s"}.</small></label> : null}</div>
            <div className="addon-options"><div className="addon-option-head"><span>Option name</span><span>Additional price (optional)</span><span /></div>{group.options.map((option) => <div className="addon-option-row" key={option.id}><input required placeholder="e.g. Eco gift box" value={option.name} onChange={(event) => updateOption(group.id, option.id, { name: event.target.value })} /><MoneyInput value={option.price} onChange={(price) => updateOption(group.id, option.id, { price })} /><button type="button" aria-label="Remove option" disabled={group.options.length === 1} onClick={() => removeOption(group, option)}><X /></button></div>)}</div>
            <button type="button" className="add-addon-option" onClick={() => updateGroup(group.id, { options: [...group.options, { id: makeId(), name: "", price: "" }] })}><Plus /> Add option</button>
          </article>)}
        </section>
      </div>
      <footer><button type="button" className="neutral-button" disabled={saving} onClick={close}>Cancel</button><button type="button" className="cta" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : editingProduct ? "Save Changes" : "Create Product"}</button></footer>
    </form>{pendingImage ? <ProductImageCropModal source={pendingImage.source} cancel={() => setPendingImage(undefined)} confirm={(dataUrl) => { setDraft((current) => ({ ...current, imageDataUrl: dataUrl, imageFile: new File([dataUrlToBlob(dataUrl)], pendingImage.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }) })); setPendingImage(undefined); }} /> : null}{deleteTarget ? <div className="product-delete-confirm-backdrop"><section className="product-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-addon-title"><span><TriangleAlert /></span><h3 id="delete-addon-title">Delete entered add-on information?</h3><p>{deleteTarget.kind === "group" ? "This add-on group contains information. Deleting it will remove all of its options." : "This option contains a name or price. Deleting it cannot be undone."}</p><footer><button type="button" onClick={() => setDeleteTarget(undefined)}>Keep it</button><button type="button" onClick={confirmDelete}>Delete</button></footer></section></div> : null}</div> : null}
  </main></StoreRequired>;
}

function ProductInventoryItem({ product, requestQuantity, edit, requestDelete }: { product: Product; requestQuantity: (amount: number) => void; edit: () => void; requestDelete: () => void }) {
  const [quantity, setQuantity] = useState(product.stock_quantity);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setQuantity(product.stock_quantity), [product.stock_quantity]);
  useEffect(() => setImageFailed(false), [product.image_url]);
  const expiry = product.expiry_date ? new Date(product.expiry_date) : undefined;
  const daysToExpiry = expiry ? Math.ceil((expiry.getTime() - Date.now()) / 86_400_000) : undefined;
  const stockTone = product.stock_quantity === 0 ? "out" : product.stock_quantity < 5 ? "low" : "ready";
  const stockLabel = product.stock_quantity === 0 ? "Out of stock" : product.stock_quantity < 5 ? "Low stock" : "In stock";
  let discountLabel: string | undefined;
  if (product.discount?.type === "percentage") discountLabel = `${product.discount.value}% off`;
  else if (product.discount?.type === "fixed_amount") discountLabel = `RM ${product.discount.value.toFixed(2)} off`;
  else if (product.discount?.type === "buy_x_get_y") discountLabel = `Buy ${product.discount.buy_quantity}, get ${product.discount.gift_quantity} free`;
  const availability = product.stock_quantity === 0 || isProductExpired(product) ? "inactive" : product.status === "active" ? "active" : "inactive";
  return <article className="inventory-product-card">
    <div className="product-image">{product.image_url && !imageFailed ? <img src={vendorProductImageSrc(product.image_url)} alt={product.name} onError={() => setImageFailed(true)} /> : <span className="product-image-fallback" aria-label={`${product.name} image unavailable`}>🥬</span>}<i className={`product-status ${availability}`}>{availability}</i><span className="card-management-actions"><button type="button" className="product-edit-button" aria-label={`Edit ${product.name}`} onClick={edit}><Pencil size={16} /></button><button type="button" className="product-delete-button" aria-label={`Delete ${product.name}`} onClick={requestDelete}><Trash2 size={16} /></button></span></div>
    <div className="product-copy">
      <div className="product-card-heading"><div><small>{product.category || "Uncategorised"}</small><h3>{product.name}</h3>{discountLabel ? <span className="product-discount-badge discount-row"><Tag />{discountLabel}</span> : null}</div><strong>RM {Number(product.price).toFixed(2)}</strong></div>
      {product.description ? <p className="product-card-description">{product.description}</p> : null}
      <div className="product-card-meta"><span className={`stock-chip ${stockTone}`}><PackagePlus />{stockLabel} · {product.stock_quantity}</span>{discountLabel ? <span className="product-discount-badge discount-card"><Tag />{discountLabel}</span> : null}<span className={daysToExpiry !== undefined && daysToExpiry <= 3 ? "expiry-chip urgent" : "expiry-chip"}><CalendarDays />{expiry ? `${daysToExpiry! < 0 ? "Expired" : "Best before"} ${expiry.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })}` : "No expiry date"}</span>{product.addons?.length ? <span className="addon-chip"><Plus />{product.addons.length} add-on group{product.addons.length === 1 ? "" : "s"}</span> : null}</div>
      <div className="product-card-actions"><span className="row-management-actions"><button type="button" className="product-edit-button" aria-label={`Edit ${product.name}`} onClick={edit}><Pencil size={16} /></button><button type="button" className="product-delete-button" aria-label={`Delete ${product.name}`} onClick={requestDelete}><Trash2 size={16} /></button></span><div className="quantity"><button type="button" aria-label={`Reduce ${product.name} stock`} disabled={quantity === 0} onClick={() => setQuantity((current) => Math.max(0, current - 1))}><Minus size={14} /></button><b aria-label={`${quantity} items selected`}>{quantity}</b><button type="button" aria-label={`Increase ${product.name} stock`} onClick={() => setQuantity((current) => current + 1)}><Plus size={14} /></button></div><button type="button" className="apply-stock-button" disabled={quantity === product.stock_quantity} onClick={() => requestQuantity(quantity)}>Apply</button></div>
    </div>
  </article>;
}

function calculatePriceReference(listingPrice: number, discountType: string, discountValue: number, buyQuantity: number, giftQuantity: number) {
  if (!Number.isFinite(listingPrice) || listingPrice < 0) return undefined;
  let charged = listingPrice;
  let customerPrice = listingPrice;
  let customerLabel = "Customer price per item";
  let offerLabel = "No product discount";
  if (discountType === "Percentage" && discountValue > 0 && discountValue <= 100) {
    customerPrice = listingPrice * (1 - discountValue / 100);
    charged = customerPrice;
    offerLabel = `${discountValue}% off`;
  } else if (discountType === "Fixed amount" && discountValue > 0 && discountValue < listingPrice) {
    customerPrice = listingPrice - discountValue;
    charged = customerPrice;
    offerLabel = `RM ${discountValue.toFixed(2)} off`;
  } else if (discountType === "Buy X, get Y free" && buyQuantity > 0 && giftQuantity > 0) {
    charged = listingPrice * buyQuantity;
    customerPrice = charged / (buyQuantity + giftQuantity);
    customerLabel = `Offer total (${buyQuantity + giftQuantity} items)`;
    offerLabel = `Buy ${buyQuantity}, get ${giftQuantity} free · RM ${customerPrice.toFixed(2)} effective per item`;
  }
  const fee = charged * .15;
  return { listingPrice, discountAmount: discountType === "Buy X, get Y free" ? listingPrice * giftQuantity : Math.max(0, listingPrice - customerPrice), customerPrice: discountType === "Buy X, get Y free" ? charged : customerPrice, customerLabel, offerLabel, fee, proceeds: charged - fee };
}

function dataUrlToBlob(dataUrl: string) {
  const [metadata, encoded] = dataUrl.split(",", 2);
  const bytes = atob(encoded); const buffer = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) buffer[index] = bytes.charCodeAt(index);
  return new Blob([buffer], { type: metadata.match(/data:(.*?);/)?.[1] ?? "image/jpeg" });
}

function ProductImageCropModal({ source, cancel, confirm }: { source: string; cancel: () => void; confirm: (value: string) => void }) {
  const preview = { width: 480, height: 320 }; const output = { width: 1200, height: 800 };
  const imageRef = useRef<HTMLImageElement>(null); const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | undefined>(undefined);
  const [imageSize, setImageSize] = useState(preview); const [position, setPosition] = useState({ x: 0, y: 0 }); const [zoom, setZoom] = useState(1);
  const baseScale = Math.max(preview.width / imageSize.width, preview.height / imageSize.height);
  const renderedWidth = imageSize.width * baseScale * zoom; const renderedHeight = imageSize.height * baseScale * zoom;
  const clamp = (next: { x: number; y: number }, nextZoom = zoom) => ({ x: Math.max(-(imageSize.width * baseScale * nextZoom - preview.width) / 2, Math.min((imageSize.width * baseScale * nextZoom - preview.width) / 2, next.x)), y: Math.max(-(imageSize.height * baseScale * nextZoom - preview.height) / 2, Math.min((imageSize.height * baseScale * nextZoom - preview.height) / 2, next.y)) });
  const start = (event: ReactPointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, ...position }; };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => { const drag = dragRef.current; if (drag?.pointerId === event.pointerId) setPosition(clamp({ x: drag.x + event.clientX - drag.clientX, y: drag.y + event.clientY - drag.clientY })); };
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => { if (dragRef.current?.pointerId === event.pointerId) dragRef.current = undefined; };
  const saveCrop = () => { const image = imageRef.current; if (!image) return; const canvas = document.createElement("canvas"); canvas.width = output.width; canvas.height = output.height; const context = canvas.getContext("2d"); if (!context) return; const ratio = output.width / preview.width; context.drawImage(image, ((preview.width - renderedWidth) / 2 + position.x) * ratio, ((preview.height - renderedHeight) / 2 + position.y) * ratio, renderedWidth * ratio, renderedHeight * ratio); confirm(canvas.toDataURL("image/jpeg", .9)); };
  return <div className="product-crop-backdrop"><section className="modal-card product-crop-modal" role="dialog" aria-modal="true" aria-labelledby="product-crop-title"><header><div><h2 id="product-crop-title">Edit product image</h2><p>Drag to reposition and use the slider to zoom before confirming.</p></div><button type="button" aria-label="Cancel image editing" onClick={cancel}><X /></button></header><div className="product-crop-viewport" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}><img ref={imageRef} src={source} alt="Product crop preview" draggable={false} onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} style={{ width: renderedWidth, height: renderedHeight, transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))` }} /></div><label className="logo-zoom-control"><ZoomOut /><span className="sr-only">Image zoom</span><input type="range" min="1" max="3" step="0.05" value={zoom} onChange={(event) => { const value = Number(event.target.value); setZoom(value); setPosition((current) => clamp(current, value)); }} /><ZoomIn /></label><footer><button type="button" onClick={cancel}>Choose another</button><button type="button" className="cta" onClick={saveCrop}><Check /> Confirm image</button></footer></section></div>;
}

type PeriodValues = { discountStartDate: string; discountEndDate: string; discountStartTime: string; discountEndTime: string };
function DiscountTimeInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  const hour = Math.min(23, Number(match?.[1] ?? 0));
  const minute = Math.min(59, Number(match?.[2] ?? 0));
  const update = (nextHour: number, nextMinute: number) => onChange(`${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return <div className="discount-time-picker" ref={root}><div className="discount-time-input"><input type="text" inputMode="numeric" aria-label={label} value={value} placeholder="HH:MM" maxLength={5} onClick={() => setOpen(true)} onChange={(event) => onChange(event.target.value)} /><button type="button" aria-label={`Open ${label.toLowerCase()} selector`} aria-expanded={open} onClick={() => setOpen((current) => !current)}><Clock /></button></div>{open ? <section className="discount-time-popover" role="dialog" aria-label={label}><header><Clock /><strong>{String(hour).padStart(2, "0")}:{String(minute).padStart(2, "0")}</strong></header><label><span>Hour</span><output>{String(hour).padStart(2, "0")}</output><input type="range" min="0" max="23" step="1" value={hour} onChange={(event) => update(Number(event.target.value), minute)} /></label><label><span>Minute</span><output>{String(minute).padStart(2, "0")}</output><input type="range" min="0" max="59" step="1" value={minute} onChange={(event) => update(hour, Number(event.target.value))} /></label><footer><button type="button" onClick={() => setOpen(false)}>Done</button></footer></section> : null}</div>;
}

function DiscountPeriodPicker({ startDate, endDate, startTime, endTime, onChange }: { startDate: string; endDate: string; startTime: string; endTime: string; onChange: (value: Partial<PeriodValues>) => void }) {
  const [month, setMonth] = useState(new Date()); const [dragStart, setDragStart] = useState("");
  const first = new Date(month.getFullYear(), month.getMonth(), 1); const start = new Date(first); start.setDate(first.getDate() - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date; });
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const commitRange = (from: string, to: string) => onChange(from <= to ? { discountStartDate: from, discountEndDate: to } : { discountStartDate: to, discountEndDate: from });
  return <fieldset className="discount-period"><legend>Discount period <b>*</b></legend><div className="discount-period-inputs"><label><span>Starts</span><div className="discount-period-control-row"><ProductDatePicker value={startDate} onChange={(discountStartDate) => onChange({ discountStartDate })} /><DiscountTimeInput label="Discount start time" value={startTime} onChange={(discountStartTime) => onChange({ discountStartTime })} /></div></label><label><span>Ends</span><div className="discount-period-control-row"><ProductDatePicker value={endDate} onChange={(discountEndDate) => onChange({ discountEndDate })} /><DiscountTimeInput label="Discount end time" value={endTime} onChange={(discountEndTime) => onChange({ discountEndTime })} /></div></label></div><div className="discount-range-calendar"><header><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></button><strong>{month.toLocaleDateString("en-MY", { month: "long", year: "numeric" })}</strong><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></button></header><div className="product-calendar-weekdays">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => <span key={day}>{day}</span>)}</div><div className="product-calendar-days">{days.map((day) => { const value = iso(day); const selected = startDate && endDate && value >= startDate && value <= endDate; return <button type="button" key={value} className={`${day.getMonth() === month.getMonth() ? "" : "outside"}${selected ? " range-selected" : ""}${value === startDate || value === endDate ? " selected" : ""}`} onPointerDown={() => { setDragStart(value); commitRange(value, value); }} onPointerEnter={(event) => { if (dragStart && event.buttons === 1) commitRange(dragStart, value); }} onPointerUp={() => setDragStart("")}>{day.getDate()}</button>; })}</div><small>Drag across dates, or type times above.</small></div></fieldset>;
}

function ProductDatePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => selected ?? new Date());
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first); start.setDate(first.getDate() - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return day; });
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return <div className="product-date-picker" ref={root}><button type="button" className="product-date-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span className={selected ? "" : "placeholder"}>{selected ? selected.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Select a date"}</span><CalendarDays /></button>{open ? <section className="product-calendar" role="dialog" aria-label="Choose best before or expiry date"><header><button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></button><strong>{month.toLocaleDateString("en-MY", { month: "long", year: "numeric" })}</strong><button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></button></header><div className="product-calendar-weekdays">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => <span key={day}>{day}</span>)}</div><div className="product-calendar-days">{days.map((day) => <button type="button" className={`${day.getMonth() === month.getMonth() ? "" : "outside"}${value === iso(day) ? " selected" : ""}`} key={iso(day)} onClick={() => { onChange(iso(day)); setOpen(false); }}>{day.getDate()}</button>)}</div><footer><button type="button" onClick={() => { onChange(""); setOpen(false); }}>Clear date</button></footer></section> : null}</div>;
}

function MoneyInput({ value, onChange, required = false }: { value: string; onChange: (value: string) => void; required?: boolean }) {
  return <span className="money-input"><i>RM</i><input required={required} type="number" min="0" step="0.01" placeholder="0.00" value={value} onChange={(event) => onChange(event.target.value)} /></span>;
}

function ThemedSelect({ value, placeholder, options, onChange }: { value: string; placeholder: string; options: string[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return <div className="themed-select product-themed-select" ref={root}><button type="button" className="themed-select-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span className={value ? "" : "placeholder"}>{value || placeholder}</span><ChevronDown /></button>{open ? <div className="themed-select-menu" role="listbox">{options.map((option) => <button type="button" role="option" aria-selected={option === value} className={option === value ? "selected" : ""} key={option} onClick={() => { onChange(option); setOpen(false); }}><span>{option}</span>{option === value ? <Check /> : null}</button>)}</div> : null}</div>;
}

function PageHead({ title, badge, action }: { title: string; badge: string; action: ReactNode }) {
  return <header className="page-head"><div><h1>{title}</h1><span>{badge}</span></div>{action}</header>;
}
