import { apiBaseUrl } from "../../../lib/api-url";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createMobileApi } from "../../../lib/api";
import { useAuth } from "../../auth/auth-provider";

type StoreChoice = { store_id: string; store_name: string; icon_url?: string };
type ChatMessage = { id: string; sender_role: "consumer" | "business_owner"; sender_name: string; message_type: "text" | "photo" | "pdf" | "delivery_alert"; body?: string; attachment_name?: string; attachment_content_type?: string; attachment_data?: string; created_at: string };
type Chat = { store_name: string; store_icon_url?: string; messages: ChatMessage[]; other_typing: boolean };

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;


export function OrderChatScreen() {
  const params = useLocalSearchParams<{ orderId: string; storeId?: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [stores, setStores] = useState<StoreChoice[]>([]);
  const [storeId, setStoreId] = useState(params.storeId || "");
  const [chat, setChat] = useState<Chat>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<ScrollViewInstance>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!params.orderId) return;
    api.getOrderChats<{ stores: StoreChoice[] }>(params.orderId).then((result) => {
      setStores(result.stores);
      setStoreId((current) => current || result.stores[0]?.store_id || "");
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "This conversation is not available."));
  }, [api, params.orderId]);

  const load = useCallback(async () => {
    if (!params.orderId || !storeId) return;
    try { setChat(await api.getOrderChat<Chat>(params.orderId, storeId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The conversation could not be loaded."); }
  }, [api, params.orderId, storeId]);

  useEffect(() => { void load(); if (!storeId) return; const interval = setInterval(() => void load(), 2000); return () => clearInterval(interval); }, [load, storeId]);
  useEffect(() => { const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80); return () => clearTimeout(timer); }, [chat?.messages.length, chat?.other_typing]);
  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); if (params.orderId && storeId) void api.setOrderChatTyping(params.orderId, storeId, false); }, [api, params.orderId, storeId]);

  const notifyTyping = () => {
    if (!params.orderId || !storeId) return;
    void api.setOrderChatTyping(params.orderId, storeId, true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => void api.setOrderChatTyping(params.orderId, storeId, false), 1800);
  };

  const sendText = async () => {
    if (!params.orderId || !storeId || !message.trim() || busy) return;
    setBusy(true); setError("");
    try { await api.sendOrderChatMessage(params.orderId, storeId, { message_type: "text", body: message.trim() }); setMessage(""); await api.setOrderChatTyping(params.orderId, storeId, false); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The message could not be sent."); }
    finally { setBusy(false); }
  };

  const sendPhoto = async () => {
    if (!params.orderId || !storeId || busy) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError("Allow photo access in your device settings to send an image."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, base64: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    if ((asset.fileSize || 0) > 8 * 1024 * 1024) { setError("Photos must be 8 MB or smaller."); return; }
    setBusy(true); setError("");
    try {
      const data = asset.base64 ?? await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      await api.sendOrderChatMessage(params.orderId, storeId, { message_type: "photo", attachment_name: asset.fileName || `ecochef-photo-${Date.now()}.jpg`, attachment_content_type: asset.mimeType || "image/jpeg", attachment_data: data });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The photo could not be sent."); }
    finally { setBusy(false); }
  };

  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <View style={[styles.header, { paddingTop: insets.top + spacing[2] }]}><Pressable accessibilityLabel="Back" style={styles.iconButton} onPress={() => router.back()}><Ionicons name="chevron-back" size={spacing[6]} color={colors.text} /></Pressable><View style={styles.headerCopy}><Text style={styles.headerTitle}>{chat?.store_name || "Order chat"}</Text><Text style={styles.headerSubtitle}>Paid order #{params.orderId?.slice(0, 8).toUpperCase()}</Text></View><View style={styles.iconButton} /></View>
    {stores.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storeTabs}>{stores.map((store) => <Pressable key={store.store_id} onPress={() => setStoreId(store.store_id)} style={[styles.storeTab, storeId === store.store_id && styles.storeTabActive]}><Text style={[styles.storeTabText, storeId === store.store_id && styles.storeTabTextActive]}>{store.store_name}</Text></Pressable>)}</ScrollView> : null}
    <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messagesContent} keyboardShouldPersistTaps="handled">
      {!chat?.messages.length ? <View style={styles.welcome}><View style={styles.welcomeIcon}><Ionicons name="chatbubbles-outline" size={spacing[6]} color={colors.primaryStrong} /></View><Text style={styles.welcomeTitle}>Message the shop</Text><Text style={styles.welcomeText}>Ask a question or share a photo about this paid order.</Text></View> : null}
      {chat?.messages.map((item) => <MessageBubble key={item.id} message={item} />)}
      {chat?.other_typing ? <TypingBubble /> : null}
    </ScrollView>
    {error ? <View style={styles.error}><Ionicons name="alert-circle-outline" size={spacing[5]} color={colors.danger} /><Text style={styles.errorText}>{error}</Text></View> : null}
    <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing[3]) }]}><Pressable accessibilityLabel="Send a photo" disabled={busy} style={styles.attachButton} onPress={() => void sendPhoto()}><Ionicons name="image-outline" size={spacing[6]} color={colors.primaryStrong} /></Pressable><TextInput style={styles.input} placeholder="Message shop…" placeholderTextColor={colors.textSubtle} multiline maxLength={2000} value={message} onChangeText={(value) => { setMessage(value); notifyTyping(); }} /><Pressable accessibilityLabel="Send message" disabled={busy || !message.trim()} style={[styles.sendButton, (busy || !message.trim()) && styles.sendButtonDisabled]} onPress={() => void sendText()}><Ionicons name="send" size={spacing[5]} color={busy || !message.trim() ? colors.textSubtle : colors.surface} /></Pressable></View>
  </KeyboardAvoidingView>;
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.message_type === "delivery_alert") return <View style={styles.alertBubble}><Ionicons name="notifications" size={spacing[5]} color={colors.marketStrong} /><View style={styles.alertCopy}><Text style={styles.alertTitle}>Delivery update</Text><Text style={styles.alertText}>{message.body}</Text><Text style={styles.alertTime}>{time(message.created_at)}</Text></View></View>;
  const mine = message.sender_role === "consumer";
  const dataUri = message.attachment_data && message.attachment_content_type ? `data:${message.attachment_content_type};base64,${message.attachment_data}` : "";
  return <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}><View style={[styles.bubble, mine && styles.bubbleMine]}>
    {message.message_type === "photo" && dataUri ? <Image source={{ uri: dataUri }} style={styles.photo} resizeMode="contain" /> : null}
    {message.message_type === "pdf" ? <Pressable style={styles.pdfCard} onPress={() => void openPdf(message)}><Ionicons name="document-text-outline" size={spacing[6]} color={colors.primaryStrong} /><View style={styles.pdfCopy}><Text numberOfLines={1} style={styles.pdfName}>{message.attachment_name || "Document.pdf"}</Text><Text style={styles.pdfLabel}>PDF document · Tap to open</Text></View></Pressable> : null}
    {message.body ? <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.body}</Text> : null}<Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>{time(message.created_at)}</Text>
  </View></View>;
}

