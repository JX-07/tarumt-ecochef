import { apiBaseUrl } from "../../../lib/api-url";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { colors, palette, typography } from "@ecochef/design-tokens";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { sendPasswordResetEmail } from "firebase/auth";
import { useState } from "react";
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from "react-native";

import { firebaseAuth } from "../../../lib/firebase";
import { goBackOrReplace } from "../../../shared/navigation";

const ecoChefLogo = require("../../../../assets/ecochef-logo-horizontal.png");


async function confirmConsumerResetEmail(email: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/auth/password-reset-eligibility`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, requested_role: "consumer" }),
  });
  if (response.ok) return;
  throw new Error("We could not send password-reset instructions. Check the email address and try again.");
}

export function ForgotPasswordScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const changePassword = mode === "change-password";
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ title: string; message: string; error?: boolean } | null>(null);
  const sendReset = async () => {
    try {
      setSending(true);
      if (/^\S+@\S+\.\S+$/.test(email.trim())) {
        await confirmConsumerResetEmail(email.trim());
        await sendPasswordResetEmail(firebaseAuth, email.trim());
      }
    } catch {
      // Deliberately do not reveal whether this email exists or belongs to another portal.
    }
    finally {
      setSending(false);
      setFeedback({ title: "Check your email", message: "If an EcoChef account uses this email address, password-reset instructions have been sent." });
    }
  };
  const closeFeedback = () => { const success = feedback && !feedback.error; setFeedback(null); if (success) router.replace("/(auth)/sign-in"); };
  return <KeyboardAvoidingView style={styles.root} behavior={Platform.select({ ios: "padding", default: undefined })}><View style={styles.content}><Pressable style={styles.back} onPress={() => goBackOrReplace(changePassword ? "/account" : "/(auth)/sign-in")} hitSlop={12}><Ionicons name="arrow-back" size={22} color={palette.c286143} /><Text style={styles.backText}>{changePassword ? "Back to profile" : "Back to sign in"}</Text></Pressable><Image source={ecoChefLogo} style={styles.logo} resizeMode="contain" accessibilityLabel="EcoChef" /><View style={styles.card}><View style={styles.icon}><Ionicons name="key-outline" size={28} color={palette.c286143} /></View><Text style={styles.title}>{changePassword ? "Change password" : "Forgot password?"}</Text><Text style={styles.copy}>Enter the email address for your EcoChef account. We’ll send you a link to reset your password.</Text><Text style={styles.label}>Email</Text><View style={styles.input}><Ionicons name="mail-outline" size={19} color={palette.c8b9b94} /><TextInput style={styles.inputText} placeholder="you@example.com" placeholderTextColor={palette.c8a9691} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoFocus /></View><Pressable style={[styles.button, sending && styles.disabled]} disabled={sending} onPress={sendReset}><Text style={styles.buttonText}>{sending ? "Sending…" : "Send reset link"}</Text><Ionicons name="arrow-forward" size={19} color={palette.cfff} /></Pressable></View></View><Modal transparent visible={Boolean(feedback)} animationType="fade" onRequestClose={closeFeedback}><View style={styles.overlay}><View style={styles.dialog}><View style={[styles.dialogIcon, feedback?.error ? styles.errorIcon : styles.successIcon]}><Ionicons name={feedback?.error ? "alert" : "checkmark"} size={25} color={feedback?.error ? palette.cb54a4a : palette.c34784a} /></View><Text style={styles.dialogTitle}>{feedback?.title}</Text><Text style={styles.dialogText}>{feedback?.message}</Text><Pressable style={styles.dialogButton} onPress={closeFeedback}><Text style={styles.buttonText}>{feedback?.error ? "Try again" : "Back to sign in"}</Text></Pressable></View></View></Modal></KeyboardAvoidingView>;
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.consumerCanvas }, content: { flex: 1, paddingHorizontal: 25, paddingTop: 40 }, back: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 7 }, backText: { color: palette.c286143, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.semibold }, logo: { width: 145, height: 49, marginTop: 35 }, card: { marginTop: 42 }, icon: { width: 54, height: 54, alignItems: "center", justifyContent: "center", borderRadius: 27, backgroundColor: palette.ce1f1eb }, title: { marginTop: 19, color: palette.c1d362c, fontSize: typography.mobile.rawSize.s29, fontWeight: typography.weight.bold, letterSpacing: -1 }, copy: { marginTop: 9, color: palette.c71827b, fontSize: typography.mobile.rawSize.s14, lineHeight: 21 }, label: { marginTop: 29, marginBottom: 7, color: palette.c294038, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.bold }, input: { height: 47, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: palette.ce1e4df, borderRadius: 12, backgroundColor: palette.cfff }, inputText: { flex: 1, color: palette.c254139, fontSize: typography.mobile.rawSize.s14 }, button: { height: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 26, borderRadius: 11, backgroundColor: palette.c438756 }, disabled: { opacity: 0.65 }, buttonText: { color: palette.cfff, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.bold }, overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: palette.crgba_24_43_35_0_35 }, dialog: { width: "100%", maxWidth: 340, alignItems: "center", padding: 25, borderRadius: 22, backgroundColor: palette.cfffefa }, dialogIcon: { width: 52, height: 52, alignItems: "center", justifyContent: "center", borderRadius: 26 }, successIcon: { backgroundColor: palette.ce3f3e5 }, errorIcon: { backgroundColor: palette.cf9e6e2 }, dialogTitle: { marginTop: 15, color: palette.c213c31, fontSize: typography.mobile.rawSize.s20, fontWeight: typography.weight.bold }, dialogText: { marginTop: 8, color: palette.c65776e, fontSize: typography.mobile.rawSize.s14, lineHeight: 20, textAlign: "center" }, dialogButton: { width: "100%", height: 46, alignItems: "center", justifyContent: "center", marginTop: 23, borderRadius: 11, backgroundColor: palette.c438756 } });
