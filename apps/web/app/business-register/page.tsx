import { BusinessRegisterForm } from "./register-form";

export default function BusinessRegisterPage() {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="business-registration-title">
        <h1 id="business-registration-title" className="sr-only">
          Create an EcoChef business account
        </h1>
        <BusinessRegisterForm />
      </section>
    </main>
  );
}
