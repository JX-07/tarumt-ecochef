"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, MailCheck } from "lucide-react";

type RegistrationDetails = { email: string };

export function BusinessRegisterSuccess() {
  const [details, setDetails] = useState<RegistrationDetails | null>(null);

  useEffect(() => {
    const saved = window.sessionStorage.getItem("ecochef.businessRegistration");
    if (saved) setDetails(JSON.parse(saved) as RegistrationDetails);
  }, []);

  return (
    <div className="portal-login registration-success">
      <img className="portal-logo" src="/branding/ecochef-logo.png" alt="EcoChef" />
      <section className="portal-card success-card">
        <span className="success-icon"><CheckCircle2 size={32} aria-hidden="true" /></span>
        <h1 id="account-created-title">Account request submitted</h1>
        <p className="success-lead">Your business account has been created successfully.</p>
        <div className="success-information">
          <MailCheck size={20} aria-hidden="true" />
          <p>Verification instructions were sent to <strong>{details?.email ?? "your work email"}</strong>. Please verify your email to continue.</p>
        </div>
        <p className="success-detail">After verification, you can sign in to the Business portal to create a store or accept a staff invitation.</p>
        <p className="success-detail">Your store remains private until an EcoChef administrator reviews and approves it for public visibility.</p>
        <Link className="primary-button success-action" href="/login">Back to sign in</Link>
      </section>
    </div>
  );
}
