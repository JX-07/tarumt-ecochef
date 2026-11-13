import {
  createUserWithEmailAndPassword,
  browserLocalPersistence,
  browserSessionPersistence,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";

import { firebaseAuth } from "./firebase";

export const registerWithEmail = async (email: string, password: string): Promise<User> => {
  const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
  await sendEmailVerification(credential.user);
  return credential.user;
};

export const sendVerificationForCurrentUser = async (): Promise<void> => {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("No Firebase user is signed in.");
  await sendEmailVerification(user);
};

export const signInWithEmail = async (
  email: string,
  password: string,
  rememberMe: boolean,
  role: "business_owner" | "administrator" = "business_owner",
): Promise<User> => {
  await setPersistence(
    firebaseAuth,
    role === "administrator"
      ? browserLocalPersistence
      : rememberMe
        ? browserLocalPersistence
        : browserSessionPersistence,
  );
  const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
  return credential.user;
};

export const sendPasswordReset = (email: string): Promise<void> =>
  sendPasswordResetEmail(firebaseAuth, email);

export const signOutCurrentUser = (): Promise<void> => signOut(firebaseAuth);

export const getCurrentFirebaseIdToken = async (
  forceRefresh = false,
): Promise<string | undefined> => {
  // Firebase restores persisted browser sessions asynchronously. Waiting here
  // prevents the first API request after a refresh from being sent without a token.
  await firebaseAuth.authStateReady();
  if (!firebaseAuth.currentUser)
    throw new Error("Your session has ended. Please sign in again before continuing.");
  return firebaseAuth.currentUser.getIdToken(forceRefresh);
};
