import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const browserEnvironment = {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
} as const;

const required = (name: keyof typeof browserEnvironment): string => {
  const value = browserEnvironment[name];
  if (!value) {
    throw new Error(`Missing required Firebase configuration: ${name}`);
  }
  return value;
};

const firebaseConfig = {
  apiKey: required("NEXT_PUBLIC_FIREBASE_API_KEY"),
  authDomain: required("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
  projectId: required("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
  storageBucket: required("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: required("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"),
  appId: required("NEXT_PUBLIC_FIREBASE_APP_ID"),
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
