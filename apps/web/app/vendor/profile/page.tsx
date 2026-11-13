"use client";

import { Save, UserRound } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { createAuthenticatedWebApi } from "../../../src/lib/api";
import { useVendor } from "../components/vendor-context";

export default function BusinessProfilePage() {
  const { ownerName, ownerEmail, reload } = useVendor();
  const [name, setName] = useState(ownerName);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setName(ownerName), [ownerName]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      await createAuthenticatedWebApi("/api/ecochef").updateBusinessProfile({ name });
      await reload();
      setMessage("Your Business profile was updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Your profile could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="workspace">
      <header className="page-head">
        <div>
          <h1>Edit User Profile</h1>
        </div>
      </header>
      <form className="settings-card business-profile-form" onSubmit={save}>
        <h2>
          <UserRound size={18} /> Business Account
        </h2>
        <div className="settings-body">
          <label>
            Display Name
            <input
              required
              minLength={2}
              maxLength={50}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Email
            <input value={ownerEmail} disabled />
          </label>
          {message && <p className="vendor-message">{message}</p>}
          <button className="cta" disabled={saving}>
            <Save size={16} /> {saving ? "Saving…" : "Save Profile"}
          </button>
        </div>
      </form>
    </main>
  );
}
