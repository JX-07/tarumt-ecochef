"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ApiClientError } from "@ecochef/api-client";
import { Eye, EyeOff, ShieldCheck, Store } from "lucide-react";

import { createAuthenticatedWebApi } from "../../src/lib/api";
import { signInWithEmail, signOutCurrentUser } from "../../src/lib/auth";

type FormStatus = "idle" | "submitting" | "success" | "error";
type PortalRole = "business_owner" | "administrator";

const describeLoginError = (error: unknown): string => {
  if (error instanceof ApiClientError && error.status === 403) {
    if (error.response?.message.toLowerCase().includes("verify your firebase email")) {
      return "Please make sure to verify your email before logging in.";
    }
    return "The email address or password is incorrect.";
  }
  if (typeof error === "object" && error && "code" in error) {
    return "The email address or password is incorrect.";
  }
  return "We could not sign you in. Please try again.";
};

export function LoginForm() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<PortalRole>("business_owner");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [status, setStatus] = useState<FormStatus>("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("submitting");
    setMessage("");

    try {
      await signInWithEmail(email, password, rememberMe, selectedRole);
      const api = createAuthenticatedWebApi("/api/ecochef");
      const profile = await api.getCurrentUser();
      if (profile.role !== selectedRole) {
        await signOutCurrentUser();
        setStatus("error");
        setMessage("The email address or password is incorrect.");
        return;
      }
      setStatus("success");
      const signedInRole =
        profile.role === "business_owner" ? "Business Account user" : "Administrator";
      setMessage(`Signed in as ${signedInRole}. Your dashboard will open next.`);
      router.replace(profile.role === "business_owner" ? "/vendor" : "/admin");
    } catch (error) {
      setStatus("error");
      setMessage(describeLoginError(error));
    }
  };

  const roleInfo =
    selectedRole === "business_owner"
      ? {
          title: "EcoChef Merchant Dashboard",
          description:
            "Manage products, inventory, orders, customer rewards, and surplus food sales.",
        }
      : {
          title: "EcoChef Admin Console",
          description: "Manage platform users, shops, reports, and compliance operations.",
        };

  return (
    <div className="portal-login">
      <img className="portal-logo" src="/branding/ecochef-logo.png" alt="EcoChef" />
      <section className="portal-card">
        <div className="role-picker">
          <p>Select account role</p>
          <div>
            <button
              type="button"
              className={selectedRole === "business_owner" ? "active business" : ""}
              aria-pressed={selectedRole === "business_owner"}
              onClick={() => {
                setSelectedRole("business_owner");
                setMessage("");
              }}
            >
              <Store aria-hidden="true" size={16} />
              Business
            </button>
            <button
              type="button"
              className={selectedRole === "administrator" ? "active admin" : ""}
              aria-pressed={selectedRole === "administrator"}
              onClick={() => {
                setSelectedRole("administrator");
                setMessage("");
              }}
            >
              <ShieldCheck aria-hidden="true" size={16} />
              Administrator
            </button>
          </div>
        </div>

        <div className={`role-summary ${selectedRole}`}>
          <span aria-hidden="true">
            {selectedRole === "business_owner" ? <Store size={20} /> : <ShieldCheck size={20} />}
          </span>
          <div>
            <strong>{roleInfo.title}</strong>
            <p>{roleInfo.description}</p>
          </div>
        </div>

        <form className={`login-form ${selectedRole}`} onSubmit={handleSubmit}>
          <label htmlFor="email">Email Address</label>
          <div className="input-wrap">
            <span aria-hidden="true">✉</span>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="owner@ecochef.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <label htmlFor="password">Password</label>
          <div className="input-wrap">
            <span aria-hidden="true">♙</span>
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={6}
              required
            />
            <button
              type="button"
              className="show-password"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <div className={`form-options ${selectedRole}`}>
            {selectedRole === "business_owner" ? (
              <label className="remember-me">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                />
                <span className="custom-checkbox" aria-hidden="true" />
                Keep me signed in
              </label>
            ) : (
              <span className="admin-session-note">
                Admin sessions end when this page is refreshed.
              </span>
            )}
            <Link className="link-button" href="/forgot-password">
              Forgot password?
            </Link>
          </div>

          {message && (
            <p className={`form-message ${status}`} role={status === "error" ? "alert" : "status"}>
              {message}
            </p>
          )}

          <button
            className={`primary-button ${selectedRole === "administrator" ? "admin" : ""}`}
            type="submit"
            disabled={status === "submitting"}
          >
            {status === "submitting"
              ? "Signing in…"
              : `Sign In as ${selectedRole === "business_owner" ? "Business" : "Administrator"} →`}
          </button>
          {selectedRole === "business_owner" && (
            <p className="registration-note">
              New to EcoChef? <Link href="/business-register">Create a business account</Link>
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
