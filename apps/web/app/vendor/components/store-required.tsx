"use client";

import { Clock3, Store } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useVendor } from "./vendor-context";

const approvalRequiredPaths = new Set([
  "/vendor/products",
  "/vendor/orders",
  "/vendor/customers",
  "/vendor/promotions",
]);

export function StoreRequired({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { stores, loading, error } = useVendor();

  if (loading)
    return (
      <main className="workspace">
        <p className="workspace-note">Loading your merchant workspace…</p>
      </main>
    );
  if (error)
    return (
      <main className="workspace">
        <p className="workspace-error">{error}</p>
      </main>
    );
  if (!stores.length)
    return (
      <main className="workspace">
        <section className="empty-store">
          <span>
            <Store size={34} />
          </span>
          <p>STORE ONBOARDING</p>
          <h1>Create or join a store</h1>
          <p>
            Create a new storefront, or open Notifications to accept an invitation from an existing
            store.
          </p>
          <Link href="/vendor/store">Create Store</Link>
        </section>
      </main>
    );

  const store = stores[0];
  if (approvalRequiredPaths.has(path) && store.status !== "approved")
    return (
      <main className="workspace">
        <section className="empty-store approval-pending">
          <span>
            <Clock3 size={34} />
          </span>
          <p>ADMIN APPROVAL REQUIRED</p>
          <h1>Please wait for store approval</h1>
          <p>
            {store.name} is currently awaiting review. An EcoChef administrator must approve your
            store before you can use this page.
          </p>
          <Link href="/vendor/store">View Store Status</Link>
        </section>
      </main>
    );

  return <>{children}</>;
}
