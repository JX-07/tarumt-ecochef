import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp } from "firebase/app";
// Metro selects Firebase's React Native entry, which exports this API. Its default
// TypeScript declaration still points at the browser entry.
// @ts-expect-error Available from firebase/auth's React Native conditional export.
import { getAuth, getReactNativePersistence, initializeAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};
export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = (() => {
  try { return initializeAuth(firebaseApp, { persistence: getReactNativePersistence(AsyncStorage) }); }
  catch { return getAuth(firebaseApp); }
})();
