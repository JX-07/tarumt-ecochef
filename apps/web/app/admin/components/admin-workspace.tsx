"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  ChefHat,
  CircleCheck,
  ClipboardList,
  Clock3,
  DollarSign,
  Gauge,
  LayoutGrid,
  List,
  Package,
  Search,
  ShieldCheck,
  ShoppingCart,
  Store,
  Tag,
  TriangleAlert,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createAuthenticatedWebApi } from "../../../src/lib/api";
import { sendPasswordReset } from "../../../src/lib/auth";
import { AdminActionLog } from "./admin-action-log";
import { ThemedDateRangeFilter } from "./themed-date-filter";

export type AdminPage =
  | "dashboard"
  | "moderation"
  | "recipes"
  | "users"
  | "vendors"
  | "products"
  | "orders"
  | "promotions"
  | "administrators";
type Tone = "blue" | "green" | "amber" | "red" | "purple" | "gray";
type Count = number | string;
type AdminData = {
  account: {
    id: string;
    name: string;
    email: string;
    access_level: string;
    date_assigned: string;
  };
  overview: Record<string, Count>;
  weekly_activity: Array<{
    week: string;
    household_signups: Count;
    business_signups: Count;
    recipes_created: Count;
  }>;
  recent_activity: Array<{
    occurred_at: string;
    category: string;
    title: string;
    detail: string;
  }>;
  reports: Array<{
    id: string;
    reason: string;
    date_reported: string;
    recipe_id: string;
    recipe_title: string;
    reporter_name: string;
    reporter_email: string;
    author_name: string;
    author_email: string;
  }>;
  recipes: Array<{
    id: string;
    title: string;
    image_url: string | null;
    cuisine: string | null;
    difficulty: string;
    is_published: boolean;
    date_created: string;
    author_id: string;
    author_name: string;
    author_email: string;
    feedback_count: Count;
    report_count: Count;
  }>;
  recipe_feedback: Array<{
    recipe_id: string;
    rating: Count;
    comment: string | null;
    date_submitted: string;
    reviewer_id: string;
    reviewer_name: string;
    reviewer_email: string;
  }>;
  users: Array<{
    id: string;
    name: string;
    email: string;
    phone_number: string | null;
    date_joined: string;
    order_count: Count;
    recipe_count: Count;
  }>;
  vendors: Array<{
    owner_id: string;
    owner_name: string;
    email: string;
    business_name: string | null;
    date_joined: string;
    store_id: string | null;
    store_name: string | null;
    description: string | null;
    icon_url: string | null;
    category: string | null;
    city: string | null;
    state: string | null;
    status: string | null;
    approved_at: string | null;
    strike_count: Count;
  }>;
  products: Array<{
    id: string;
    product_name: string;
    category: string | null;
    price: Count;
    original_price: Count | null;
    stock_quantity: Count;
    expiry_date: string | null;
    status: string;
    store_id: string;
    store_name: string;
  }>;
  orders: Array<{
    id: string;
    order_date: string;
    order_status: string;
    total_amount: Count;
    delivery_address: string;
    customer_name: string;
    customer_email: string;
    payment_status: string | null;
    payment_method: string | null;
    product_count: Count;
    store_names: string | null;
  }>;
  promotions: Array<{
    id: string;
    code: string;
    title: string;
    description: string;
    audience: string;
    status: string;
    discount_percent: Count | null;
    discount_amount: Count | null;
    free_delivery: boolean;
    start_date: string;
    end_date: string;
    usage_limit: Count | null;
    store_name: string | null;
    redemptions: Count;
  }>;
  administrators: Array<{
    id: string;
    name: string;
    email: string;
    access_level: string;
    date_assigned: string;
    invitation_sent_at: string | null;
  }>;
};

const number = (value: Count | undefined) => Number(value ?? 0);
const date = (value: string) =>
  new Intl.DateTimeFormat("en-MY", { dateStyle: "medium" }).format(new Date(value));
const dateTime = (value: string) =>
  new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
const money = (value: Count) =>
  new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(number(value));
const shortId = (value: string) => value.slice(0, 8).toUpperCase();
const label = (value: string | null) =>
  value
    ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Not configured";
const toneFor = (value: string | null): Tone => {
  const normalized = value?.toLowerCase() ?? "";
  if (["active", "approved", "completed", "published", "paid"].includes(normalized)) return "green";
  if (["pending", "pending_approval", "placed", "preparing"].includes(normalized)) return "amber";
  if (["suspended", "revoked", "rejected", "failed", "cancelled"].includes(normalized))
    return "red";
  if (["ready", "scheduled"].includes(normalized)) return "blue";
  return "gray";
};
const matches = (query: string, values: Array<unknown>) =>
  values.join(" ").toLowerCase().includes(query.toLowerCase());

const Pill = ({ children, tone = "gray" }: { children: ReactNode; tone?: Tone }) => (
  <span className={`admin-pill ${tone}`}>{children}</span>
);
const Stat = ({
  label: title,
  value,
  detail,
  icon,
  tone = "blue",
}: {
  label: string;
  value: Count;
  detail?: string;
  icon: ReactNode;
  tone?: Tone;
}) => (
  <article className="admin-stat">
    <div>
      <small>{title}</small>
      <strong>{number(value).toLocaleString("en-MY")}</strong>
      {detail && <p>{detail}</p>}
    </div>
    <span className={tone}>{icon}</span>
  </article>
);
const Heading = ({
  eyebrow,
  title,
  description,
  icon,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  icon?: ReactNode;
}) => (
  <header className="admin-page-heading">
    <div>
      {eyebrow && <small>{eyebrow}</small>}
      <h1>
        {icon}
        {title}
      </h1>
      <p>{description}</p>
    </div>
  </header>
);
const Card = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <section className={`admin-card${className ? ` ${className}` : ""}`}>{children}</section>
);
const SearchBar = ({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) => (
  <div className="admin-filterbar">
    <label>
      <Search size={15} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  </div>
);
const Empty = ({ noun }: { noun: string }) => (
  <p className="admin-data-empty">No {noun} exist in EcoChef yet.</p>
);

export function AdminWorkspace({ page }: { page: AdminPage }) {
  const [data, setData] = useState<AdminData>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [actionLogVersion, setActionLogVersion] = useState(0);
  const loadWorkspace = useCallback(async () => {
    try {
      const workspace =
        await createAuthenticatedWebApi("/api/ecochef").getAdminWorkspace<AdminData>();
      setData(workspace);
      window.dispatchEvent(
        new CustomEvent("ecochef:admin-profile-updated", {
          detail: workspace.account.name,
        }),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Administrator data could not be loaded.",
      );
    }
  }, []);
  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);
  const approveStore = useCallback(async (storeId: string) => {
    const approved = await createAuthenticatedWebApi("/api/ecochef").approveAdminStore<{
      id: string;
      store_name: string;
      status: string;
      approved_at: string;
    }>(storeId);
    setData((current) =>
      current
        ? {
            ...current,
            overview: {
              ...current.overview,
              pending_stores: Math.max(0, number(current.overview.pending_stores) - 1),
            },
            vendors: current.vendors.map((vendor) =>
              vendor.store_id === approved.id
                ? {
                    ...vendor,
                    status: approved.status,
                    approved_at: approved.approved_at,
                  }
                : vendor,
            ),
          }
        : current,
    );
    setActionLogVersion((version) => version + 1);
    return approved.store_name;
  }, []);
  const issueStoreStrike = useCallback(async (storeId: string, reason: string) => {
    const result = await createAuthenticatedWebApi("/api/ecochef").issueAdminStoreStrike<{
      id: string;
      store_name: string;
      status: string;
      strike_count: number;
      strikes_remaining: number;
    }>(storeId, reason);
    setData((current) =>
      current
        ? {
            ...current,
            vendors: current.vendors.map((vendor) =>
              vendor.store_id === result.id
                ? {
                    ...vendor,
                    status: result.status,
                    strike_count: result.strike_count,
                  }
                : vendor,
            ),
          }
        : current,
    );
    setActionLogVersion((version) => version + 1);
    return result;
  }, []);
  const revokeStore = useCallback(async (storeId: string) => {
    const result = await createAuthenticatedWebApi("/api/ecochef").revokeAdminStore<{
      id: string;
      store_name: string;
      status: string;
      strike_count: number;
    }>(storeId);
    setData((current) =>
      current
        ? {
            ...current,
            vendors: current.vendors.map((vendor) =>
              vendor.store_id === result.id
                ? {
                    ...vendor,
                    status: result.status,
                    strike_count: result.strike_count,
                  }
                : vendor,
            ),
          }
        : current,
    );
    setActionLogVersion((version) => version + 1);
    return result;
  }, []);
  const inviteAdministrator = useCallback(async (email: string) => {
    const administrator = await createAuthenticatedWebApi("/api/ecochef").inviteAdministrator<
      AdminData["administrators"][number]
    >({ email });
    setData((current) =>
      current
        ? {
            ...current,
            overview: {
              ...current.overview,
              administrators: number(current.overview.administrators) + 1,
            },
            administrators: [administrator, ...current.administrators],
          }
        : current,
    );
    setActionLogVersion((version) => version + 1);
    try {
      await sendPasswordReset(administrator.email);
      return { administrator, setupEmailSent: true };
    } catch {
      return { administrator, setupEmailSent: false };
    }
  }, []);
  const refreshAfterUndo = useCallback(async () => {
    await loadWorkspace();
    setActionLogVersion((version) => version + 1);
  }, [loadWorkspace]);
  const content = useMemo(
    () =>
      data
        ? renderPage(
            page,
            data,
            query,
            setQuery,
            approveStore,
            issueStoreStrike,
            revokeStore,
            inviteAdministrator,
          )
        : null,
    [approveStore, data, inviteAdministrator, issueStoreStrike, page, query, revokeStore],
  );
  if (error)
    return (
      <main className="admin-workspace">
        <p className="admin-load-error" role="alert">
          {error}
        </p>
      </main>
    );
  if (!data)
    return (
      <main className="admin-workspace">
        <div className="admin-data-loading">
          <span />
          <p>Loading current EcoChef data…</p>
        </div>
      </main>
    );
  const isStoreManagement = ["vendors", "products", "orders", "promotions"].includes(page);
  return (
    <main className={`admin-workspace${isStoreManagement ? " store-management-workspace" : ""}`}>
      {content}
      {page !== "dashboard" && (
        <AdminActionLog
          area={page}
          refreshKey={actionLogVersion}
          onActionUndone={refreshAfterUndo}
        />
      )}
    </main>
  );
}

