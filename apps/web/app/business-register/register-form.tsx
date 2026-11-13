"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Lock, Mail, Store, User } from "lucide-react";

import { ApiClientError } from "@ecochef/api-client";

import {
  sendVerificationForCurrentUser,
  signInWithEmail,
  signOutCurrentUser,
} from "../../src/lib/auth";
import { createWebApi } from "../../src/lib/api";

type FormStatus = "idle" | "submitting" | "success" | "error";
type AvailabilityStatus = "idle" | "checking" | "available" | "unavailable" | "error";
type PasswordStrength = { level: number; label: "Weak" | "Fair" | "Good" | "Strong" };

const passwordRequirements = (value: string) => [
  /[A-Z]/.test(value),
  /[a-z]/.test(value),
  /\d/.test(value),
  /[^A-Za-z0-9]/.test(value),
];

const isValidPassword = (value: string) =>
  value.length >= 8 && passwordRequirements(value).every(Boolean);

const getPasswordStrength = (value: string): PasswordStrength => {
  if (value.length < 8) return { level: 1, label: "Weak" };

  const level = Math.max(1, passwordRequirements(value).filter(Boolean).length);
  const labels = ["Weak", "Weak", "Fair", "Good", "Strong"] as const;
  return { level, label: labels[level] };
};

const firebaseErrorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

const describeRegistrationError = (error: unknown): string => {
  const code = firebaseErrorCode(error);
  switch (code) {
    case "auth/email-already-in-use":
      return "This email already has a Firebase sign-in. Use a different email or contact EcoChef support to resolve the existing account.";
    case "auth/invalid-email":
      return "Enter a valid email address, such as owner@business.com.";
    case "auth/weak-password":
      return "Use at least 8 characters with one uppercase letter, one lowercase letter, one number, and one symbol.";
    case "auth/operation-not-allowed":
      return "Email-and-password registration is not enabled in Firebase. Contact an EcoChef administrator.";
    case "auth/network-request-failed":
      return "We could not reach Firebase. Check your connection and try again.";
    case "auth/too-many-requests":
      return "Too many attempts were made from this device. Wait a few minutes before trying again.";
    default:
      if (error instanceof ApiClientError) {
        if (error.status === 409) {
          return "This Firebase account is already connected to another EcoChef account and cannot be used for a new business profile.";
        }
        if (error.status === 401) {
          return "EcoChef could not verify your Firebase sign-in (API 401). Confirm the API uses a Firebase Admin service account from the same Firebase project.";
        }
        if (error.status === 403) {
          return `EcoChef rejected this registration (API 403): ${error.response?.message ?? "email verification or account permissions are required."}`;
        }
        if (error.status >= 500) {
          return `EcoChef registration is temporarily unavailable (API ${error.status}): ${error.response?.message ?? "please try again shortly."}`;
        }
        return `EcoChef could not save the business profile (API ${error.status}): ${error.response?.message ?? "the request was rejected."}`;
      }
      if (error instanceof TypeError) {
        return `Registration could not be completed before EcoChef confirmed account creation: ${error.message || "an unexpected browser error occurred."} Do not retry until you have checked whether the email exists in Firebase.`;
      }
      return "We could not create the account. Please try again.";
  }
};

const inputFields = [
  {
    id: "owner-name",
    label: "Your name",
    placeholder: "e.g. Max",
    icon: User,
    type: "text",
  },
] as const;

