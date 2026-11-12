import { BusinessRegisterSuccess } from "./success-card";

export default function BusinessRegisterSuccessPage() {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="account-created-title">
        <BusinessRegisterSuccess />
      </section>
    </main>
  );
}
