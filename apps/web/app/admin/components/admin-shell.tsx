"use client";

import {
  ChevronDown,
  ClipboardList,
  Gauge,
  LogOut,
  ShieldCheck,
  Store,
  UserPen,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { createAuthenticatedWebApi } from "../../../src/lib/api";
import { signOutCurrentUser } from "../../../src/lib/auth";

const navigation = [
  {
    label: "MODERATION",
    items: [
      ["/admin", "Operations Dashboard", Gauge],
      ["/admin/moderation", "Reports & Moderation", ClipboardList],
    ],
  },
  {
    label: "HOUSEHOLD USERS",
    items: [["/admin/users", "User Management", Users]],
  },
  {
    label: "MARKETPLACE",
    items: [["/admin/vendors", "Store Management", Store]],
  },
  {
    label: "ADMIN TEAM",
    items: [["/admin/administrators", "All Administrators", ShieldCheck]],
  },
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const menuRoot = useRef<HTMLDivElement>(null);
  const [accountName, setAccountName] = useState("Admin");
  const [accessLevel, setAccessLevel] = useState("Administrator");
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const api = createAuthenticatedWebApi("/api/ecochef");
    api
      .getCurrentUser()
      .then(async (profile) => {
        if (profile.role !== "administrator") return router.replace("/login");
        const account = await api.getAdminAccount<{
          name: string;
          email: string;
          access_level: string;
        }>();
        setAccountName(account.name);
        setAccessLevel(
          account.access_level
            .replaceAll("_", " ")
            .replace(/\b\w/g, (letter) => letter.toUpperCase()),
        );
        setReady(true);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!menuRoot.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const updateName = (event: Event) =>
      setAccountName((event as CustomEvent<string>).detail);
    document.addEventListener("pointerdown", close);
    window.addEventListener("ecochef:admin-profile-updated", updateName);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("ecochef:admin-profile-updated", updateName);
    };
  }, []);

  const logout = async () => {
    setSigningOut(true);
    await signOutCurrentUser();
    router.replace("/login");
  };

  if (!ready)
    return (
      <main className="admin-loading">
        <span />
        <p>Opening administrator workspace…</p>
      </main>
    );

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <img src="/branding/ecochef-logo.png" alt="EcoChef" />
        {navigation.map((group) => (
          <nav key={group.label}>
            <p>{group.label}</p>
            {group.items.map(([href, label, Icon]) => (
              <Link
                key={href}
                href={href}
                className={path === href ? "active" : ""}
              >
                <Icon size={17} /> <span>{label}</span>
              </Link>
            ))}
          </nav>
        ))}
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <strong>
            <i /> {accessLevel} Access
          </strong>
          <div className="admin-topbar-tools">
            <div className="admin-profile" ref={menuRoot}>
              <button
                aria-label="Open administrator menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((value) => !value)}
              >
                <span>
                  <UserRound size={20} />
                </span>
                <strong>
                  {accountName}
                  <small>{accessLevel}</small>
                </strong>
                <ChevronDown size={14} />
              </button>
              {menuOpen && (
                <section className="admin-profile-menu">
                  <Link
                    href="/admin/profile"
                    onClick={() => setMenuOpen(false)}
                  >
                    <UserPen size={16} /> Edit profile
                  </Link>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmOpen(true);
                    }}
                  >
                    <LogOut size={16} /> Sign out
                  </button>
                </section>
              )}
            </div>
          </div>
        </header>
        {children}
      </div>
      {confirmOpen && (
        <div className="modal-backdrop">
          <section
            className="modal-card confirm-card sign-out-confirmation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-signout-title"
          >
            <span>
              <LogOut size={24} />
            </span>
            <h2 id="admin-signout-title">Sign out of Admin Console?</h2>
            <p>You’ll need to sign in again to manage the EcoChef platform.</p>
            <footer>
              <button
                className="neutral-button"
                disabled={signingOut}
                onClick={() => setConfirmOpen(false)}
              >
                Stay Signed In
              </button>
              <button
                className="danger-button"
                disabled={signingOut}
                onClick={() => void logout()}
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
