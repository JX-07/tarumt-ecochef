import { sendPasswordResetEmail } from "firebase/auth";

import { apiBaseUrl } from "../../lib/api-url";
import { firebaseAuth } from "../../lib/firebase";

export async function sendConsumerPasswordResetEmail(email: string): Promise<void> {
  const address = email.trim();
  if (!/^\S+@\S+\.\S+$/.test(address)) throw new Error("A valid email address is required.");
  const response = await fetch(`${apiBaseUrl}/auth/password-reset-eligibility`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: address, requested_role: "consumer" }),
  });
  if (!response.ok) throw new Error("Password reset is unavailable right now.");
  await sendPasswordResetEmail(firebaseAuth, address);
}
