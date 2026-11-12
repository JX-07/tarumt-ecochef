"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { KeyRound, Mail } from "lucide-react";

import { sendPasswordReset } from "../../src/lib/auth";

async function confirmBusinessResetEmail(email: string): Promise<void> {
  const response = await fetch("/api/ecochef/auth/password-reset-eligibility", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, requested_role: "business_owner" }),
  });
  if (response.ok) return;
  throw new Error("We could not send reset instructions. Check the email address and try again.");
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState("submitting");
    setMessage("");
    try {
      await confirmBusinessResetEmail(email);
      await sendPasswordReset(email);
    } catch {
      // Do not reveal whether this email exists or belongs to another portal.
    }
    setState("success");
    setMessage("If an EcoChef account uses this email address, password-reset instructions have been sent.");
  };

  return (
    <div className="portal-login reset-password">
      <img className="portal-logo" src="/branding/ecochef-logo.png" alt="EcoChef" />
      <section className="portal-card reset-card">
        <header className="registration-header">
          <span className="registration-icon"><KeyRound size={24} aria-hidden="true" /></span>
          <div><h2>Reset your password</h2><p>We will email a secure reset link to your work email.</p></div>
        </header>
        <form className="reset-form" onSubmit={handleSubmit}>
          <label htmlFor="reset-email">Work email
            <span className="input-wrap"><Mail size={16} aria-hidden="true" /><input id="reset-email" type="email" autoComplete="email" placeholder="you@yourbusiness.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></span>
          </label>
          {message && <p className={`form-message ${state}`} role={state === "error" ? "alert" : "status"}>{message}</p>}
          <button className="primary-button" type="submit" disabled={state === "submitting"}>{state === "submitting" ? "Sending reset link…" : "Send reset link →"}</button>
        </form>
        <p className="registration-note"><Link href="/login">← Back to sign in</Link></p>
      </section>
    </div>
  );
}