function TypingBubble() {
  const first = useRef(new Animated.Value(0)).current, second = useRef(new Animated.Value(0)).current, third = useRef(new Animated.Value(0)).current;
  useEffect(() => { const bounce = (value: Animated.Value, delay: number) => Animated.sequence([Animated.delay(delay), Animated.timing(value, { toValue: -4, duration: 180, useNativeDriver: true }), Animated.timing(value, { toValue: 0, duration: 180, useNativeDriver: true }), Animated.delay(420 - delay)]); const loop = Animated.loop(Animated.parallel([bounce(first, 0), bounce(second, 120), bounce(third, 240)])); loop.start(); return () => loop.stop(); }, [first, second, third]);
  return <View style={styles.typingBubble}><Animated.View style={[styles.typingDot, { transform: [{ translateY: first }] }]} /><Animated.View style={[styles.typingDot, { transform: [{ translateY: second }] }]} /><Animated.View style={[styles.typingDot, { transform: [{ translateY: third }] }]} /><Text style={styles.typingText}>Shop is typing</Text></View>;
}

async function openPdf(message: ChatMessage) {
  if (!message.attachment_data) return;
  const safeName = (message.attachment_name || `ecochef-${message.id}.pdf`).replace(/[^a-zA-Z0-9._-]/g, "-");
  const uri = `${FileSystem.cacheDirectory}${safeName}`;
  await FileSystem.writeAsStringAsync(uri, message.attachment_data, { encoding: FileSystem.EncodingType.Base64 });
  await Linking.openURL(uri);
}
function time(value: string) { return new Date(value).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" }); }

const size = typography.mobile.size, weight = typography.weight;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas }, header: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingHorizontal: spacing[4], paddingBottom: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }, iconButton: { width: spacing[10], height: spacing[10], alignItems: "center", justifyContent: "center", borderRadius: spacing[5], backgroundColor: colors.surfaceMuted }, headerCopy: { flex: 1, alignItems: "center" }, headerTitle: { color: colors.text, fontSize: size.secondaryTextHeavy, fontWeight: weight.bold }, headerSubtitle: { marginTop: spacing[1], color: colors.textMuted, fontSize: size.caption },
  storeTabs: { gap: spacing[2], paddingHorizontal: spacing[4], paddingVertical: spacing[2], backgroundColor: colors.surface }, storeTab: { paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderWidth: 1, borderColor: colors.border, borderRadius: spacing[5], backgroundColor: colors.surface }, storeTabActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft }, storeTabText: { color: colors.textMuted, fontSize: size.caption, fontWeight: weight.semibold }, storeTabTextActive: { color: colors.primaryStrong },
  messages: { flex: 1 }, messagesContent: { flexGrow: 1, padding: spacing[4] }, welcome: { flex: 1, minHeight: 320, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing[8] }, welcomeIcon: { width: spacing[12], height: spacing[12], alignItems: "center", justifyContent: "center", borderRadius: spacing[6], backgroundColor: colors.primarySoft }, welcomeTitle: { marginTop: spacing[3], color: colors.text, fontSize: size.secondaryTextHeavy, fontWeight: weight.bold }, welcomeText: { marginTop: spacing[1], color: colors.textMuted, fontSize: size.caption, lineHeight: spacing[5], textAlign: "center" },
  bubbleRow: { flexDirection: "row", marginVertical: spacing[1] }, bubbleRowMine: { justifyContent: "flex-end" }, bubble: { maxWidth: "82%", padding: spacing[3], borderWidth: 1, borderColor: colors.border, borderTopLeftRadius: spacing[4], borderTopRightRadius: spacing[4], borderBottomRightRadius: spacing[4], borderBottomLeftRadius: spacing[1], backgroundColor: colors.surface }, bubbleMine: { borderColor: colors.primary, borderBottomRightRadius: spacing[1], borderBottomLeftRadius: spacing[4], backgroundColor: colors.primary }, bubbleText: { color: colors.text, fontSize: size.secondaryInteraction, lineHeight: spacing[5] }, bubbleTextMine: { color: colors.surface }, bubbleTime: { marginTop: spacing[1], color: colors.textSubtle, fontSize: typography.mobile.rawSize.s10, textAlign: "right" }, bubbleTimeMine: { color: colors.primarySoft }, photo: { width: 230, height: 210, marginBottom: spacing[2], borderRadius: spacing[2], backgroundColor: colors.surfaceMuted },
  pdfCard: { flexDirection: "row", alignItems: "center", gap: spacing[3], minWidth: 230, padding: spacing[3], borderRadius: spacing[2], backgroundColor: colors.surfaceMuted }, pdfCopy: { flex: 1 }, pdfName: { color: colors.text, fontSize: size.caption, fontWeight: weight.bold }, pdfLabel: { marginTop: spacing[1], color: colors.textMuted, fontSize: typography.mobile.rawSize.s10 },
  alertBubble: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3], marginVertical: spacing[3], padding: spacing[3], borderWidth: 1, borderColor: colors.marketBorder, borderRadius: spacing[3], backgroundColor: colors.marketSoft }, alertCopy: { flex: 1 }, alertTitle: { color: colors.marketStrong, fontSize: size.caption, fontWeight: weight.bold }, alertText: { marginTop: spacing[1], color: colors.text, fontSize: size.caption, lineHeight: spacing[5] }, alertTime: { marginTop: spacing[1], color: colors.textMuted, fontSize: typography.mobile.rawSize.s10 },
  typingBubble: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: spacing[1], marginTop: spacing[2], padding: spacing[3], borderRadius: spacing[4], backgroundColor: colors.surface }, typingDot: { width: spacing[2], height: spacing[2], borderRadius: spacing[1], backgroundColor: colors.textSubtle }, typingText: { marginLeft: spacing[1], color: colors.textMuted, fontSize: size.caption },
  error: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingHorizontal: spacing[4], paddingVertical: spacing[2], backgroundColor: colors.dangerSoft }, errorText: { flex: 1, color: colors.danger, fontSize: size.caption }, composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing[2], paddingHorizontal: spacing[3], paddingTop: spacing[3], borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }, attachButton: { width: spacing[10], height: spacing[10], alignItems: "center", justifyContent: "center", borderRadius: spacing[5], backgroundColor: colors.primarySoft }, input: { flex: 1, maxHeight: 100, minHeight: spacing[10], paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderWidth: 1, borderColor: colors.border, borderRadius: spacing[4], color: colors.text, backgroundColor: colors.surfaceMuted, fontSize: size.secondaryInteraction, fontWeight: weight.regular }, sendButton: { width: spacing[10], height: spacing[10], alignItems: "center", justifyContent: "center", borderRadius: spacing[5], backgroundColor: colors.primary }, sendButtonDisabled: { backgroundColor: colors.surfaceMuted },
});
