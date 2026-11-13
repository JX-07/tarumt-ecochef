import { ForgotPasswordForm } from "./reset-form";

export default function ForgotPasswordPage() {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="reset-password-title">
        <h1 id="reset-password-title" className="sr-only">
          Reset your EcoChef password
        </h1>
        <ForgotPasswordForm />
      </section>
    </main>
  );
}
