"use client";

import { useEffect, useMemo, useState } from "react";
import { Gift, Megaphone, Search, Send, X } from "lucide-react";
import { createAuthenticatedWebApi } from "../../../src/lib/api";
import { StoreRequired } from "../components/store-required";
import { ThemedSelectControl } from "../components/themed-controls";

type Customer = {
  id: string;
  name: string;
  email: string;
  total_orders: number;
  total_spent: number;
  logged_at: string;
  favourited: boolean;
};
type Promotion = {
  id: string;
  kind: "coupon" | "direct";
  code?: string;
  title: string;
  description?: string;
  status: string;
  usage_limit?: number;
  assigned?: number;
  discount_percent?: number;
  discount_amount?: number;
};
type ShareTarget = { customer?: Customer; broadcast?: true };

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]),
    [promotions, setPromotions] = useState<Promotion[]>([]),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("log_date"),
    [shareTarget, setShareTarget] = useState<ShareTarget>(),
    [message, setMessage] = useState("");
  useEffect(() => {
    const api = createAuthenticatedWebApi("/api/ecochef");
    void Promise.all([
      api.getVendorCustomers<{ customers: Customer[] }>(),
      api.getVendorPromotions<{ promotions: Promotion[] }>(),
    ]).then(([people, promos]) => {
      setCustomers(people.customers);
      setPromotions(
        promos.promotions.filter(
          (promotion) => promotion.kind === "coupon" && promotion.status === "active",
        ),
      );
    });
  }, []);
  const visible = useMemo(
    () =>
      [...customers]
        .filter((customer) =>
          `${customer.name} ${customer.email}`.toLowerCase().includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "total_orders"
            ? b.total_orders - a.total_orders
            : sort === "total_spent"
              ? Number(b.total_spent) - Number(a.total_spent)
              : new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime(),
        ),
    [customers, query, sort],
  );
  return (
    <StoreRequired>
      <main className="workspace crm-workspace">
        <header className="page-head">
          <div>
            <h1>Eco Customer CRM</h1>
            <span>{customers.length} Logged Customers</span>
            <p>Customers appear after purchasing from or favouriting your store.</p>
          </div>
          <button className="cta" onClick={() => setShareTarget({ broadcast: true })}>
            <Megaphone size={16} /> Broadcast Promotion Code
          </button>
        </header>
        {message ? <p className="crm-success">{message}</p> : null}
        <div className="crm-toolbar">
          <label className="crm-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search customer name or email"
            />
          </label>
          <div className="crm-sort">
            <span>Filter / sort by</span>
            <ThemedSelectControl
              ariaLabel="Filter or sort customers"
              value={sort}
              onChange={setSort}
              options={[
                { value: "log_date", label: "Log date" },
                { value: "total_orders", label: "Total orders" },
                { value: "total_spent", label: "Total spent" },
              ]}
            />
          </div>
        </div>
        {visible.length ? (
          <div className="data-table customers crm-table">
            <div className="tr th">
              <span>Customer Profile</span>
              <span>Log Date</span>
              <span>Total Orders</span>
              <span>Total Spent</span>
              <span>Relationship</span>
              <span>Engagement</span>
            </div>
            {visible.map((customer) => (
              <div className="tr" key={customer.id}>
                <span className="customer">
                  <i>
                    {customer.name
                      .split(" ")
                      .map((part) => part[0])
                      .join("")
                      .slice(0, 2)}
                  </i>
                  <b>
                    {customer.name}
                    <small>{customer.email}</small>
                  </b>
                </span>
                <span>
                  {new Date(customer.logged_at).toLocaleDateString("en-MY", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <span>{customer.total_orders}</span>
                <span>
                  <b>RM{Number(customer.total_spent).toFixed(2)}</b>
                </span>
                <span>
                  {customer.total_orders > 0 ? "Customer" : "Store favourite"}
                  {customer.favourited && customer.total_orders > 0 ? (
                    <small>Also favourited store</small>
                  ) : null}
                </span>
                <span>
                  <button className="share-code" onClick={() => setShareTarget({ customer })}>
                    <Send size={14} /> Share Coupon Code
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="data-empty panel-empty">
            Customers will appear after they buy a product or favourite this store.
          </p>
        )}
        {shareTarget ? (
          <SharePromotion
            target={shareTarget}
            promotions={promotions}
            close={() => setShareTarget(undefined)}
            sent={(next) => {
              setMessage(next);
              setShareTarget(undefined);
            }}
          />
        ) : null}
      </main>
    </StoreRequired>
  );
}

function SharePromotion({
  target,
  promotions,
  close,
  sent,
}: {
  target: ShareTarget;
  promotions: Promotion[];
  close: () => void;
  sent: (message: string) => void;
}) {
  const [promotionId, setPromotionId] = useState(promotions[0]?.id ?? ""),
    [rewardMessage, setRewardMessage] = useState(
      "Thanks for supporting our shop and reducing food waste!",
    ),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const selected = promotions.find((promotion) => promotion.id === promotionId);
  const submit = async () => {
    if (!promotionId || !rewardMessage.trim()) return;
    setSaving(true);
    setError("");
    try {
      const api = createAuthenticatedWebApi("/api/ecochef");
      const result = target.broadcast
        ? await api.broadcastVendorPromotion<{ message: string }>(promotionId, rewardMessage.trim())
        : await api.shareVendorPromotion<{ message: string }>(
            promotionId,
            target.customer!.id,
            rewardMessage.trim(),
          );
      sent(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The promotion code could not be shared.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section className="modal-card share-promotion-dialog">
        <header>
          <div>
            <span className="dialog-icon">
              <Gift />
            </span>
            <div>
              <small>{target.broadcast ? "ALL LOGGED CUSTOMERS" : "CUSTOMER REWARD"}</small>
              <h2>
                {target.broadcast
                  ? "Broadcast Promotion Code"
                  : `Share with ${target.customer?.name}`}
              </h2>
            </div>
          </div>
          <button onClick={close}>
            <X />
          </button>
        </header>
        {promotions.length ? (
          <>
            <div className="share-promotion-field">
              <span>Promotion coupon</span>
              <ThemedSelectControl
                ariaLabel="Promotion coupon"
                value={promotionId}
                onChange={setPromotionId}
                options={promotions.map((promotion) => ({
                  value: promotion.id,
                  label: `${promotion.title} · ${promotion.code}`,
                }))}
              />
            </div>
            {selected ? (
              <article className="coupon-preview">
                <b>{selected.title}</b>
                <code>{selected.code}</code>
                <p>{selected.description}</p>
                <dl>
                  <div>
                    <dt>Discount</dt>
                    <dd>
                      {selected.discount_percent
                        ? `${selected.discount_percent}% off`
                        : `RM ${Number(selected.discount_amount).toFixed(2)} off`}
                    </dd>
                  </div>
                  <div>
                    <dt>Usage</dt>
                    <dd>
                      {selected.assigned ?? 0}/{selected.usage_limit ?? "∞"}
                    </dd>
                  </div>
                </dl>
              </article>
            ) : null}
            <label>
              Custom reward message
              <textarea
                maxLength={300}
                rows={3}
                value={rewardMessage}
                onChange={(event) => setRewardMessage(event.target.value)}
              />
            </label>
            {error ? <p className="product-form-error">{error}</p> : null}
            <footer>
              <button className="neutral-button" onClick={close}>
                Cancel
              </button>
              <button
                className="cta"
                disabled={saving || !rewardMessage.trim()}
                onClick={() => void submit()}
              >
                {saving
                  ? "Sending…"
                  : target.broadcast
                    ? "Send to All Logged Customers"
                    : "Send Coupon Code"}
              </button>
            </footer>
          </>
        ) : (
          <div className="promotion-empty-state">
            <Gift />
            <strong>No active coupon codes</strong>
            <p>Create a coupon promotion first, then return here to share it.</p>
            <button className="neutral-button" onClick={close}>
              Close
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