function renderPage(
  page: AdminPage,
  data: AdminData,
  query: string,
  setQuery: (value: string) => void,
  approveStore: (storeId: string) => Promise<string>,
  issueStoreStrike: (
    storeId: string,
    reason: string,
  ) => Promise<{
    store_name: string;
    status: string;
    strike_count: number;
    strikes_remaining: number;
  }>,
  revokeStore: (
    storeId: string,
  ) => Promise<{ store_name: string; status: string; strike_count: number }>,
  inviteAdministrator: (email: string) => Promise<{
    administrator: AdminData["administrators"][number];
    setupEmailSent: boolean;
  }>,
) {
  const props = { data, query, setQuery };
  if (page === "dashboard") return <Dashboard data={data} />;
  if (page === "moderation") return <Moderation {...props} />;
  if (page === "recipes" || page === "users") return <Households {...props} />;
  if (["vendors", "products", "orders", "promotions"].includes(page))
    return (
      <ShopManagement
        {...props}
        onApprove={approveStore}
        onStrike={issueStoreStrike}
        onRevoke={revokeStore}
      />
    );
  return <Administrators {...props} onInvite={inviteAdministrator} />;
}

function Dashboard({ data }: { data: AdminData }) {
  const o = data.overview;
  const approvedStores = data.vendors.filter((row) => row.status === "approved").length;
  return (
    <>
      <Heading
        eyebrow="PLATFORM OVERVIEW"
        title="EcoChef operations"
        description="Current workload, platform trends, and the latest recorded events."
        icon={<Gauge />}
      />
      <div className="admin-stats">
        <Stat
          label="Pending reports"
          value={o.pending_reports}
          detail="Submitted recipe reports"
          icon={<TriangleAlert />}
          tone="red"
        />
        <Stat
          label="Shops to review"
          value={o.pending_stores}
          detail="Awaiting administrator review"
          icon={<Store />}
          tone="amber"
        />
        <Stat
          label="Orders today"
          value={o.orders_today}
          detail={`${number(o.orders).toLocaleString("en-MY")} total orders`}
          icon={<ShoppingCart />}
        />
        <Stat
          label="Registered users"
          value={o.household_users}
          detail={`${number(o.business_accounts).toLocaleString("en-MY")} business accounts`}
          icon={<Users />}
          tone="green"
        />
      </div>
      <div className="admin-dashboard-grid">
        <Card>
          <header className="trend-card-heading">
            <div>
              <h2>Weekly platform activity</h2>
              <p>New records created each week. The current week may be incomplete.</p>
            </div>
          </header>
          <WeeklyActivityChart rows={data.weekly_activity} />
        </Card>
        <Card>
          <h2>Recent activity</h2>
          <p className="card-subtitle">Latest recorded platform events.</p>
          {data.recent_activity.length ? (
            <div
              className="activity-list activity-list-scroll"
              tabIndex={0}
              role="region"
              aria-label="Scrollable recent activity"
            >
              {data.recent_activity.map((item, index) => (
                <article
                  className={activityTone(item.category)}
                  key={`${item.occurred_at}-${index}`}
                >
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                  <small>{dateTime(item.occurred_at)}</small>
                </article>
              ))}
            </div>
          ) : (
            <Empty noun="recorded activity" />
          )}
        </Card>
      </div>
      <Card>
        <header className="platform-summary-heading">
          <div>
            <h2>Platform coverage</h2>
            <p>Useful availability ratios from current EcoChef records.</p>
          </div>
        </header>
        <div className="platform-summary-grid">
          <Coverage
            label="Approved shops"
            current={approvedStores}
            total={number(o.stores)}
            detail="approved and publicly eligible"
            href="/admin/vendors"
          />
          <Coverage
            label="Active products"
            current={number(o.active_products)}
            total={number(o.products)}
            detail="available product listings"
            href="/admin/products"
          />
          <Coverage
            label="Public recipes"
            current={number(o.published_recipes)}
            total={data.recipes.length}
            detail="recipes visible to users"
            href="/admin/recipes"
          />
          <Coverage
            label="Household accounts"
            current={number(o.household_users)}
            total={number(o.household_users) + number(o.business_accounts)}
            detail="of registered household and business accounts"
            href="/admin/users"
          />
        </div>
      </Card>
    </>
  );
}

const activityTone = (category: string) =>
  category === "report"
    ? "red"
    : category === "order"
      ? "blue"
      : category === "recipe"
        ? "green"
        : "amber";
