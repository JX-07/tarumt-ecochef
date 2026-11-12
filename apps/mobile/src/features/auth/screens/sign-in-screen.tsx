import { apiBaseUrl } from "../../../lib/api-url";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { colors, palette, typography } from "@ecochef/design-tokens";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { sendEmailVerification, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { useState } from "react";
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";

import { firebaseAuth } from "../../../lib/firebase";

const ecoChefLogo = require("../../../../assets/ecochef-logo-horizontal.png");

type Mode = "signIn" | "createAccount";
type FeedbackTone = "success" | "error" | "info";
type Feedback = { tone: FeedbackTone; title: string; message: string; action?: () => void } | null;


async function registerConsumer(name: string, email: string, password: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/auth/consumer-registrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password, terms_version: "consumer-v1-2026-10-21", terms_accepted: true }),
  });
  if (response.ok) return;
  const body = await response.json().catch(() => null) as {
    message?: string;
    details?: Array<{ loc?: Array<string | number>; msg?: string }>;
  } | null;
  const firstIssue = body?.details?.[0];
  if (firstIssue?.msg) {
    const field = firstIssue.loc?.at(-1);
    throw new Error(`${typeof field === "string" ? `${field[0].toUpperCase()}${field.slice(1)}: ` : ""}${firstIssue.msg}`);
  }
  throw new Error(body?.message ?? "The account could not be created.");
}

