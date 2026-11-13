"use client";

import {
  Bell,
  ChevronDown,
  Download,
  Gift,
  LayoutDashboard,
  MessageSquare,
  LogOut,
  Package,
  Settings,
  ShoppingBag,
  UserPen,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createAuthenticatedWebApi } from "../../../src/lib/api";
import { signOutCurrentUser } from "../../../src/lib/auth";
import { useVendor } from "./vendor-context";

type ReportOutcome = {
  id: string;
  note: string;
  created_at: string;
  category: string;
  store_name: string;
};
type Invitation = {
  id: string;
  store_id: string;
  store_name: string;
  assigned_role: string;
  can_edit_store: boolean;
  invited_by_name: string;
};
const groups = [
  {
    title: "MAIN MANAGEMENT",
    items: [
      ["/vendor", "Overview Dashboard", LayoutDashboard],
      ["/vendor/products", "Products", Package],
      ["/vendor/orders", "Orders & Pickup", ShoppingBag],
    ],
  },
  {
    title: "GROWTH & CUSTOMERS",
    items: [
      ["/vendor/customers", "Eco Customers CRM", Users],
      ["/vendor/feedback", "Feedbacks", MessageSquare],
      ["/vendor/promotions", "Promotions", Gift],
    ],
  },
  { title: "STOREFRONT SETTINGS", items: [["/vendor/store", "Store Profile", Settings]] },
] as const;

