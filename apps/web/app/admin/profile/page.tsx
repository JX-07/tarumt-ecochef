"use client";

import { Camera, Save, UserPen, UserRound } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { createAuthenticatedWebApi } from "../../../src/lib/api";
import {
  loadProfileImage,
  prepareProfileImage,
  saveProfileImage,
} from "../../../src/lib/profile-image";

type AdministratorProfile = {
  id: string;
  name: string;
  email: string;
  access_level: string;
  date_assigned: string;
};

export default function AdministratorProfilePage() {
  const [profile, setProfile] = useState<AdministratorProfile>();
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string }>();
  const [saving, setSaving] = useState(false);
  const [profileImage, setProfileImage] = useState<string | null>(null);

  useEffect(() => {
    createAuthenticatedWebApi("/api/ecochef")
      .getAdminAccount<AdministratorProfile>()
      .then((account) => {
        setProfile(account);
        setName(account.name);
      })
      .catch((reason) =>
        setMessage({
          tone: "error",
          text: reason instanceof Error ? reason.message : "Your profile could not be loaded.",
        }),
      );
  }, []);
  useEffect(() => setProfileImage(loadProfileImage("admin")), []);

  const changeImage = async (file?: File) => {
    if (!file) return;
    try {
      const image = await prepareProfileImage(file);
      saveProfileImage("admin", image);
      setProfileImage(image);
      setMessage({ tone: "success", text: "Your administrator profile image was updated." });
    } catch (reason) {
      setMessage({
        tone: "error",
        text: reason instanceof Error ? reason.message : "The profile image could not be saved.",
      });
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);
    try {
      const updated = await createAuthenticatedWebApi(
        "/api/ecochef",
      ).updateAdminProfile<AdministratorProfile>({ name: name.trim() });
      setProfile(updated);
      setName(updated.name);
      window.dispatchEvent(
        new CustomEvent("ecochef:admin-profile-updated", { detail: updated.name }),
      );
      setMessage({ tone: "success", text: "Your administrator profile was updated." });
    } catch (reason) {
      setMessage({
        tone: "error",
        text: reason instanceof Error ? reason.message : "Your profile could not be updated.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="admin-workspace admin-profile-page">
      <header className="admin-page-heading">
        <div>
          <small>ADMIN ACCOUNT</small>
          <h1>
            <UserPen /> Edit Profile
          </h1>
          <p>Manage the name displayed in your EcoChef administrator workspace.</p>
        </div>
      </header>
      <form className="admin-profile-card" onSubmit={save}>
        <header>
          <UserPen />
          <div>
            <h2>Administrator profile</h2>
            <p>Your email and access level are controlled by EcoChef account administration.</p>
          </div>
        </header>
        <div className="admin-profile-form-body">
          <label className="profile-image-picker">
            <span className="profile-image-preview">
              {profileImage ? (
                <img src={profileImage} alt="Administrator profile" />
              ) : (
                <UserRound />
              )}
            </span>
            <span>
              <Camera size={16} /> Change profile image
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => void changeImage(event.target.files?.[0])}
            />
          </label>
          <label>
            Display name
            <input
              autoFocus
              required
              minLength={2}
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your display name"
            />
          </label>
          <label>
            Email address
            <input value={profile?.email ?? "Loading…"} disabled />
          </label>
          <label>
            Access level
            <input
              value={
                profile
                  ? profile.access_level
                      .replaceAll("_", " ")
                      .replace(/\b\w/g, (letter) => letter.toUpperCase())
                  : "Loading…"
              }
              disabled
            />
          </label>
          {message && (
            <p
              className={`admin-profile-message ${message.tone}`}
              role={message.tone === "error" ? "alert" : "status"}
            >
              {message.text}
            </p>
          )}
        </div>
        <footer>
          <button
            className="admin-primary-action"
            disabled={saving || name.trim().length < 2 || name.trim() === profile?.name}
          >
            <Save /> {saving ? "Saving…" : "Save profile"}
          </button>
        </footer>
      </form>
    </main>
  );
}