async function confirmConsumerSession(idToken: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${apiBaseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${idToken}` },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null) as { detail?: string; message?: string; role?: string } | null;
    if (!response.ok) throw new Error(body?.detail ?? body?.message ?? "EcoChef could not confirm this account.");
    if (body?.role !== "consumer") throw new Error("This account is not registered as an EcoChef consumer.");
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error instanceof TypeError || /network|fetch failed/i.test(error.message))) {
      throw new Error("EcoChef could not reach its server. Check your connection and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function Input({ icon, placeholder, value, change, password }: { icon: keyof typeof Ionicons.glyphMap; placeholder: string; value: string; change: (value: string) => void; password?: boolean }) {
  const [hidden, setHidden] = useState(Boolean(password));
  return <View style={styles.input}><Ionicons name={icon} size={19} color={palette.c8b9b94} /><TextInput style={styles.inputText} value={value} onChangeText={change} placeholder={placeholder} placeholderTextColor={palette.c8a9691} autoCapitalize="none" keyboardType={placeholder === "you@example.com" ? "email-address" : "default"} secureTextEntry={password && hidden} />{password && <Pressable hitSlop={10} onPress={() => setHidden(!hidden)}><Ionicons name={hidden ? "eye-outline" : "eye-off-outline"} size={19} color={palette.c8b9b94} /></Pressable>}</View>;
}

export function SignInScreen() {
  const [mode, setMode] = useState<Mode>("signIn"); const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [remember, setRemember] = useState(true); const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const create = mode === "createAccount";
  const errorText = (error: unknown) => error instanceof Error ? error.message : "Check your connection and try again.";
  const show = (tone: FeedbackTone, title: string, message: string, action?: () => void) => setFeedback({ tone, title, message, action });
  const closeFeedback = () => { const action = feedback?.action; setFeedback(null); action?.(); };
  const submit = async () => {
    if (!email.trim() || !password) return show("error", "Complete your details", "Enter your email address and password.");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return show("error", "Check your email", "Enter a valid email address, such as name@example.com.");
    if (create && name.trim().length < 2) return show("error", "Enter your name", "Your name must be at least two characters.");
    if (create && password.length < 8) return show("error", "Choose a longer password", "Your password must contain at least 8 characters.");
    if (create && password !== confirm) return show("error", "Passwords do not match", "Enter the same password in both fields.");
    if (create && !acceptedTerms) return show("info", "Consumer Terms of Service", "Version consumer-v1-2026-10-21. Use EcoChef lawfully, keep your account secure, and review all marketplace totals before ordering. EcoChef charges business sellers a 15% service fee on product sales; it is not an extra 15% added to your displayed product price. Tap Continue to agree, then create your account.", () => setAcceptedTerms(true));
    try { setLoading(true);
      if (create) { await registerConsumer(name.trim(), email.trim(), password); const credential = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password); await sendEmailVerification(credential.user); await signOut(firebaseAuth); setMode("signIn"); show("success", "Account created", "Your EcoChef account has been created successfully.", () => show("info", "Verify your email", "We sent a verification link to your email address. Open it, then sign in to EcoChef.")); return; }
      if (!remember) await signOut(firebaseAuth);
      const credential = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      if (!credential.user.emailVerified) { await signOut(firebaseAuth); return show("info", "Verify your email", "Use the verification link we sent before signing in to EcoChef."); }
      try { await confirmConsumerSession(await credential.user.getIdToken()); }
      catch (error) { await signOut(firebaseAuth); throw error; }
      router.replace("/(tabs)");
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      const message = code === "auth/network-request-failed" ? "The app could not reach the sign-in service. Check the emulator’s internet connection and try again." : code === "auth/too-many-requests" ? "Too many sign-in attempts. Please wait before trying again." : !create && ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"].includes(code) ? "Invalid email or password." : errorText(error);
      show("error", create ? "Could not create your account" : "Sign-in failed", message);
    } finally { setLoading(false); }
  };
  const reset = () => router.push("/(auth)/forgot-password");
  return <KeyboardAvoidingView style={styles.root} behavior={Platform.select({ ios: "padding", default: undefined })}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><Image source={ecoChefLogo} style={styles.brandLogo} resizeMode="contain" accessibilityLabel="EcoChef" /><View style={styles.hero}><Text style={styles.title}>Cook well. Waste less.</Text><Text style={styles.subtitle}>Your recipes, meal plans, and pantry insights in one place.</Text></View><View style={styles.toggle}><Pressable onPress={() => setMode("signIn")} style={[styles.toggleItem, !create && styles.selected]}><Text style={[styles.toggleText, !create && styles.selectedText]}>Sign in</Text></Pressable><Pressable onPress={() => setMode("createAccount")} style={[styles.toggleItem, create && styles.selected]}><Text style={[styles.toggleText, create && styles.selectedText]}>Create account</Text></Pressable></View><View style={styles.form}>{create && <><Text style={styles.label}>Name</Text><Input icon="person-outline" placeholder="Your name" value={name} change={setName} /></>}<Text style={styles.label}>Email</Text><Input icon="mail-outline" placeholder="you@example.com" value={email} change={setEmail} /><Text style={styles.label}>Password</Text><Input icon="lock-closed-outline" placeholder="8 characters minimum" value={password} change={setPassword} password />{create && <><Text style={styles.label}>Confirm password</Text><Input icon="lock-closed-outline" placeholder="Repeat your password" value={confirm} change={setConfirm} password /></>}{!create && <View style={styles.options}><Pressable style={styles.remember} onPress={() => setRemember(!remember)}><Switch value={remember} onValueChange={setRemember} trackColor={{ false: palette.cd9ded9, true: palette.c91b9a1 }} thumbColor={remember ? palette.c235951 : palette.cffffff} /><Text style={styles.option}>Keep me signed in</Text></Pressable><Pressable onPress={reset}><Text style={styles.forgot}>Forgot password?</Text></Pressable></View>}<Pressable onPress={submit} disabled={loading} style={[styles.button, loading && styles.disabled]}><Text style={styles.buttonText}>{loading ? "Please wait…" : create ? "Create my account" : "Sign in to EcoChef"}</Text><Ionicons name="arrow-forward" size={19} color={palette.cfff} /></Pressable></View><Text style={styles.terms}>By continuing, you agree to EcoChef’s terms and privacy policy.</Text></ScrollView><Modal transparent visible={Boolean(feedback)} animationType="fade" onRequestClose={closeFeedback}><View style={styles.modalOverlay}><View style={styles.dialog}><View style={[styles.dialogIcon, feedback?.tone === "error" ? styles.errorIcon : feedback?.tone === "success" ? styles.successIcon : styles.infoIcon]}><Ionicons name={feedback?.tone === "error" ? "alert" : feedback?.tone === "success" ? "checkmark" : "mail-outline"} size={25} color={feedback?.tone === "error" ? palette.cb54a4a : feedback?.tone === "success" ? palette.c34784a : palette.c2d7464} /></View><Text style={styles.dialogTitle}>{feedback?.title}</Text><Text style={styles.dialogMessage}>{feedback?.message}</Text><Pressable style={styles.dialogButton} onPress={closeFeedback}><Text style={styles.dialogButtonText}>Continue</Text></Pressable></View></View></Modal></KeyboardAvoidingView>;
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.consumerCanvas }, content: { flexGrow: 1, paddingHorizontal: 25, paddingTop: 36, paddingBottom: 25 }, brandLogo: { width: 145, height: 49 }, hero: { marginTop: 39 }, title: { color: palette.c1d362c, fontSize: typography.mobile.rawSize.s29, lineHeight: 36, letterSpacing: -1.1, fontWeight: typography.weight.bold }, subtitle: { marginTop: 8, color: palette.c71827b, fontSize: typography.mobile.rawSize.s13, lineHeight: 19 }, toggle: { flexDirection: "row", height: 48, marginTop: 29, padding: 3, borderRadius: 12, backgroundColor: palette.ce9e9e2 }, toggleItem: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 10 }, selected: { backgroundColor: palette.cfff, borderWidth: 1, borderColor: palette.cd0d1cc, elevation: 2 }, toggleText: { color: palette.c788680, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.semibold }, selectedText: { color: palette.c286143 }, form: { marginTop: 25 }, label: { marginBottom: 7, color: palette.c294038, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.bold }, input: { height: 43, flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 15, paddingHorizontal: 12, borderWidth: 1, borderColor: palette.ce1e4df, borderRadius: 12, backgroundColor: palette.cfff }, inputText: { flex: 1, color: palette.c254139, fontSize: typography.mobile.rawSize.s14, paddingVertical: 0 }, options: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: -3 }, remember: { flexDirection: "row", alignItems: "center", gap: 4 }, option: { color: palette.c637871, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.semibold }, forgot: { color: palette.c397c55, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.bold }, button: { height: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 72, borderRadius: 11, backgroundColor: palette.c438756, elevation: 3 }, disabled: { opacity: 0.65 }, buttonText: { color: palette.cfff, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.bold }, terms: { marginTop: "auto", paddingTop: 34, color: palette.c99a5a0, fontSize: typography.mobile.rawSize.s10, lineHeight: 15, textAlign: "center" }, modalOverlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: palette.crgba_24_43_35_0_35 }, dialog: { width: "100%", maxWidth: 340, alignItems: "center", padding: 25, borderRadius: 22, backgroundColor: palette.cfffefa }, dialogIcon: { width: 52, height: 52, alignItems: "center", justifyContent: "center", borderRadius: 26 }, successIcon: { backgroundColor: palette.ce3f3e5 }, errorIcon: { backgroundColor: palette.cf9e6e2 }, infoIcon: { backgroundColor: palette.ce1f1eb }, dialogTitle: { marginTop: 15, color: palette.c213c31, fontSize: typography.mobile.rawSize.s20, fontWeight: typography.weight.bold }, dialogMessage: { marginTop: 8, color: palette.c65776e, fontSize: typography.mobile.rawSize.s14, lineHeight: 20, textAlign: "center" }, dialogButton: { width: "100%", height: 46, alignItems: "center", justifyContent: "center", marginTop: 23, borderRadius: 11, backgroundColor: palette.c438756 }, dialogButtonText: { color: palette.cfff, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.bold } });