export function BusinessRegisterForm() {
  const router = useRouter();
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [availability, setAvailability] = useState<AvailabilityStatus>("idle");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [status, setStatus] = useState<FormStatus>("idle");
  const [message, setMessage] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const isValidWorkEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = availability === "available";
  const passwordStrength = getPasswordStrength(password);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    if (availability === "idle") {
      setStatus("error");
      setMessage("Please check the email availability before creating your business account.");
      return;
    }
    if (availability === "checking") {
      setStatus("error");
      setMessage("Please wait while we check the email availability.");
      return;
    }
    if (availability === "unavailable") {
      setStatus("error");
      setMessage(
        "This email is no longer available. Enter another work email and check its availability.",
      );
      return;
    }
    if (availability === "error") {
      setStatus("error");
      setMessage("We could not confirm this email. Please press Check availability and try again.");
      return;
    }
    if (ownerName.trim().length < 2) {
      setStatus("error");
      setMessage("Enter your name using at least 2 characters.");
      return;
    }
    if (password.length < 8) {
      setStatus("error");
      setMessage("Use a password with at least 8 characters.");
      return;
    }
    if (!isValidPassword(password)) {
      setStatus("error");
      setMessage(
        "Your password must include one uppercase letter, one lowercase letter, one number, and one symbol.",
      );
      return;
    }
    if (password !== confirmPassword) {
      setStatus("error");
      setMessage("The password confirmation does not match.");
      return;
    }
    if (!acceptedTerms) {
      setStatus("error");
      setMessage("Read and agree to the Business Terms of Service before creating your account.");
      return;
    }

    setStatus("submitting");
    try {
      const api = createWebApi("/api/ecochef");
      await api.registerBusinessOwner({
        name: ownerName.trim(),
        email: email.trim(),
        password,
        terms_version: "business-v1-2026-10-21",
        terms_accepted: true,
      });
    } catch (error) {
      setStatus("error");
      setMessage(describeRegistrationError(error));
      return;
    }

    try {
      await signInWithEmail(email.trim(), password, false);
      await sendVerificationForCurrentUser();
      await signOutCurrentUser();
      window.sessionStorage.setItem(
        "ecochef.businessRegistration",
        JSON.stringify({ email: email.trim() }),
      );
      router.push("/business-register/success");
    } catch (error) {
      setStatus("error");
      setMessage(
        `Your Firebase account and EcoChef business profile were created, but we could not send the verification email. ${firebaseErrorCode(error) === "auth/network-request-failed" ? "Check your connection and use the sign-in page to try again later." : "Technical detail: " + (error instanceof Error ? error.message : "unknown error")}`,
      );
    }
  };

  const update = (id: string, value: string) => {
    if (id === "owner-name") setOwnerName(value);
  };

  const checkEmailAvailability = async () => {
    if (!isValidWorkEmail) {
      setAvailability("error");
      return;
    }
    setStatus("idle");
    setMessage("");
    setAvailability("checking");
    try {
      const result = await createWebApi("/api/ecochef").checkBusinessEmailAvailability({
        email: email.trim(),
      });
      setAvailability(result.available ? "available" : "unavailable");
    } catch {
      setAvailability("error");
    }
  };

  return (
    <div className="portal-login business-registration">
      <img className="portal-logo" src="/branding/ecochef-logo.png" alt="EcoChef" />
      <section className="portal-card registration-card">
        <header className="registration-header">
          <span className="registration-icon">
            <Store size={24} aria-hidden="true" />
          </span>
          <div>
            <h2>Create your business account</h2>
            <p>Start managing your shop with EcoChef.</p>
          </div>
        </header>
        <form className="registration-form" onSubmit={handleSubmit}>
          <label htmlFor="email">
            Work email
            <span className="email-availability-row">
              <span className="input-wrap">
                <Mail size={16} aria-hidden="true" />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@yourbusiness.com"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setAvailability("idle");
                    setStatus("idle");
                    setMessage("");
                  }}
                  required
                />
              </span>
              <button
                className="availability-button"
                type="button"
                disabled={!isValidWorkEmail || availability === "checking"}
                onClick={() => void checkEmailAvailability()}
              >
                {availability === "checking" ? "Checking…" : "Check availability"}
              </button>
            </span>
          </label>
          {email && !isValidWorkEmail && (
            <p className="field-feedback" role="alert">
              Enter a valid work email address, for example name@business.com.
            </p>
          )}
          {isValidWorkEmail && availability === "idle" && (
            <p className="field-feedback availability-prompt">
              Check whether this email is available before creating the account.
            </p>
          )}
          {availability === "available" && (
            <p className="field-feedback available" role="status">
              This email is available.
            </p>
          )}
          {availability === "unavailable" && (
            <p className="field-feedback" role="alert">
              This email is no longer available
            </p>
          )}
          {availability === "error" && isValidWorkEmail && (
            <p className="field-feedback" role="alert">
              Email availability could not be checked. Please try again.
            </p>
          )}
          {inputFields.map(({ id, label, placeholder, icon: Icon, type }) => (
            <label key={id} htmlFor={id}>
              {label}
              <span className="input-wrap">
                <Icon size={16} aria-hidden="true" />
                <input
                  id={id}
                  type={type}
                  minLength={2}
                  placeholder={placeholder}
                  value={ownerName}
                  onChange={(event) => update(id, event.target.value)}
                  required
                />
              </span>
            </label>
          ))}
          <label htmlFor="password">
            Password
            <span className="input-wrap">
              <Lock size={16} aria-hidden="true" />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                minLength={8}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                className="show-password"
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
          </label>
          {password && (
            <div className={`password-strength strength-${passwordStrength.level}`}>
              <div
                className="password-strength-meter"
                role="meter"
                aria-label="Password strength"
                aria-valuemin={1}
                aria-valuemax={4}
                aria-valuenow={passwordStrength.level}
                aria-valuetext={passwordStrength.label}
              >
                {[1, 2, 3, 4].map((segment) => (
                  <span
                    key={segment}
                    className={segment <= passwordStrength.level ? "active" : ""}
                  />
                ))}
              </div>
              <p>
                <span>
                  Password strength: <strong>{passwordStrength.label}</strong>
                </span>
                <small>
                  Use 8 or more characters with uppercase, lowercase, a number, and a symbol.
                </small>
              </p>
            </div>
          )}
          <label htmlFor="confirm-password">
            <span className="input-wrap">
              <CheckCircle2 size={16} aria-hidden="true" />
              <input
                id="confirm-password"
                aria-label="Confirm password"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
              <button
                className="show-password"
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                aria-label={
                  showConfirmPassword ? "Hide password confirmation" : "Show password confirmation"
                }
              >
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
          </label>
          {message && (
            <p className={`form-message ${status}`} role={status === "error" ? "alert" : "status"}>
              {message}
            </p>
          )}
          <label className="registration-terms-check">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(event) => setAcceptedTerms(event.target.checked)}
              required
            />
            <span>
              I have read and agree to the{" "}
              <Link href="/terms/business" target="_blank">
                Business Terms of Service
              </Link>
              , including EcoChef’s 15% service fee on each product sale.
            </span>
          </label>
          <button
            className={`primary-button${status === "submitting" ? " is-submitting" : ""}`}
            type="submit"
            disabled={!canSubmit || !acceptedTerms || status === "submitting"}
          >
            {status === "submitting" ? "Creating account…" : "Create business account →"}
          </button>
        </form>
        <p className="registration-note">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </div>
  );
}
