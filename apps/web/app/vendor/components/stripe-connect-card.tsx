"use client";

import { BadgeDollarSign, CheckCircle2, ShieldCheck } from "lucide-react";

import type { Shop } from "./vendor-context";

export function StripeConnectCard({ shop }: { shop: Shop }) {
  return (
    <section className="settings-card stripe-connect-card">
      <header>
        <h2>
          <BadgeDollarSign size={18} /> EcoChef test settlements
        </h2>
        <span className="stripe-ready-pill ready">Ready</span>
      </header>
      <div className="stripe-connect-body">
        <div className="stripe-connect-intro">
          <ShieldCheck size={22} />
          <div>
            <strong>Managed by EcoChef</strong>
            <p>
              Customers pay EcoChef securely through Stripe. No separate Stripe account is required
              for {shop.name}.
            </p>
          </div>
        </div>
        <div className="simulated-settlement-summary">
          <CheckCircle2 size={20} />
          <div>
            <strong>85% simulated vendor settlement</strong>
            <p>
              After Stripe confirms a test payment, EcoChef records 85% for this shop and retains
              the 15% platform fee. No real bank payout is sent in this project environment.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
