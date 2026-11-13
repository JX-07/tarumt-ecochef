import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <h1 id="login-title" className="sr-only">
          EcoChef portal sign in
        </h1>
        <LoginForm />
      </section>
    </main>
  );
}
