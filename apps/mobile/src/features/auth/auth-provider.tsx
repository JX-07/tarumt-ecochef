import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

import { firebaseAuth } from "../../lib/firebase";

type AuthStatus = "loading" | "signed_out" | "signed_in";
type AuthContextValue = { status: AuthStatus; user: User | null; signOut: () => Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  useEffect(
    () =>
      onAuthStateChanged(firebaseAuth, (nextUser) => {
        setUser(nextUser);
        setStatus(nextUser ? "signed_in" : "signed_out");
      }),
    [],
  );
  const value = useMemo(
    () => ({ status, user, signOut: () => signOut(firebaseAuth) }),
    [status, user],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