export function MerchantShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { ownerName, reload, stores } = useVendor();
  const [reportOutcomes, setReportOutcomes] = useState<ReportOutcome[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [notice, setNotice] = useState("");
  const notificationRoot = useRef<HTMLDivElement>(null);
  const profileRoot = useRef<HTMLDivElement>(null);
  const currentDate = new Date().toLocaleDateString("en-MY", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const currentNavigation = groups
    .flatMap((group) =>
      group.items.map(([href, label, Icon]) => ({ section: group.title, href, label, Icon })),
    )
    .find((item) => item.href === path) ?? {
    section: "BUSINESS ACCOUNT",
    label: "Edit User Profile",
    Icon: UserPen,
  };

  const loadInvitations = () =>
    createAuthenticatedWebApi("/api/ecochef")
      .getVendorInvitations<{ invitations: Invitation[] }>()
      .then((result) => setInvitations(result.invitations))
      .catch(() => undefined);
  useEffect(() => {
    void loadInvitations();
    const refresh = () =>
      void createAuthenticatedWebApi("/api/ecochef")
        .getVendorReportOutcomes<{ items: ReportOutcome[] }>()
        .then((result) => setReportOutcomes(result.items))
        .catch(() => undefined);
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!notificationRoot.current?.contains(event.target as Node)) setNotificationOpen(false);
      if (!profileRoot.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const acceptInvitation = async (invitation: Invitation) => {
    try {
      const result = await createAuthenticatedWebApi("/api/ecochef").acceptVendorInvitation<{
        message: string;
      }>(invitation.id);
      setNotice(result.message);
      await Promise.all([loadInvitations(), reload()]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The invitation could not be accepted.");
    }
  };

  const confirmSignOut = async () => {
    setSigningOut(true);
    setSignOutError("");
    try {
      await signOutCurrentUser();
      sessionStorage.removeItem("ecochef.vendor.store-onboarding");
      router.replace("/login");
    } catch (error) {
      setSignOutError(
        error instanceof Error ? error.message : "We could not sign you out. Please try again.",
      );
      setSigningOut(false);
    }
  };

  return (
    <div className="merchant-shell">
      <aside className="merchant-sidebar">
        <img src="/branding/ecochef-logo.png" alt="EcoChef" />
        {groups.map((group) => (
          <nav key={group.title}>
            <p>{group.title}</p>
            {group.items.map(([href, label, Icon]) => (
              <Link key={href} href={href} className={path === href ? "active" : ""}>
                <Icon size={16} />
                {label}
              </Link>
            ))}
          </nav>
        ))}
      </aside>
      <div className="merchant-main">
        <header className="merchant-topbar">
          <div className="merchant-workspace-label">
            <span>Merchant workspace</span>
            {path === "/vendor" && <time>{currentDate}</time>}
          </div>
          <div>
            <div className="topbar-menu" ref={notificationRoot}>
              <button
                className="notification-trigger"
                aria-label="Notifications"
                aria-expanded={notificationOpen}
                onClick={() => {
                  setNotificationOpen((open) => !open);
                  setProfileOpen(false);
                }}
              >
                <Bell size={18} />
                {(invitations.length > 0 || reportOutcomes.length > 0) && <i />}
              </button>
              {notificationOpen && (
                <section className="topbar-popover notification-popover">
                  <h2>Notifications</h2>
                  {notice && <p className="notification-success">{notice}</p>}
                  {reportOutcomes.map((item) => (
                    <article key={item.id}>
                      <strong>Report confirmed · {item.category.replaceAll("_", " ")}</strong>
                      <p>{item.store_name}</p>
                      <p>{item.note}</p>
                      <small>
                        {new Date(item.created_at).toLocaleString("en-MY", {
                          timeZone: "Asia/Kuala_Lumpur",
                        })}
                      </small>
                    </article>
                  ))}
                  {invitations.length ? (
                    invitations.map((invitation) => (
                      <article key={invitation.id}>
                        <strong>Store invitation</strong>
                        <p>
                          {invitation.invited_by_name} invited you to join {invitation.store_name}{" "}
                          as {invitation.assigned_role}.
                        </p>
                        <button className="cta" onClick={() => void acceptInvitation(invitation)}>
                          Accept Invitation
                        </button>
                      </article>
                    ))
                  ) : !reportOutcomes.length ? (
                    <p>No new notifications.</p>
                  ) : null}
                </section>
              )}
            </div>
            <div className="topbar-menu" ref={profileRoot}>
              <button
                className="profile-trigger"
                aria-label="Open Business profile menu"
                aria-expanded={profileOpen}
                onClick={() => {
                  setProfileOpen((open) => !open);
                  setNotificationOpen(false);
                }}
              >
                <span className="merchant-avatar">
                  <UserRound size={19} />
                </span>
                <strong>
                  {ownerName}
                  <small>Business</small>
                </strong>
                <ChevronDown size={16} />
              </button>
              {profileOpen && (
                <section className="topbar-popover profile-popover">
                  <Link href="/vendor/profile">
                    <UserPen size={16} /> Edit User Profile
                  </Link>
                  <button
                    onClick={() => {
                      setProfileOpen(false);
                      setSignOutError("");
                      setSignOutOpen(true);
                    }}
                  >
                    <LogOut size={16} /> Sign Out
                  </button>
                </section>
              )}
            </div>
          </div>
        </header>
        <header className="admin-page-heading vendor-page-context">
          <div>
            <small>{currentNavigation.section}</small>
            <h1>
              <currentNavigation.Icon aria-hidden="true" />
              {currentNavigation.label}
            </h1>
          </div>
          {path === "/vendor/products" ? (
            <button
              className="cta"
              onClick={() => window.dispatchEvent(new Event("ecochef:add-product"))}
            >
              + Add New Product
            </button>
          ) : path === "/vendor/orders" ? (
            <button
              className="secondary orders-export-button"
              onClick={() => window.dispatchEvent(new Event("ecochef:export-orders"))}
            >
              <Download size={15} /> Export CSV
            </button>
          ) : path === "/vendor/promotions" && stores[0]?.is_owner ? (
            <button
              className="cta"
              onClick={() => window.dispatchEvent(new Event("ecochef:add-promotion"))}
            >
              + Create Promotion
            </button>
          ) : null}
        </header>
        {children}
      </div>
      {signOutOpen && (
        <div className="modal-backdrop">
          <section
            className="modal-card confirm-card sign-out-confirmation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sign-out-title"
            aria-describedby="sign-out-description"
          >
            <span>
              <LogOut size={24} />
            </span>
            <h2 id="sign-out-title">Sign out of EcoChef?</h2>
            <p id="sign-out-description">
              You’ll need to sign in again to access your Business account and merchant workspace.
            </p>
            {signOutError && (
              <p className="sign-out-error" role="alert">
                {signOutError}
              </p>
            )}
            <footer>
              <button
                className="neutral-button"
                type="button"
                disabled={signingOut}
                onClick={() => setSignOutOpen(false)}
              >
                Stay Signed In
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={signingOut}
                onClick={() => void confirmSignOut()}
              >
                {signingOut ? "Signing Out…" : "Sign Out"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