function WeeklyActivityChart({ rows }: { rows: AdminData["weekly_activity"] }) {
  const [active, setActive] = useState<number>();
  const index = active === undefined ? undefined : Math.min(active, rows.length - 1);
  const selected = index === undefined ? undefined : rows[index];
  const series = [
    {
      key: "household_signups" as const,
      label: "Household sign-ups",
      className: "households",
    },
    {
      key: "business_signups" as const,
      label: "Business sign-ups",
      className: "businesses",
    },
    {
      key: "recipes_created" as const,
      label: "Recipes created",
      className: "recipes",
    },
  ];
  const maximum = Math.max(
    1,
    ...rows.flatMap((row) => series.map((item) => number(row[item.key]))),
  );
  const chart = { left: 48, top: 16, width: 696, height: 184 };
  const x = (index: number) => chart.left + index * (chart.width / Math.max(1, rows.length - 1));
  const y = (value: number) => chart.top + chart.height - (value / maximum) * chart.height;
  const ticks = Array.from(new Set([0, Math.ceil(maximum / 2), maximum])).sort((a, b) => b - a);
  return (
    <div className="weekly-activity">
      <div className="trend-legend">
        {series.map((item) => {
          const total = rows.reduce((sum, row) => sum + number(row[item.key]), 0);
          const latest = number(rows.at(-1)?.[item.key]);
          return (
            <div key={item.key}>
              <i className={item.className} />
              <span>
                {item.label}
                <small>
                  {total.toLocaleString("en-MY")} over 4 weeks · {latest.toLocaleString("en-MY")}{" "}
                  this week
                </small>
              </span>
            </div>
          );
        })}
      </div>
      <div className="trend-chart-scroll">
        <svg
          viewBox="0 0 760 248"
          role="group"
          tabIndex={0}
          aria-label="Weekly platform activity. Hover or tap for values, or use arrow keys."
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (bounds.width && rows.length)
              setActive(
                Math.max(
                  0,
                  Math.min(
                    rows.length - 1,
                    Math.round(
                      ((((event.clientX - bounds.left) / bounds.width) * 760 - chart.left) /
                        chart.width) *
                        (rows.length - 1),
                    ),
                  ),
                ),
              );
          }}
          onPointerDown={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (bounds.width && rows.length)
              setActive(
                Math.max(
                  0,
                  Math.min(
                    rows.length - 1,
                    Math.round(
                      ((((event.clientX - bounds.left) / bounds.width) * 760 - chart.left) /
                        chart.width) *
                        (rows.length - 1),
                    ),
                  ),
                ),
              );
          }}
          onPointerLeave={() => setActive(undefined)}
          onBlur={() => setActive(undefined)}
          onFocus={() => {
            if (rows.length) setActive(0);
          }}
          onKeyDown={(event) => {
            if (
              !rows.length ||
              !["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)
            )
              return;
            event.preventDefault();
            if (event.key === "Escape") setActive(undefined);
            else if (event.key === "Home") setActive(0);
            else if (event.key === "End") setActive(rows.length - 1);
            else
              setActive((value) =>
                Math.max(
                  0,
                  Math.min(rows.length - 1, (value ?? 0) + (event.key === "ArrowRight" ? 1 : -1)),
                ),
              );
          }}
        >
          <g className="trend-grid">
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={chart.left} y1={y(tick)} x2={chart.left + chart.width} y2={y(tick)} />
                <text x={chart.left - 12} y={y(tick) + 4}>
                  {tick}
                </text>
              </g>
            ))}
          </g>
          {series.map((item) => (
            <g className={`trend-series ${item.className}`} key={item.key}>
              <path
                d={rows
                  .map(
                    (row, index) => `${index ? "L" : "M"}${x(index)} ${y(number(row[item.key]))}`,
                  )
                  .join(" ")}
              />
              {rows.map((row, index) => (
                <circle key={row.week} cx={x(index)} cy={y(number(row[item.key]))} r="4">
                  <title>{`${item.label}: ${number(row[item.key])} during week of ${date(row.week)}`}</title>
                </circle>
              ))}
            </g>
          ))}
          {rows.map((row, index) => (
            <text className="trend-date" key={row.week} x={x(index)} y="232">
              {new Intl.DateTimeFormat("en-MY", {
                day: "numeric",
                month: "short",
              }).format(new Date(row.week))}
            </text>
          ))}
          {selected && index !== undefined ? (
            <g pointerEvents="none">
              <line
                className="activity-hover-guide"
                x1={x(index)}
                x2={x(index)}
                y1={chart.top}
                y2={chart.top + chart.height}
              />
              {series.map((item) => (
                <g key={item.key} className={`trend-series ${item.className}`}>
                  <circle cx={x(index)} cy={y(number(selected[item.key]))} r={6} />
                </g>
              ))}
              <g
                className="activity-hover-tooltip"
                transform={`translate(${Math.max(chart.left, Math.min(516, x(index) + 12))},${chart.top})`}
              >
                <rect width={228} height={110} rx={8} />
                <text x={12} y={22}>
                  Week of {date(selected.week)}
                </text>
                {series.map((item, i) => (
                  <text key={item.key} x={12} y={46 + i * 24}>
                    {item.label}: {number(selected[item.key]).toLocaleString("en-MY")}
                  </text>
                ))}
              </g>
            </g>
          ) : null}
        </svg>
        {selected ? (
          <span className="activity-chart-announcement" role="status">
            Week of {date(selected.week)}.{" "}
            {series.map((item) => `${item.label}: ${number(selected[item.key])}`).join(". ")}
          </span>
        ) : null}
      </div>
      <details className="trend-details">
        <summary>View exact weekly figures</summary>
        <div>
          <table>
            <thead>
              <tr>
                <th>Week commencing</th>
                {series.map((item) => (
                  <th key={item.key}>{item.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.week}>
                  <td>{date(row.week)}</td>
                  {series.map((item) => (
                    <td key={item.key}>{number(row[item.key]).toLocaleString("en-MY")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
function Coverage({
  label: title,
  current,
  total,
  detail,
  href,
}: {
  label: string;
  current: number;
  total: number;
  detail: string;
  href: string;
}) {
  const percentage = total ? Math.round((current / total) * 100) : 0;
  return (
    <Link className="coverage-item" href={href}>
      <span>
        {title}
        <ArrowRight />
      </span>
      <strong>
        {current.toLocaleString("en-MY")}
        <small> / {total.toLocaleString("en-MY")}</small>
      </strong>
      <p>{total ? `${percentage}% ${detail}` : `No ${detail} recorded yet`}</p>
    </Link>
  );
}

type SearchProps = {
  data: AdminData;
  query: string;
  setQuery: (value: string) => void;
};
function Moderation({ data, query, setQuery }: SearchProps) {
  const rows = data.reports.filter((row) => matches(query, Object.values(row)));
  return (
    <>
      <Heading
        eyebrow="MODERATION"
        title="Moderation Tasks"
        description="Recipe reports submitted by registered EcoChef users."
        icon={<ClipboardList />}
      />
      <Card>
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="Search report, recipe, or user…"
        />
        {rows.length ? (
          <div className="admin-table moderation-table actual">
            <div className="admin-tr admin-th">
              <span>Report</span>
              <span>Reason</span>
              <span>Recipe / author</span>
              <span>Reporter</span>
              <span>Submitted</span>
            </div>
            {rows.map((row) => (
              <div className="admin-tr" key={row.id}>
                <span>
                  <strong>{shortId(row.id)}</strong>
                </span>
                <span>
                  <Pill tone="red">{label(row.reason)}</Pill>
                </span>
                <span>
                  <strong>{row.recipe_title}</strong>
                  <small>
                    {row.author_name} · {row.author_email}
                  </small>
                </span>
                <span>
                  {row.reporter_name}
                  <small>{row.reporter_email}</small>
                </span>
                <span>{dateTime(row.date_reported)}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty noun="recipe reports" />
        )}
      </Card>
    </>
  );
}

function Recipes({ data, query, setQuery }: SearchProps) {
  const rows = data.recipes.filter((row) => matches(query, Object.values(row)));
  return (
    <>
      <Heading
        eyebrow="CONTENT MANAGEMENT"
        title="Recipe Management"
        description="Public and private recipes currently stored in EcoChef."
        icon={<ChefHat />}
      />
      <Card>
        <SearchBar value={query} onChange={setQuery} placeholder="Search recipes or authors…" />
        {rows.length ? (
          <div className="admin-table recipes-table actual">
            <div className="admin-tr admin-th">
              <span>Recipe</span>
              <span>Author</span>
              <span>Cuisine</span>
              <span>Feedback</span>
              <span>Reports</span>
              <span>Visibility</span>
            </div>
            {rows.map((row) => (
              <div className="admin-tr" key={row.id}>
                <span>
                  <strong>{row.title}</strong>
                  <small>{shortId(row.id)}</small>
                </span>
                <span>
                  {row.author_name}
                  <small>{row.author_email}</small>
                </span>
                <span>
                  {row.cuisine || "Not specified"}
                  <small>{label(row.difficulty)}</small>
                </span>
                <span>{number(row.feedback_count).toLocaleString("en-MY")}</span>
                <span>{number(row.report_count).toLocaleString("en-MY")}</span>
                <span>
                  <Pill tone={row.is_published ? "green" : "gray"}>
                    {row.is_published ? "Public" : "Private"}
                  </Pill>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty noun="recipes" />
        )}
      </Card>
    </>
  );
}

function RecipeArtwork({ src, alt = "" }: { src: string | null; alt?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const marker = "/api/v1/recipes/images/";
  const resolved = src?.includes(marker)
    ? `/api/ecochef/recipes/images/${src.split(marker)[1]}`
    : src;
  return resolved && !failed ? (
    <img src={resolved} alt={alt} onError={() => setFailed(true)} />
  ) : (
    <ChefHat aria-hidden="true" />
  );
}

function Households({ data, query, setQuery }: SearchProps) {
  const rows = data.users.filter((row) => matches(query, Object.values(row)));
  const [selectedUser, setSelectedUser] = useState<AdminData["users"][number]>();
  const [selectedRecipe, setSelectedRecipe] = useState<AdminData["recipes"][number]>();
  const [recipeQuery, setRecipeQuery] = useState("");
  const recipes = data.recipes.filter(
    (row) =>
      row.author_id === selectedUser?.id &&
      matches(recipeQuery, [
        row.title,
        row.id,
        shortId(row.id),
        row.cuisine,
        label(row.difficulty),
        number(row.feedback_count),
        number(row.report_count),
        row.is_published ? "Public" : "Private",
      ]),
  );
  const feedback = selectedRecipe
    ? data.recipe_feedback.filter((row) => row.recipe_id === selectedRecipe.id)
    : [];
  const reports = selectedRecipe
    ? data.reports.filter((row) => row.recipe_id === selectedRecipe.id)
    : [];
  const selectUser = (user: AdminData["users"][number]) => {
    setSelectedUser(user);
    setSelectedRecipe(undefined);
    setRecipeQuery("");
    setQuery(user.name);
  };
  const clearSelection = () => {
    setSelectedUser(undefined);
    setSelectedRecipe(undefined);
    setRecipeQuery("");
    setQuery("");
  };
  return (
    <>
      <Heading
        eyebrow="HOUSEHOLD USERS"
        title="User Management"
        description="Browse household accounts, their authored recipes, feedback, and reports."
        icon={<Users />}
      />
      <div className="admin-stats three">
        <Stat label="Registered users" value={data.overview.household_users} icon={<Users />} />
        <Stat
          label="Orders placed"
          value={data.overview.orders}
          icon={<ShoppingCart />}
          tone="green"
        />
        <Stat
          label="Public recipes"
          value={data.overview.published_recipes}
          icon={<ChefHat />}
          tone="purple"
        />
      </div>
      <Card className="household-recipe-panel">
        {selectedUser ? (
          <header className="household-selection-header">
            <div>
              <Users />
              <span>
                <strong>{selectedUser.name}</strong>
                <small>
                  {selectedRecipe
                    ? `Recipe: ${selectedRecipe.title}`
                    : `${number(selectedUser.recipe_count)} authored recipes`}
                </small>
              </span>
            </div>
            <button
              className="household-back-button"
              type="button"
              onClick={selectedRecipe ? () => setSelectedRecipe(undefined) : clearSelection}
            >
              <ArrowLeft /> {selectedRecipe ? "Back to recipes" : "Back to users"}
            </button>
          </header>
        ) : null}
        {!selectedUser ? (
          <>
            <SearchBar
              value={query}
              onChange={setQuery}
              placeholder="Search by name, email, or ID…"
            />
            {rows.length ? (
              <div className="admin-table users-table actual">
                <div className="admin-tr admin-th">
                  <span>User</span>
                  <span>Email</span>
                  <span>Phone</span>
                  <span>Joined</span>
                  <span>Orders</span>
                  <span>Recipes</span>
                </div>
                {rows.map((row) => (
                  <div
                    className="admin-tr household-user-row"
                    role="button"
                    tabIndex={0}
                    key={row.id}
                    onClick={() => selectUser(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") selectUser(row);
                    }}
                  >
                    <span>
                      <strong>{row.name}</strong>
                      <small>{shortId(row.id)}</small>
                    </span>
                    <span>{row.email}</span>
                    <span>{row.phone_number || "Not provided"}</span>
                    <span>{date(row.date_joined)}</span>
                    <span>{number(row.order_count).toLocaleString("en-MY")}</span>
                    <span>{number(row.recipe_count).toLocaleString("en-MY")}</span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty noun="household users" />
            )}
          </>
        ) : !selectedRecipe ? (
          <>
            <div className="household-recipe-search">
              <SearchBar
                value={recipeQuery}
                onChange={setRecipeQuery}
                placeholder="Search this user's recipes by any field…"
              />
            </div>
            {recipes.length ? (
              <div className="admin-table household-recipes-table">
                <div className="admin-tr admin-th">
                  <span>Icon</span>
                  <span>Recipe</span>
                  <span>Cuisine &amp; difficulty</span>
                  <span>Feedback</span>
                  <span>Reports</span>
                  <span>Visibility</span>
                </div>
                {recipes.map((recipe) => (
                  <div
                    className="admin-tr household-recipe-row"
                    role="button"
                    tabIndex={0}
                    key={recipe.id}
                    onClick={() => setSelectedRecipe(recipe)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") setSelectedRecipe(recipe);
                    }}
                  >
                    <span className="recipe-row-icon">
                      <RecipeArtwork src={recipe.image_url} />
                    </span>
                    <span>
                      <strong>{recipe.title}</strong>
                      <small>{shortId(recipe.id)}</small>
                    </span>
                    <span>
                      {recipe.cuisine || "Not specified"}
                      <small>{label(recipe.difficulty)}</small>
                    </span>
                    <span>{number(recipe.feedback_count).toLocaleString("en-MY")}</span>
                    <span>{number(recipe.report_count).toLocaleString("en-MY")}</span>
                    <span>
                      <Pill tone={recipe.is_published ? "green" : "gray"}>
                        {recipe.is_published ? "Public" : "Private"}
                      </Pill>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty noun="recipes matching this user" />
            )}
          </>
        ) : (
          <div className="recipe-review-detail">
            <header className="recipe-detail-summary">
              <span className="recipe-detail-image">
                <RecipeArtwork
                  src={selectedRecipe.image_url}
                  alt={`${selectedRecipe.title} recipe`}
                />
              </span>
              <div>
                <small>SELECTED RECIPE</small>
                <h2>{selectedRecipe.title}</h2>
                <p>
                  {shortId(selectedRecipe.id)} · {selectedRecipe.cuisine || "Cuisine not specified"}{" "}
                  · {label(selectedRecipe.difficulty)}
                </p>
              </div>
              <Pill tone={selectedRecipe.is_published ? "green" : "gray"}>
                {selectedRecipe.is_published ? "Public" : "Private"}
              </Pill>
            </header>
            <section>
              <header>
                <div>
                  <strong>Feedback</strong>
                  <small>
                    {feedback.length} submitted review
                    {feedback.length === 1 ? "" : "s"}
                  </small>
                </div>
              </header>
              {feedback.length ? (
                <div className="recipe-feedback-list">
                  {feedback.map((item) => (
                    <article key={item.reviewer_id}>
                      <header>
                        <div>
                          <strong>{item.reviewer_name}</strong>
                          <small>{item.reviewer_email}</small>
                        </div>
                        <span>
                          {"★".repeat(number(item.rating))}
                          {"☆".repeat(Math.max(0, 5 - number(item.rating)))}
                        </span>
                      </header>
                      <p>{item.comment || "No written feedback was provided."}</p>
                      <small>{dateTime(item.date_submitted)}</small>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty noun="feedback for this recipe" />
              )}
            </section>
            <section>
              <header>
                <div>
                  <strong>Reports</strong>
                  <small>
                    {reports.length} submitted report
                    {reports.length === 1 ? "" : "s"}
                  </small>
                </div>
              </header>
              {reports.length ? (
                <div className="recipe-report-list">
                  {reports.map((item) => (
                    <article key={item.id}>
                      <div>
                        <Pill tone="red">{label(item.reason)}</Pill>
                        <strong>{item.reporter_name}</strong>
                        <small>{item.reporter_email}</small>
                      </div>
                      <time>{dateTime(item.date_reported)}</time>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty noun="reports for this recipe" />
              )}
            </section>
          </div>
        )}
      </Card>
    </>
  );
}

type ShopFilters = {
  category: string;
  location: string;
  strikes: string;
  joinedFrom: string;
  joinedTo: string;
  approval: string;
};
type ShopFilterKey = keyof ShopFilters;
type ShopSortKey =
  | "store"
  | "owner"
  | "joinedDate"
  | "category"
  | "location"
  | "strikes"
  | "approval"
  | "approvalDate"
  | "action";
type ShopView = "row" | "card";
type ShopActionProps = SearchProps & {
  onApprove: (storeId: string) => Promise<string>;
  onStrike: (
    storeId: string,
    reason: string,
  ) => Promise<{
    store_name: string;
    status: string;
    strike_count: number;
    strikes_remaining: number;
  }>;
  onRevoke: (
    storeId: string,
  ) => Promise<{ store_name: string; status: string; strike_count: number }>;
};
type FilterOption = { value: string; label: string };

const shopLocation = (row: AdminData["vendors"][number]) =>
  [row.city, row.state].filter(Boolean).join(", ") || "Location not configured";
const shopJoinedDate = (value: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const shopActionLabel = (row: AdminData["vendors"][number]) => {
  if (row.status === "pending_approval") return "Approve store";
  if (row.status === "approved" && number(row.strike_count) >= 3) return "Revoke";
  if (row.status === "approved") return "Issue strike";
  return row.status === "revoked" ? "Revoked" : "Not eligible";
};

function ShopFilterDropdown({
  title,
  value,
  options,
  open,
  onOpen,
  onSelect,
}: {
  title: string;
  value: string;
  options: FilterOption[];
  open: boolean;
  onOpen: () => void;
  onSelect: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value)?.label ?? options[0]?.label;
  return (
    <div className={`shop-subject-filter${open ? " open" : ""}`}>
      <button
        className="shop-filter-trigger"
        type="button"
        aria-label={`Filter by ${title}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={onOpen}
      >
        <span>{title}</span>
        <strong>{selected}</strong>
      </button>
      {open && (
        <div role="listbox" aria-label={`Filter by ${title}`}>
          {options.map((option) => (
            <button
              className={option.value === value ? "active" : ""}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => onSelect(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SortHeader({
  name,
  sortKey,
  activeSort,
  direction,
  onSort,
}: {
  name: string;
  sortKey: ShopSortKey;
  activeSort?: ShopSortKey;
  direction: "asc" | "desc";
  onSort: (key: ShopSortKey) => void;
}) {
  const active = activeSort === sortKey;
  return (
    <span className={`shop-sort-header${active ? " active" : ""}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`Sort ${name} ${active && direction === "asc" ? "descending" : "ascending"}`}
      >
        {name}
        {active ? direction === "asc" ? <ArrowUp /> : <ArrowDown /> : <ArrowUpDown />}
      </button>
    </span>
  );
}

function SplitSortHeader({
  primary,
  primaryKey,
  secondary,
  secondaryKey,
  activeSort,
  direction,
  onSort,
}: {
  primary: string;
  primaryKey: ShopSortKey;
  secondary: string;
  secondaryKey: ShopSortKey;
  activeSort?: ShopSortKey;
  direction: "asc" | "desc";
  onSort: (key: ShopSortKey) => void;
}) {
  const button = (name: string, key: ShopSortKey) => {
    const active = activeSort === key;
    return (
      <button
        className={active ? "active" : ""}
        type="button"
        onClick={() => onSort(key)}
        aria-label={`Sort ${name} ${active && direction === "asc" ? "descending" : "ascending"}`}
      >
        {name}
        {active ? direction === "asc" ? <ArrowUp /> : <ArrowDown /> : <ArrowUpDown />}
      </button>
    );
  };
  return (
    <span className="shop-split-sort-header">
      {button(primary, primaryKey)}
      <i />
      {button(secondary, secondaryKey)}
    </span>
  );
}

type DetailSort = { key: string; direction: "asc" | "desc" };

function DetailSortHeader({
  name,
  sortKey,
  sort,
  setSort,
}: {
  name: string;
  sortKey: string;
  sort?: DetailSort;
  setSort: (value: DetailSort) => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <span className={`shop-sort-header${active ? " active" : ""}`}>
      <button
        type="button"
        onClick={() =>
          setSort({
            key: sortKey,
            direction: active && sort.direction === "asc" ? "desc" : "asc",
          })
        }
        aria-label={`Sort ${name} ${active && sort.direction === "asc" ? "descending" : "ascending"}`}
      >
        {name}
        {active ? sort.direction === "asc" ? <ArrowUp /> : <ArrowDown /> : <ArrowUpDown />}
      </button>
    </span>
  );
}

function DetailSearch({
  value,
  onChange,
  label: noun,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <label className="store-detail-search">
      <Search />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={`Search ${noun.toLowerCase()} by any column…`}
        aria-label={`Search ${noun.toLowerCase()}`}
      />
    </label>
  );
}

function sortedDetailRows<T>(
  rows: T[],
  query: string,
  sort: DetailSort | undefined,
  values: (row: T) => Record<string, string | number | null | undefined>,
) {
  const filtered = rows.filter((row) => matches(query, Object.values(values(row))));
  if (!sort) return filtered;
  return [...filtered].sort((left, right) => {
    const a = values(left)[sort.key] ?? "",
      b = values(right)[sort.key] ?? "";
    const result =
      typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b), "en-MY", {
            numeric: true,
            sensitivity: "base",
          });
    return sort.direction === "asc" ? result : -result;
  });
}

function StoreMarketplaceDetail({
  store,
  data,
}: {
  store: AdminData["vendors"][number];
  data: AdminData;
}) {
  const [productQuery, setProductQuery] = useState(""),
    [productSort, setProductSort] = useState<DetailSort>();
  const [orderQuery, setOrderQuery] = useState(""),
    [orderSort, setOrderSort] = useState<DetailSort>();
  const [promotionQuery, setPromotionQuery] = useState(""),
    [promotionSort, setPromotionSort] = useState<DetailSort>();
  const products = data.products.filter((row) => row.store_id === store.store_id);
  const orders = data.orders.filter((row) =>
    row.store_names?.split(", ").includes(store.store_name ?? ""),
  );
  const promotions = data.promotions.filter((row) => row.store_name === store.store_name);
  const productRows = sortedDetailRows(products, productQuery, productSort, (row) => ({
    product: row.product_name,
    category: row.category,
    price: number(row.price),
    stock: number(row.stock_quantity),
    status: row.status,
  }));
  const orderRows = sortedDetailRows(orders, orderQuery, orderSort, (row) => ({
    order: row.id,
    customer: `${row.customer_name} ${row.customer_email}`,
    total: number(row.total_amount),
    date: new Date(row.order_date).getTime(),
    status: row.order_status,
  }));
  const promotionRows = sortedDetailRows(promotions, promotionQuery, promotionSort, (row) => ({
    promotion: `${row.title} ${row.description}`,
    code: row.code,
    offer: row.free_delivery
      ? "Free delivery"
      : row.discount_percent
        ? `${number(row.discount_percent)}% off`
        : row.discount_amount
          ? `${money(row.discount_amount)} off`
          : "Not configured",
    date: new Date(row.end_date).getTime(),
    status: row.status,
  }));
  return (
    <div className="store-marketplace-detail">
      <header className="store-detail-summary">
        <span className="store-detail-logo">
          {store.icon_url ? (
            <img src={store.icon_url} alt={`${store.store_name} shop icon`} />
          ) : (
            <Store />
          )}
        </span>
        <div>
          <small>SELECTED SHOP</small>
          <h2>{store.store_name}</h2>
          <p>{store.description || "No shop description has been provided."}</p>
          <span>
            <strong>{store.owner_name}</strong> · {store.email}
          </span>
        </div>
        <Pill tone={toneFor(store.status)}>{label(store.status)}</Pill>
      </header>
      <section>
        <header>
          <div>
            <Package />
            <span>
              <h3>Products</h3>
              <p>
                {products.length} product{products.length === 1 ? "" : "s"} listed by this shop
              </p>
            </span>
          </div>
        </header>
        <DetailSearch value={productQuery} onChange={setProductQuery} label="Products" />
        {productRows.length ? (
          <div className="admin-table store-detail-products">
            <div className="admin-tr admin-th">
              <DetailSortHeader
                name="Product"
                sortKey="product"
                sort={productSort}
                setSort={setProductSort}
              />
              <DetailSortHeader
                name="Category"
                sortKey="category"
                sort={productSort}
                setSort={setProductSort}
              />
              <DetailSortHeader
                name="Price"
                sortKey="price"
                sort={productSort}
                setSort={setProductSort}
              />
              <DetailSortHeader
                name="Stock"
                sortKey="stock"
                sort={productSort}
                setSort={setProductSort}
              />
              <DetailSortHeader
                name="Status"
                sortKey="status"
                sort={productSort}
                setSort={setProductSort}
              />
            </div>
            <div
              className="store-detail-entry-scroll"
              tabIndex={productRows.length > 9 ? 0 : undefined}
              aria-label={productRows.length > 9 ? "Scrollable product entries" : undefined}
            >
              {productRows.map((row) => (
                <div className="admin-tr" key={row.id}>
                  <span>
                    <strong>{row.product_name}</strong>
                    <small>{shortId(row.id)}</small>
                  </span>
                  <span>{row.category || "Not specified"}</span>
                  <span>
                    <strong>{money(row.price)}</strong>
                  </span>
                  <span>{number(row.stock_quantity).toLocaleString("en-MY")}</span>
                  <span>
                    <Pill tone={toneFor(row.status)}>{label(row.status)}</Pill>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Empty noun="products for this shop" />
        )}
      </section>
      <section>
        <header>
          <div>
            <ShoppingCart />
            <span>
              <h3>Orders</h3>
              <p>
                {orders.length} order{orders.length === 1 ? "" : "s"} containing items from this
                shop
              </p>
            </span>
          </div>
        </header>
        <DetailSearch value={orderQuery} onChange={setOrderQuery} label="Orders" />
        {orderRows.length ? (
          <div className="admin-table store-detail-orders">
            <div className="admin-tr admin-th">
              <DetailSortHeader
                name="Order"
                sortKey="order"
                sort={orderSort}
                setSort={setOrderSort}
              />
              <DetailSortHeader
                name="Customer"
                sortKey="customer"
                sort={orderSort}
                setSort={setOrderSort}
              />
              <DetailSortHeader
                name="Total"
                sortKey="total"
                sort={orderSort}
                setSort={setOrderSort}
              />
              <DetailSortHeader
                name="Date"
                sortKey="date"
                sort={orderSort}
                setSort={setOrderSort}
              />
              <DetailSortHeader
                name="Status"
                sortKey="status"
                sort={orderSort}
                setSort={setOrderSort}
              />
            </div>
            <div
              className="store-detail-entry-scroll"
              tabIndex={orderRows.length > 9 ? 0 : undefined}
              aria-label={orderRows.length > 9 ? "Scrollable order entries" : undefined}
            >
              {orderRows.map((row) => (
                <div className="admin-tr" key={row.id}>
                  <span>
                    <strong>{shortId(row.id)}</strong>
                    <small>{number(row.product_count)} product types</small>
                  </span>
                  <span>
                    <strong>{row.customer_name}</strong>
                    <small>{row.customer_email}</small>
                  </span>
                  <span>{money(row.total_amount)}</span>
                  <span>{dateTime(row.order_date)}</span>
                  <span>
                    <Pill tone={toneFor(row.order_status)}>{label(row.order_status)}</Pill>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Empty noun="orders for this shop" />
        )}
      </section>
      <section>
        <header>
          <div>
            <Tag />
            <span>
              <h3>Promotions &amp; Deals</h3>
              <p>
                {promotions.length} promotion
                {promotions.length === 1 ? "" : "s"} created by this shop
              </p>
            </span>
          </div>
        </header>
        <DetailSearch value={promotionQuery} onChange={setPromotionQuery} label="Promotions" />
        {promotionRows.length ? (
          <div className="admin-table store-detail-promotions">
            <div className="admin-tr admin-th">
              <DetailSortHeader
                name="Promotion"
                sortKey="promotion"
                sort={promotionSort}
                setSort={setPromotionSort}
              />
              <DetailSortHeader
                name="Code"
                sortKey="code"
                sort={promotionSort}
                setSort={setPromotionSort}
              />
              <DetailSortHeader
                name="Offer"
                sortKey="offer"
                sort={promotionSort}
                setSort={setPromotionSort}
              />
              <DetailSortHeader
                name="End date"
                sortKey="date"
                sort={promotionSort}
                setSort={setPromotionSort}
              />
              <DetailSortHeader
                name="Status"
                sortKey="status"
                sort={promotionSort}
                setSort={setPromotionSort}
              />
            </div>
            <div
              className="store-detail-entry-scroll"
              tabIndex={promotionRows.length > 9 ? 0 : undefined}
              aria-label={promotionRows.length > 9 ? "Scrollable promotion entries" : undefined}
            >
              {promotionRows.map((row) => (
                <div className="admin-tr" key={row.id}>
                  <span>
                    <strong>{row.title}</strong>
                    <small>{row.description}</small>
                  </span>
                  <span className="linkish">{row.code}</span>
                  <span>
                    {row.free_delivery
                      ? "Free delivery"
                      : row.discount_percent
                        ? `${number(row.discount_percent)}% off`
                        : row.discount_amount
                          ? `${money(row.discount_amount)} off`
                          : "Not configured"}
                  </span>
                  <span>{date(row.end_date)}</span>
                  <span>
                    <Pill tone={toneFor(row.status)}>{label(row.status)}</Pill>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Empty noun="promotions for this shop" />
        )}
      </section>
    </div>
  );
}

function ShopManagement({ data, query, setQuery, onApprove, onStrike, onRevoke }: ShopActionProps) {
  const defaultFilters: ShopFilters = {
    category: "all",
    location: "all",
    strikes: "all",
    joinedFrom: "",
    joinedTo: "",
    approval: "all",
  };
  const [filters, setFilters] = useState<ShopFilters>(defaultFilters);
  const [openFilter, setOpenFilter] = useState<ShopFilterKey>();
  const [view, setView] = useState<ShopView>("row");
  const [selectedStore, setSelectedStore] = useState<AdminData["vendors"][number]>();
  const [sort, setSort] = useState<{
    key: ShopSortKey;
    direction: "asc" | "desc";
  }>();
  const [confirmingApproval, setConfirmingApproval] = useState<string>();
  const [confirmingRevoke, setConfirmingRevoke] = useState<string>();
  const [working, setWorking] = useState<string>();
  const [strikeStore, setStrikeStore] = useState<AdminData["vendors"][number]>();
  const [strikeReason, setStrikeReason] = useState("");
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  useEffect(() => {
    const closeForOtherFilters = (event: Event) => {
      const source = (event as CustomEvent<string>).detail;
      if (!source?.startsWith("shop-")) setOpenFilter(undefined);
    };
    window.addEventListener("ecochef:filter-open", closeForOtherFilters);
    return () => window.removeEventListener("ecochef:filter-open", closeForOtherFilters);
  }, []);
  const shops = data.vendors.filter((row) => row.store_id);
  const categoryOptions: FilterOption[] = [
    { value: "all", label: "All categories" },
    ...Array.from(
      new Set(shops.map((row) => row.category).filter((value): value is string => Boolean(value))),
    )
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value })),
  ];
  const locationOptions: FilterOption[] = [
    { value: "all", label: "All locations" },
    ...Array.from(new Set(shops.map(shopLocation)))
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value })),
  ];
  const strikeOptions: FilterOption[] = [
    { value: "all", label: "All strikes" },
    { value: "0", label: "No strikes" },
    { value: "1", label: "1 strike" },
    { value: "2", label: "2 strikes" },
    { value: "3", label: "3 strikes" },
  ];
  const approvalOrder = [
    "pending_approval",
    "approved",
    "revoked",
    "suspended",
    "rejected",
    "draft",
  ];
  const presentStatuses = new Set(
    shops.map((row) => row.status).filter((value): value is string => Boolean(value)),
  );
  const approvalOptions: FilterOption[] = [
    { value: "all", label: "All approval states" },
    ...approvalOrder
      .filter((value) => presentStatuses.has(value))
      .map((value) => ({ value, label: label(value) })),
    ...Array.from(presentStatuses)
      .filter((value) => !approvalOrder.includes(value))
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: label(value) })),
  ];
  const filteredRows = shops.filter((row) => {
    if (!matches(query, Object.values(row))) return false;
    if (filters.category !== "all" && row.category !== filters.category) return false;
    if (filters.location !== "all" && shopLocation(row) !== filters.location) return false;
    if (filters.strikes !== "all" && number(row.strike_count) !== Number(filters.strikes))
      return false;
    const joined = shopJoinedDate(row.date_joined);
    if (filters.joinedFrom && joined < filters.joinedFrom) return false;
    if (filters.joinedTo && joined > filters.joinedTo) return false;
    if (filters.approval !== "all" && row.status !== filters.approval) return false;
    return true;
  });
  const sortValue = (row: AdminData["vendors"][number], key: ShopSortKey): string | number => {
    if (key === "store") return row.store_name ?? "";
    if (key === "owner") return row.owner_name;
    if (key === "joinedDate") return new Date(row.date_joined).getTime();
    if (key === "category") return row.category ?? "";
    if (key === "location") return shopLocation(row);
    if (key === "strikes") return number(row.strike_count);
    if (key === "approval") return row.status ?? "";
    if (key === "approvalDate") return row.approved_at ? new Date(row.approved_at).getTime() : 0;
    return shopActionLabel(row);
  };
  const rows = sort
    ? [...filteredRows].sort((left, right) => {
        const a = sortValue(left, sort.key);
        const b = sortValue(right, sort.key);
        const result =
          typeof a === "number" && typeof b === "number"
            ? a - b
            : String(a).localeCompare(String(b), "en-MY", {
                sensitivity: "base",
              });
        return sort.direction === "asc" ? result : -result;
      })
    : filteredRows;
  const approved = shops.filter((row) => row.status === "approved").length;
  const restricted = shops.filter((row) =>
    ["suspended", "revoked"].includes(row.status ?? ""),
  ).length;
  const hasFilters = (Object.keys(filters) as ShopFilterKey[]).some(
    (key) => filters[key] !== defaultFilters[key],
  );
  const openStore = (row: AdminData["vendors"][number]) => {
    setSelectedStore(row);
    setQuery(row.store_name ?? "");
    setOpenFilter(undefined);
  };
  const selectFilter = (key: ShopFilterKey) => (value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setOpenFilter(undefined);
  };
  const toggleSort = (key: ShopSortKey) =>
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  const approve = async (storeId: string) => {
    setWorking(storeId);
    setActionError("");
    try {
      const name = await onApprove(storeId);
      setMessage(`${name} is approved and can now operate publicly.`);
      setConfirmingApproval(undefined);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "The store could not be approved.");
    } finally {
      setWorking(undefined);
    }
  };
  const issueStrike = async () => {
    if (!strikeStore?.store_id || strikeReason.trim().length < 10) return;
    setWorking(strikeStore.store_id);
    setActionError("");
    try {
      const result = await onStrike(strikeStore.store_id, strikeReason.trim());
      setMessage(
        `Strike ${result.strike_count} of 3 issued to ${result.store_name}.${result.strikes_remaining ? ` ${result.strikes_remaining} remaining.` : " The store is now eligible for revocation."}`,
      );
      setStrikeStore(undefined);
      setStrikeReason("");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "The strike could not be issued.");
      setStrikeStore(undefined);
    } finally {
      setWorking(undefined);
    }
  };
  const revoke = async (storeId: string) => {
    setWorking(storeId);
    setActionError("");
    try {
      const result = await onRevoke(storeId);
      setMessage(`${result.store_name}'s approved status has been revoked.`);
      setConfirmingRevoke(undefined);
    } catch (reason) {
      setActionError(
        reason instanceof Error ? reason.message : "The store approval could not be revoked.",
      );
    } finally {
      setWorking(undefined);
    }
  };
  const renderAction = (row: AdminData["vendors"][number]) => {
    const strikes = number(row.strike_count);
    if (row.status === "pending_approval")
      return confirmingApproval === row.store_id ? (
        <span className="store-approval-confirm">
          <button
            disabled={working === row.store_id}
            onClick={() => setConfirmingApproval(undefined)}
          >
            Cancel
          </button>
          <button
            className="confirm"
            disabled={working === row.store_id}
            onClick={() => void approve(row.store_id!)}
          >
            {working === row.store_id ? "Approving…" : "Confirm approval"}
          </button>
        </span>
      ) : (
        <button
          className="store-approve-button"
          onClick={() => {
            setMessage("");
            setActionError("");
            setConfirmingApproval(row.store_id!);
          }}
        >
          Approve store
        </button>
      );
    if (row.status === "approved" && strikes < 3)
      return (
        <button
          className="store-strike-button"
          onClick={() => {
            setMessage("");
            setActionError("");
            setStrikeReason("");
            setStrikeStore(row);
          }}
        >
          Issue strike
        </button>
      );
    if (row.status === "approved" && strikes >= 3)
      return confirmingRevoke === row.store_id ? (
        <span className="store-revoke-confirm">
          <button
            disabled={working === row.store_id}
            onClick={() => setConfirmingRevoke(undefined)}
          >
            Cancel
          </button>
          <button
            className="confirm"
            disabled={working === row.store_id}
            onClick={() => void revoke(row.store_id!)}
          >
            {working === row.store_id ? "Revoking…" : "Confirm revoke"}
          </button>
        </span>
      ) : (
        <button
          className="store-revoke-button"
          onClick={() => {
            setMessage("");
            setActionError("");
            setConfirmingRevoke(row.store_id!);
          }}
        >
          Revoke
        </button>
      );
    return (
      <span className="approval-complete">
        {row.status === "revoked" ? "Revoked" : "Not eligible"}
      </span>
    );
  };
  return (
    <>
      <Heading
        eyebrow="BUSINESS OPERATIONS"
        title="Store Management"
        description="Review shop approvals, enforcement strikes, and revoked marketplace access."
        icon={<Store />}
      />
      <div className="admin-stats">
        <Stat label="All shops" value={shops.length} icon={<Store />} />
        <Stat label="Approved shops" value={approved} icon={<CircleCheck />} tone="green" />
        <Stat
          label="Pending approvals"
          value={data.overview.pending_stores}
          icon={<Clock3 />}
          tone="amber"
        />
        <Stat label="Revoked or suspended" value={restricted} icon={<TriangleAlert />} tone="red" />
      </div>
      <Card className="shop-management-panel">
        {message && (
          <p className="admin-action-message success" role="status">
            {message}
          </p>
        )}
        {actionError && (
          <p className="admin-action-message error" role="alert">
            {actionError}
          </p>
        )}
        <header className="shop-listing-heading">
          <div>
            <Store />
            <span>
              <strong>{selectedStore ? "Store Marketplace Details" : "Store Listings"}</strong>
              <small>
                {selectedStore
                  ? "Products, orders, and promotions for the selected shop."
                  : "Search, filter, sort, and manage submitted stores."}
              </small>
            </span>
          </div>
          {!selectedStore && (
            <div className="shop-view-toggle" aria-label="Store listing view">
              <button
                className={view === "row" ? "active" : ""}
                type="button"
                aria-label="Row view"
                title="Row view"
                onClick={() => setView("row")}
              >
                <List />
              </button>
              <button
                className={view === "card" ? "active" : ""}
                type="button"
                aria-label="Card view"
                title="Card view"
                onClick={() => setView("card")}
              >
                <LayoutGrid />
              </button>
            </div>
          )}
        </header>
        <div className="shop-filter-toolbar">
          <label className="shop-search">
            <Search />
            <input
              value={selectedStore?.store_name ?? query}
              readOnly={Boolean(selectedStore)}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search shops, owners, or locations…"
            />
          </label>
          {!selectedStore &&
            (
              [
                ["category", "Category", categoryOptions],
                ["location", "Location", locationOptions],
                ["strikes", "Strikes", strikeOptions],
                ["approval", "Approval", approvalOptions],
              ] as Array<[ShopFilterKey, string, FilterOption[]]>
            ).map(([key, title, options]) => (
              <ShopFilterDropdown
                key={key}
                title={title}
                value={filters[key]}
                options={options}
                open={openFilter === key}
                onOpen={() => {
                  if (openFilter === key) setOpenFilter(undefined);
                  else {
                    window.dispatchEvent(
                      new CustomEvent("ecochef:filter-open", {
                        detail: `shop-${key}`,
                      }),
                    );
                    setOpenFilter(key);
                  }
                }}
                onSelect={selectFilter(key)}
              />
            ))}
          {!selectedStore && (
            <ThemedDateRangeFilter
              id="shop-joined-date"
              label="Joined date"
              from={filters.joinedFrom}
              to={filters.joinedTo}
              onChange={(joinedFrom, joinedTo) => {
                setOpenFilter(undefined);
                setFilters((current) => ({ ...current, joinedFrom, joinedTo }));
              }}
            />
          )}
          <button
            className="shop-clear-filters"
            type="button"
            disabled={!hasFilters && !selectedStore}
            onClick={() => {
              setFilters(defaultFilters);
              setOpenFilter(undefined);
              setSelectedStore(undefined);
              setQuery("");
            }}
          >
            Clear filters
          </button>
        </div>
        {selectedStore ? (
          <StoreMarketplaceDetail store={selectedStore} data={data} />
        ) : rows.length ? (
          view === "row" ? (
            <div className="admin-table vendors-table actual shops-view">
              <div className="admin-tr admin-th">
                <span>Icon</span>
                <SortHeader
                  name="Shop"
                  sortKey="store"
                  activeSort={sort?.key}
                  direction={sort?.direction ?? "asc"}
                  onSort={toggleSort}
                />
                <SplitSortHeader
                  primary="Owner"
                  primaryKey="owner"
                  secondary="Date"
                  secondaryKey="joinedDate"
                  activeSort={sort?.key}
                  direction={sort?.direction ?? "asc"}
                  onSort={toggleSort}
                />
                <SortHeader
                  name="Category"
                  sortKey="category"
                  activeSort={sort?.key}
                  direction={sort?.direction ?? "asc"}
                  onSort={toggleSort}
                />
                <SortHeader
                  name="Location"
                  sortKey="location"
                  activeSort={sort?.key}
                  direction={sort?.direction ?? "asc"}
                  onSort={toggleSort}
                />
                <SortHeader
                  name="Strikes"
                  sortKey="strikes"
                  activeSort={sort?.key}
                  direction={sort?.direction ?? "asc"}
                  onSort={toggleSort}
                />
                <SplitSortHeader
                  primary="Approval"
                  primaryKey="approval"
                  secondary="Date"
                  secondaryKey="approvalDate"
                  activeSort={sort?.key}
                  direction={sort?.direction ?? "asc"}
                  onSort={toggleSort}
                />
                <SortHeader
                  name="Action"
                  sortKey="action"
                  activeSort={sort?.key}
                  direction={sort?.direction ?? "asc"}
                  onSort={toggleSort}
                />
              </div>
              {rows.map((row) => {
                const strikes = number(row.strike_count);
                return (
                  <div
                    className="admin-tr store-listing-row"
                    key={row.store_id!}
                    role="button"
                    tabIndex={0}
                    onClick={() => openStore(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") openStore(row);
                    }}
                  >
                    <span className="store-row-icon">
                      {row.icon_url ? <img src={row.icon_url} alt="" /> : <Store />}
                    </span>
                    <span>
                      <strong>{row.store_name}</strong>
                      <small>{shortId(row.store_id!)}</small>
                    </span>
                    <span>
                      <strong>{row.owner_name}</strong>
                      <small>{row.email}</small>
                      <small>Joined {date(row.date_joined)}</small>
                    </span>
                    <span>{row.category || "Not specified"}</span>
                    <span>{shopLocation(row)}</span>
                    <span className="store-strikes" aria-label={`${strikes} of 3 strikes`}>
                      {[1, 2, 3].map((position) => (
                        <X className={position <= strikes ? "active" : ""} key={position} />
                      ))}
                    </span>
                    <span className="store-approval-cell">
                      <Pill tone={toneFor(row.status)}>{label(row.status)}</Pill>
                      <small>
                        {row.approved_at
                          ? `Approved ${date(row.approved_at)}`
                          : row.status === "approved" || row.status === "revoked"
                            ? "Approval date not recorded"
                            : "Not yet approved"}
                      </small>
                    </span>
                    <span
                      className="store-row-action"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      {renderAction(row)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="shop-card-grid">
              {rows.map((row) => {
                const strikes = number(row.strike_count);
                return (
                  <article
                    className="shop-management-card selectable"
                    key={row.store_id!}
                    role="button"
                    tabIndex={0}
                    onClick={() => openStore(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") openStore(row);
                    }}
                  >
                    <header>
                      <div className="store-card-heading">
                        <div className="store-card-image">
                          {row.icon_url ? (
                            <img src={row.icon_url} alt={`${row.store_name} shop icon`} />
                          ) : (
                            <Store />
                          )}
                        </div>
                        <div>
                          <h3>{row.store_name}</h3>
                          <small>{shortId(row.store_id!)}</small>
                        </div>
                      </div>
                      <Pill tone={toneFor(row.status)}>{label(row.status)}</Pill>
                    </header>
                    <dl>
                      <div>
                        <dt>Owner</dt>
                        <dd>
                          <strong>{row.owner_name}</strong>
                          <small>{row.email}</small>
                          <small>Joined {date(row.date_joined)}</small>
                        </dd>
                      </div>
                      <div>
                        <dt>Category</dt>
                        <dd>{row.category || "Not specified"}</dd>
                      </div>
                      <div>
                        <dt>Location</dt>
                        <dd>{shopLocation(row)}</dd>
                      </div>
                      <div>
                        <dt>Strikes</dt>
                        <dd className="store-strikes" aria-label={`${strikes} of 3 strikes`}>
                          {[1, 2, 3].map((position) => (
                            <X className={position <= strikes ? "active" : ""} key={position} />
                          ))}
                        </dd>
                      </div>
                      <div>
                        <dt>Approval date</dt>
                        <dd>
                          {row.approved_at
                            ? date(row.approved_at)
                            : row.status === "approved" || row.status === "revoked"
                              ? "Not recorded"
                              : "Not yet approved"}
                        </dd>
                      </div>
                    </dl>
                    <footer
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      {renderAction(row)}
                    </footer>
                  </article>
                );
              })}
            </div>
          )
        ) : (
          <Empty noun="shops matching these filters" />
        )}
      </Card>
      {strikeStore && (
        <div className="modal-backdrop">
          <section
            className="modal-card store-strike-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="store-strike-title"
          >
            <header>
              <div>
                <span className="strike-dialog-icon">
                  <TriangleAlert />
                </span>
                <div>
                  <small>STORE ENFORCEMENT</small>
                  <h2 id="store-strike-title">Issue store strike</h2>
                </div>
              </div>
              <button
                className="strike-dialog-close"
                aria-label="Close strike dialog"
                disabled={Boolean(working)}
                onClick={() => setStrikeStore(undefined)}
              >
                <X />
              </button>
            </header>
            <p>
              <strong>{strikeStore.store_name}</strong> currently has{" "}
              {number(strikeStore.strike_count)} of 3 strikes.
            </p>
            <label>
              Reason for this strike
              <textarea
                autoFocus
                minLength={10}
                maxLength={500}
                required
                value={strikeReason}
                onChange={(event) => setStrikeReason(event.target.value)}
                placeholder="Describe the policy violation or reason for the strike…"
              />
            </label>
            <small>
              {strikeReason.trim().length}/500 characters · A minimum of 10 characters is required.
            </small>
            {number(strikeStore.strike_count) === 2 && (
              <p className="strike-revocation-warning">
                <TriangleAlert /> This is the third strike. After it is recorded, the store becomes
                eligible for approval revocation.
              </p>
            )}
            <footer>
              <button
                className="neutral-button"
                disabled={Boolean(working)}
                onClick={() => setStrikeStore(undefined)}
              >
                Cancel
              </button>
              <button
                className="store-strike-submit"
                disabled={Boolean(working) || strikeReason.trim().length < 10}
                onClick={() => void issueStrike()}
              >
                {working ? "Issuing…" : "Issue strike"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

type MarketplaceScope = "shops" | "all";

function MarketplaceControls({
  scope,
  view,
  query,
  setQuery,
  placeholder,
  setScope,
  setView,
}: {
  scope: MarketplaceScope;
  view: ShopView;
  query: string;
  setQuery: (value: string) => void;
  placeholder: string;
  setScope: (value: MarketplaceScope) => void;
  setView: (value: ShopView) => void;
}) {
  return (
    <div className="marketplace-browser-toolbar">
      <div className="marketplace-scope-toggle" role="group" aria-label="Choose marketplace scope">
        <button
          type="button"
          className={scope === "shops" ? "active" : ""}
          aria-pressed={scope === "shops"}
          onClick={() => setScope("shops")}
        >
          <Store /> Shops
        </button>
        <button
          type="button"
          className={scope === "all" ? "active" : ""}
          aria-pressed={scope === "all"}
          onClick={() => setScope("all")}
        >
          All
        </button>
      </div>
      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder={scope === "shops" ? "Search shops or owners…" : placeholder}
      />
      <div className="shop-view-toggle" role="group" aria-label="Choose view style">
        <button
          type="button"
          className={view === "row" ? "active" : ""}
          aria-label="Row view"
          aria-pressed={view === "row"}
          onClick={() => setView("row")}
        >
          <List />
        </button>
        <button
          type="button"
          className={view === "card" ? "active" : ""}
          aria-label="Card view"
          aria-pressed={view === "card"}
          onClick={() => setView("card")}
        >
          <LayoutGrid />
        </button>
      </div>
    </div>
  );
}

function ShopIdentity({ shop }: { shop: AdminData["vendors"][number] }) {
  return (
    <span className="marketplace-shop-identity">
      <span className="marketplace-shop-icon">
        {shop.icon_url ? <img src={shop.icon_url} alt="" /> : <Store />}
      </span>
      <strong>{shop.store_name}</strong>
    </span>
  );
}

function MarketplaceShops({
  data,
  query,
  view,
}: {
  data: AdminData;
  query: string;
  view: ShopView;
}) {
  const shops = data.vendors.filter(
    (shop) =>
      shop.store_id &&
      matches(query, [shop.store_name, shop.description, shop.owner_name, shop.email]),
  );
  if (!shops.length) return <Empty noun="shops" />;
  if (view === "card")
    return (
      <div className="marketplace-card-grid">
        {shops.map((shop) => (
          <article className="marketplace-shop-card" key={shop.store_id}>
            <ShopIdentity shop={shop} />
            <p>{shop.description || "No shop description has been provided."}</p>
            <footer>
              <span>Shop owner</span>
              <strong>{shop.owner_name}</strong>
            </footer>
          </article>
        ))}
      </div>
    );
  return (
    <div className="admin-table marketplace-shops-table">
      <div className="admin-tr admin-th">
        <span>Shop</span>
        <span>Description</span>
        <span>Shop owner</span>
      </div>
      {shops.map((shop) => (
        <div className="admin-tr" key={shop.store_id}>
          <ShopIdentity shop={shop} />
          <span>{shop.description || "No shop description has been provided."}</span>
          <span>
            <strong>{shop.owner_name}</strong>
          </span>
        </div>
      ))}
    </div>
  );
}

function MarketplaceEntryCard({
  title,
  subtitle,
  status,
  children,
}: {
  title: string;
  subtitle: string;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="marketplace-entry-card">
      <header>
        <div>
          <h3>{title}</h3>
          <small>{subtitle}</small>
        </div>
        {status}
      </header>
      <dl>{children}</dl>
    </article>
  );
}

function Products({ data, query, setQuery }: SearchProps) {
  const [scope, setScope] = useState<MarketplaceScope>("shops");
  const [view, setView] = useState<ShopView>("card");
  const rows = data.products.filter((row) => matches(query, Object.values(row)));
  return (
    <>
      <Heading
        eyebrow="MARKETPLACE"
        title="Platform Products"
        description="Products currently listed by EcoChef storefronts."
        icon={<Package />}
      />
      <div className="admin-stats three">
        <Stat label="All products" value={data.overview.products} icon={<Package />} />
        <Stat
          label="Active products"
          value={data.overview.active_products}
          icon={<CircleCheck />}
          tone="green"
        />
        <Stat
          label="Other statuses"
          value={number(data.overview.products) - number(data.overview.active_products)}
          icon={<Clock3 />}
          tone="gray"
        />
      </div>
      <Card>
        <MarketplaceControls
          scope={scope}
          view={view}
          query={query}
          setQuery={setQuery}
          placeholder="Search products or shops…"
          setScope={setScope}
          setView={setView}
        />
        {scope === "shops" ? (
          <MarketplaceShops data={data} query={query} view={view} />
        ) : rows.length ? (
          view === "row" ? (
            <div className="admin-table products-table actual">
              <div className="admin-tr admin-th">
                <span>Product</span>
                <span>Shop</span>
                <span>Category</span>
                <span>Price</span>
                <span>Stock</span>
                <span>Expiry</span>
                <span>Status</span>
              </div>
              {rows.map((row) => (
                <div className="admin-tr" key={row.id}>
                  <span>
                    <strong>{row.product_name}</strong>
                    <small>{shortId(row.id)}</small>
                  </span>
                  <span>{row.store_name}</span>
                  <span>{row.category || "Not specified"}</span>
                  <span>
                    <strong>{money(row.price)}</strong>
                    {row.original_price && <small>Original {money(row.original_price)}</small>}
                  </span>
                  <span>{number(row.stock_quantity).toLocaleString("en-MY")}</span>
                  <span>{row.expiry_date ? date(row.expiry_date) : "Not provided"}</span>
                  <span>
                    <Pill tone={toneFor(row.status)}>{label(row.status)}</Pill>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="marketplace-card-grid">
              {rows.map((row) => (
                <MarketplaceEntryCard
                  key={row.id}
                  title={row.product_name}
                  subtitle={row.store_name}
                  status={<Pill tone={toneFor(row.status)}>{label(row.status)}</Pill>}
                >
                  <div>
                    <dt>Category</dt>
                    <dd>{row.category || "Not specified"}</dd>
                  </div>
                  <div>
                    <dt>Price</dt>
                    <dd>
                      <strong>{money(row.price)}</strong>
                      {row.original_price && <small>Original {money(row.original_price)}</small>}
                    </dd>
                  </div>
                  <div>
                    <dt>Stock</dt>
                    <dd>{number(row.stock_quantity).toLocaleString("en-MY")}</dd>
                  </div>
                  <div>
                    <dt>Expiry</dt>
                    <dd>{row.expiry_date ? date(row.expiry_date) : "Not provided"}</dd>
                  </div>
                </MarketplaceEntryCard>
              ))}
            </div>
          )
        ) : (
          <Empty noun="products" />
        )}
      </Card>
    </>
  );
}

function Orders({ data, query, setQuery }: SearchProps) {
  const [scope, setScope] = useState<MarketplaceScope>("shops");
  const [view, setView] = useState<ShopView>("card");
  const rows = data.orders.filter((row) => matches(query, Object.values(row)));
  const inProgress = data.orders.filter(
    (row) => !["completed", "cancelled"].includes(row.order_status),
  ).length;
  return (
    <>
      <Heading
        eyebrow="MARKETPLACE"
        title="Global Orders Log"
        description="Orders and payment states recorded across the EcoChef marketplace."
        icon={<ShoppingCart />}
      />
      <div className="admin-stats three">
        <Stat label="Orders today" value={data.overview.orders_today} icon={<ShoppingCart />} />
        <article className="admin-stat">
          <div>
            <small>Gross order value</small>
            <strong>{money(data.overview.gross_order_value)}</strong>
            <p>Across recorded orders</p>
          </div>
          <span className="green">
            <DollarSign />
          </span>
        </article>
        <Stat label="In progress" value={inProgress} icon={<Clock3 />} tone="amber" />
      </div>
      <Card>
        <MarketplaceControls
          scope={scope}
          view={view}
          query={query}
          setQuery={setQuery}
          placeholder="Search order, customer, or shop…"
          setScope={setScope}
          setView={setView}
        />
        {scope === "shops" ? (
          <MarketplaceShops data={data} query={query} view={view} />
        ) : rows.length ? (
          view === "row" ? (
            <div className="admin-table orders-table actual">
              <div className="admin-tr admin-th">
                <span>Order</span>
                <span>Customer</span>
                <span>Shop</span>
                <span>Total</span>
                <span>Date</span>
                <span>Order status</span>
                <span>Payment</span>
              </div>
              {rows.map((row) => (
                <div className="admin-tr" key={row.id}>
                  <span>
                    <strong>{shortId(row.id)}</strong>
                    <small>{number(row.product_count)} product types</small>
                  </span>
                  <span>
                    {row.customer_name}
                    <small>{row.customer_email}</small>
                  </span>
                  <span>{row.store_names || "No products recorded"}</span>
                  <span>
                    <strong>{money(row.total_amount)}</strong>
                  </span>
                  <span>{dateTime(row.order_date)}</span>
                  <span>
                    <Pill tone={toneFor(row.order_status)}>{label(row.order_status)}</Pill>
                  </span>
                  <span>
                    <Pill tone={toneFor(row.payment_status)}>{label(row.payment_status)}</Pill>
                    <small>
                      {row.payment_method ? label(row.payment_method) : "No payment record"}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="marketplace-card-grid">
              {rows.map((row) => (
                <MarketplaceEntryCard
                  key={row.id}
                  title={`Order ${shortId(row.id)}`}
                  subtitle={row.store_names || "No products recorded"}
                  status={<Pill tone={toneFor(row.order_status)}>{label(row.order_status)}</Pill>}
                >
                  <div>
                    <dt>Customer</dt>
                    <dd>
                      <strong>{row.customer_name}</strong>
                      <small>{row.customer_email}</small>
                    </dd>
                  </div>
                  <div>
                    <dt>Total</dt>
                    <dd>
                      <strong>{money(row.total_amount)}</strong>
                    </dd>
                  </div>
                  <div>
                    <dt>Placed</dt>
                    <dd>{dateTime(row.order_date)}</dd>
                  </div>
                  <div>
                    <dt>Payment</dt>
                    <dd>
                      <Pill tone={toneFor(row.payment_status)}>{label(row.payment_status)}</Pill>
                      <small>
                        {row.payment_method ? label(row.payment_method) : "No payment record"}
                      </small>
                    </dd>
                  </div>
                </MarketplaceEntryCard>
              ))}
            </div>
          )
        ) : (
          <Empty noun="orders" />
        )}
      </Card>
    </>
  );
}

function Promotions({ data, query, setQuery }: SearchProps) {
  const [scope, setScope] = useState<MarketplaceScope>("shops");
  const [view, setView] = useState<ShopView>("card");
  const rows = data.promotions.filter((row) => matches(query, Object.values(row)));
  const redemptions = data.promotions.reduce((total, row) => total + number(row.redemptions), 0);
  return (
    <>
      <Heading
        eyebrow="MARKETPLACE"
        title="Promotions & Deals"
        description="Promotion codes and redemption totals currently stored in EcoChef."
        icon={<Tag />}
      />
      <div className="admin-stats three">
        <Stat label="All promotions" value={data.promotions.length} icon={<Tag />} />
        <Stat
          label="Live now"
          value={data.overview.live_promotions}
          icon={<CircleCheck />}
          tone="green"
        />
        <Stat label="Recorded redemptions" value={redemptions} icon={<BarChart3 />} tone="purple" />
      </div>
      <Card>
        <MarketplaceControls
          scope={scope}
          view={view}
          query={query}
          setQuery={setQuery}
          placeholder="Search campaigns or promo codes…"
          setScope={setScope}
          setView={setView}
        />
        {scope === "shops" ? (
          <MarketplaceShops data={data} query={query} view={view} />
        ) : rows.length ? (
          view === "row" ? (
            <div className="admin-table promotions-table actual">
              <div className="admin-tr admin-th">
                <span>Promotion</span>
                <span>Code</span>
                <span>Offer</span>
                <span>Audience</span>
                <span>Store</span>
                <span>Redemptions</span>
                <span>End date</span>
                <span>Status</span>
              </div>
              {rows.map((row) => (
                <div className="admin-tr" key={row.id}>
                  <span>
                    <strong>{row.title}</strong>
                    <small>{shortId(row.id)}</small>
                  </span>
                  <span className="linkish">{row.code}</span>
                  <span>
                    {row.free_delivery
                      ? "Free delivery"
                      : row.discount_percent
                        ? `${number(row.discount_percent)}% off`
                        : row.discount_amount
                          ? `${money(row.discount_amount)} off`
                          : "Not configured"}
                  </span>
                  <span>{label(row.audience)}</span>
                  <span>{row.store_name || "Platform-wide"}</span>
                  <span>{number(row.redemptions).toLocaleString("en-MY")}</span>
                  <span>{date(row.end_date)}</span>
                  <span>
                    <Pill tone={toneFor(row.status)}>{label(row.status)}</Pill>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="marketplace-card-grid">
              {rows.map((row) => (
                <MarketplaceEntryCard
                  key={row.id}
                  title={row.title}
                  subtitle={row.store_name || "Platform-wide"}
                  status={<Pill tone={toneFor(row.status)}>{label(row.status)}</Pill>}
                >
                  <div>
                    <dt>Code</dt>
                    <dd>
                      <strong>{row.code}</strong>
                    </dd>
                  </div>
                  <div>
                    <dt>Offer</dt>
                    <dd>
                      {row.free_delivery
                        ? "Free delivery"
                        : row.discount_percent
                          ? `${number(row.discount_percent)}% off`
                          : row.discount_amount
                            ? `${money(row.discount_amount)} off`
                            : "Not configured"}
                    </dd>
                  </div>
                  <div>
                    <dt>Audience</dt>
                    <dd>{label(row.audience)}</dd>
                  </div>
                  <div>
                    <dt>Redemptions</dt>
                    <dd>{number(row.redemptions).toLocaleString("en-MY")}</dd>
                  </div>
                  <div>
                    <dt>End date</dt>
                    <dd>{date(row.end_date)}</dd>
                  </div>
                </MarketplaceEntryCard>
              ))}
            </div>
          )
        ) : (
          <Empty noun="promotions" />
        )}
      </Card>
    </>
  );
}

type AdministratorProps = SearchProps & {
  onInvite: (email: string) => Promise<{
    administrator: AdminData["administrators"][number];
    setupEmailSent: boolean;
  }>;
};

function Administrators({ data, query, setQuery, onInvite }: AdministratorProps) {
  const rows = data.administrators.filter((row) => matches(query, Object.values(row)));
  const isSuperAdmin = data.account.access_level === "super_admin";
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  }>();
  const validInviteEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim());
  const submitInvite = async () => {
    if (!validInviteEmail) {
      setMessage({
        tone: "error",
        text: "Enter a complete administrator email address.",
      });
      return;
    }
    setWorking("invite");
    setMessage(undefined);
    try {
      const { administrator: invited, setupEmailSent } = await onInvite(inviteEmail.trim());
      setInviteOpen(false);
      setInviteEmail("");
      setMessage(
        setupEmailSent
          ? {
              tone: "success",
              text: `Invitation sent to ${invited.email}. They can use the email link to set their password.`,
            }
          : {
              tone: "error",
              text: `${invited.email} was created as an administrator, but the password-setup email could not be sent. Use “Forgot password” on the login page to send it again.`,
            },
      );
    } catch (reason) {
      setMessage({
        tone: "error",
        text:
          reason instanceof Error
            ? reason.message
            : "The administrator invitation could not be sent.",
      });
    } finally {
      setWorking("");
    }
  };
  return (
    <>
      <div className="admin-heading-with-action">
        <Heading
          eyebrow="ADMIN TEAM"
          title="All Administrators"
          description="Administrator identities and access levels provisioned in EcoChef."
          icon={<ShieldCheck />}
        />
        <div className="administrator-heading-actions">
          <strong>
            Total Admins: {number(data.overview.administrators).toLocaleString("en-MY")}
          </strong>
          {isSuperAdmin && (
            <button
              className="admin-primary-action"
              onClick={() => {
                setInviteOpen(true);
                setMessage(undefined);
              }}
            >
              <UserPlus /> Invite administrator
            </button>
          )}
        </div>
      </div>
      <Card>
        {message && (
          <p className={`admin-action-message ${message.tone}`} role="status">
            {message.text}
          </p>
        )}
        <SearchBar value={query} onChange={setQuery} placeholder="Search by email, role, or ID…" />
        {rows.length ? (
          <div className="admin-table administrators-table actual">
            <div className="admin-tr admin-th">
              <span>Administrator</span>
              <span>Access level</span>
              <span>Date assigned</span>
            </div>
            {rows.map((row) => (
              <div className="admin-tr" key={row.id}>
                <span className="admin-person">
                  <i>
                    <Users size={16} />
                  </i>
                  <b>
                    {row.name}
                    <small>{row.email}</small>
                    {row.invitation_sent_at && (
                      <small>Invited {dateTime(row.invitation_sent_at)}</small>
                    )}
                  </b>
                </span>
                <span>
                  <Pill tone={row.access_level === "super_admin" ? "purple" : "blue"}>
                    {label(row.access_level)}
                  </Pill>
                </span>
                <span>{date(row.date_assigned)}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty noun="administrator accounts" />
        )}
      </Card>
      {inviteOpen && (
        <div className="modal-backdrop">
          <section
            className="modal-card administrator-invite-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-administrator-title"
          >
            <header>
              <div>
                <small>ADMIN TEAM</small>
                <h2 id="invite-administrator-title">
                  <UserPlus /> Invite administrator
                </h2>
              </div>
              <button
                aria-label="Close invitation dialog"
                disabled={working === "invite"}
                onClick={() => setInviteOpen(false)}
              >
                <X />
              </button>
            </header>
            <p>
              Create a standard EcoChef administrator account. The invited person will receive an
              email to set their password.
            </p>
            <label>
              Email address
              <input
                autoFocus
                type="email"
                required
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && validInviteEmail && working !== "invite")
                    void submitInvite();
                }}
                placeholder="administrator@example.com"
              />
              {inviteEmail && !validInviteEmail && (
                <small>Enter a complete email address, such as name@example.com.</small>
              )}
            </label>
            <p className="administrator-invite-note">
              <ShieldCheck /> Standard administrators can undo only their own actions. Inviting
              administrators and undoing other administrators’ actions require the super admin
              access level.
            </p>
            <footer>
              <button
                className="neutral-button"
                disabled={working === "invite"}
                onClick={() => setInviteOpen(false)}
              >
                Cancel
              </button>
              <button
                className="admin-primary-action invite-confirm-button"
                disabled={working === "invite" || !validInviteEmail}
                onClick={() => void submitInvite()}
              >
                {working === "invite" ? "Inviting…" : "Invite"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
