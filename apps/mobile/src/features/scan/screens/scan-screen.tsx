import { apiBaseUrl } from "../../../lib/api-url";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { colors, typography } from "@ecochef/design-tokens";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../auth/auth-provider";
import { createMobileApi } from "../../../lib/api";
import { ingredientEmojiFor } from "../../../shared/ingredient-icons";
import { PAGE_TOP_GAP, PageHeader } from "../../../shared/components/page-header";
import { saveScanHistory } from "../history";
import type {
  EditableIngredient,
  FreshnessItem,
  FreshnessResult,
  FreshnessStatus,
  IngredientDetectionResult,
} from "../types";

type Mode = "freshness" | "ingredients";
type Phase = "capture" | "processing" | "freshness-result" | "ingredients-result";
type SelectedImage = { uri: string; base64: string; contentType: string };

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;

const UNITS = ["pcs", "g", "kg", "ml", "L", "bunch", "head", "slices", "packs"];

function localDateAfter(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + Math.max(0, days));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function statusPresentation(status: FreshnessStatus) {
  if (status === "fresh") return { label: "Fresh", color: colors.success, background: colors.successSoft };
  if (status === "use_soon") return { label: "Use soon", color: colors.warningStrong, background: colors.warningSoft };
  if (status === "spoiled") return { label: "Likely spoiled", color: colors.danger, background: colors.dangerSoft };
  return { label: "Unclear", color: colors.textMuted, background: colors.surfaceMuted };
}

async function normalizeAsset(asset: ImagePicker.ImagePickerAsset): Promise<SelectedImage> {
  const base64 = asset.base64 ?? await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
  return { uri: asset.uri, base64, contentType: asset.mimeType ?? "image/jpeg" };
}

function SegmentedControl({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return <View style={styles.segmented}>
    <Pressable onPress={() => onChange("freshness")} style={[styles.segment, mode === "freshness" && styles.segmentActive]}>
      <Text style={[styles.segmentText, mode === "freshness" && styles.segmentTextActive]}>Assess Freshness</Text>
    </Pressable>
    <Pressable onPress={() => onChange("ingredients")} style={[styles.segment, mode === "ingredients" && styles.segmentActive]}>
      <Text style={[styles.segmentText, mode === "ingredients" && styles.segmentTextActive]}>Add to Ingredients</Text>
    </Pressable>
  </View>;
}

function Header({ mode, onChange, showModeSwitcher, onBack }: { mode: Mode; onChange: (mode: Mode) => void; showModeSwitcher: boolean; onBack: () => void }) {
  return <View style={styles.header}>
    <View style={styles.headerRow}>
      <Pressable accessibilityLabel={showModeSwitcher ? "Back to home" : "Back to scan photo"} onPress={onBack} style={styles.iconButton}>
        <Ionicons name="chevron-back" size={21} color={colors.text} />
      </Pressable>
      <View style={styles.headerHeading}><PageHeader title="Food Scanner" action={<Pressable accessibilityLabel="Scan history" onPress={() => router.push("/scan-history")} style={[styles.iconButton, styles.historyButton]}><Ionicons name="time-outline" size={20} color={colors.primaryStrong} /></Pressable>} /></View>
    </View>
    {showModeSwitcher ? <SegmentedControl mode={mode} onChange={onChange} /> : null}
  </View>;
}

function CaptureView({ mode, onCamera, onGallery, error }: { mode: Mode; onCamera: () => void; onGallery: () => void; error?: string }) {
  const freshness = mode === "freshness";
  return <View style={styles.captureContent}>
    <Text style={styles.heroTitle}>{freshness ? "Is it still good?" : "What’s in your fridge?"}</Text>
    <Text style={styles.heroBody}>{freshness ? "Scan food to assess visible freshness and spoilage signs." : "Scan your groceries and add detected ingredients to your list."}</Text>
    <Pressable onPress={onCamera} style={styles.cameraCard}>
      <View style={styles.cameraCircle}><Ionicons name="camera-outline" size={31} color={colors.primaryStrong} /></View>
      <Text style={styles.cameraText}>Tap to open camera</Text>
      <Text style={styles.cameraHint}>Keep every item visible and well lit</Text>
    </Pressable>
    <View style={styles.orRow}><View style={styles.orLine} /><Text style={styles.orText}>OR</Text><View style={styles.orLine} /></View>
    <Pressable onPress={onGallery} style={styles.secondaryButton}>
      <Ionicons name="cloud-upload-outline" size={19} color={colors.text} />
      <Text style={styles.secondaryButtonText}>Upload from Gallery</Text>
    </Pressable>
    {error ? <View style={styles.errorBox}><Ionicons name="alert-circle-outline" size={18} color={colors.danger} /><Text style={styles.errorText}>{error}</Text></View> : null}
  </View>;
}

function ProcessingView({ image, mode }: { image: SelectedImage; mode: Mode }) {
  return <View style={styles.processing}>
    <Image source={{ uri: image.uri }} style={styles.processingImage} />
    <ActivityIndicator size="large" color={colors.primary} />
    <Text style={styles.processingTitle}>{mode === "freshness" ? "Assessing freshness…" : "Finding ingredients…"}</Text>
    <Text style={styles.processingBody}>{mode === "freshness" ? "Checking visible colour, texture and spoilage signs." : "Identifying each visible food item and estimating quantities."}</Text>
    <View style={styles.progressTrack}><View style={styles.progressFill} /></View>
  </View>;
}

function FreshnessCard({ item, expanded, onToggle }: { item: FreshnessItem; expanded: boolean; onToggle: () => void }) {
  const status = statusPresentation(item.status);
  const safetyLabel = item.safe_to_consume === true ? "Appears safe based on visible signs" : item.safe_to_consume === false ? "Do not consume" : "Safety cannot be confirmed";
  return <View style={styles.resultCard}>
    <Pressable onPress={onToggle} style={styles.resultSummary}>
      <View style={[styles.foodIcon, { backgroundColor: status.background }]}><Text style={styles.foodEmoji}>{ingredientEmojiFor(item.name)}</Text></View>
      <View style={styles.resultHeading}><Text style={styles.resultName}>{item.name}</Text><Text style={styles.resultFinding} numberOfLines={expanded ? undefined : 1}>{item.finding}</Text></View>
      <View style={[styles.statusPill, { backgroundColor: status.background }]}><Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text></View>
      <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={19} color={colors.textMuted} />
    </Pressable>
    {expanded ? <View style={styles.details}>
      <View style={styles.confidenceRow}><Text style={styles.detailLabel}>Confidence</Text><Text style={styles.confidence}>{Math.round(item.confidence * 100)}%</Text></View>
      <DetailSection title="What may be happening" items={item.spoilage_reasons} empty="No visible spoilage reason was detected." />
      <DetailSection title="How to prevent it" items={item.prevention} empty="Store it using the recommended conditions for this food." />
      <View style={[styles.safetyBox, { backgroundColor: item.safe_to_consume === false ? colors.dangerSoft : item.safe_to_consume === true ? colors.successSoft : colors.warningSoft }]}>
        <Ionicons name={item.safe_to_consume === false ? "close-circle" : item.safe_to_consume === true ? "checkmark-circle" : "help-circle"} size={20} color={item.safe_to_consume === false ? colors.danger : item.safe_to_consume === true ? colors.success : colors.warningStrong} />
        <View style={styles.safetyCopy}><Text style={styles.safetyTitle}>{safetyLabel}</Text><Text style={styles.safetyNote}>{item.safety_note}</Text></View>
      </View>
    </View> : null}
  </View>;
}

function DetailSection({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  const values = items.length ? items : [empty];
  return <View style={styles.detailSection}><Text style={styles.detailLabel}>{title}</Text>{values.map((value, index) => <View key={`${value}-${index}`} style={styles.bulletRow}><Text style={styles.bullet}>•</Text><Text style={styles.detailText}>{value}</Text></View>)}</View>;
}

function FreshnessResults({ result, image, expanded, onToggle, onScanAgain }: { result: FreshnessResult; image: SelectedImage; expanded: Set<number>; onToggle: (index: number) => void; onScanAgain: () => void }) {
  return <View style={styles.resultsContent}>
    <Image source={{ uri: image.uri }} style={styles.resultImage} />
    <View style={styles.resultsTitleRow}><View><Text style={styles.resultsTitle}>Freshness assessment</Text><Text style={styles.resultsSubtitle}>{result.items.length} visible {result.items.length === 1 ? "item" : "items"}</Text></View><View style={styles.aiPill}><Ionicons name="sparkles" size={13} color={colors.primaryStrong} /><Text style={styles.aiPillText}>{result.provider === "freshness_model_api" ? "EcoChef freshness AI" : "Gemini preview"}</Text></View></View>
    {result.items.length ? result.items.map((item, index) => <FreshnessCard key={`${item.name}-${index}`} item={item} expanded={expanded.has(index)} onToggle={() => onToggle(index)} />) : <EmptyResult message="No food could be identified. Try a closer, brighter photo." />}
    <View style={styles.disclaimer}><Ionicons name="information-circle-outline" size={18} color={colors.warningStrong} /><Text style={styles.disclaimerText}>{result.disclaimer}</Text></View>
    <Pressable onPress={onScanAgain} style={styles.secondaryButton}><Ionicons name="scan-outline" size={19} color={colors.text} /><Text style={styles.secondaryButtonText}>Scan Another Item</Text></Pressable>
  </View>;
}

function IngredientCard({ item, expanded, onToggle, onChange, onRemove }: { item: EditableIngredient; expanded: boolean; onToggle: () => void; onChange: (patch: Partial<EditableIngredient>) => void; onRemove: () => void }) {
  return <View style={styles.ingredientCard}>
    <Pressable onPress={onToggle} style={styles.ingredientSummary}>
      <View style={styles.ingredientEmojiBox}><Text style={styles.foodEmoji}>{ingredientEmojiFor(item.name)}</Text></View>
      <View style={styles.resultHeading}><Text style={styles.resultName}>{item.name || "Unnamed ingredient"}</Text><Text style={styles.resultFinding}>{item.amount} {item.unit} · expires {item.expiryDate}</Text></View>
      {item.confidence !== undefined ? <Text style={styles.detectedConfidence}>{Math.round(item.confidence * 100)}%</Text> : null}
      <Ionicons name={expanded ? "chevron-up" : "create-outline"} size={19} color={colors.primaryStrong} />
    </Pressable>
    {expanded ? <View style={styles.editor}>
      <Field label="Ingredient name"><TextInput value={item.name} onChangeText={(name) => onChange({ name })} style={styles.input} placeholder="e.g. Spinach" /></Field>
      <View style={styles.twoColumns}><Field label="Amount" style={styles.column}><TextInput value={item.amount} onChangeText={(amount) => onChange({ amount })} keyboardType="decimal-pad" style={styles.input} /></Field><Field label="Unit" style={styles.column}><TextInput value={item.unit} onChangeText={(unit) => onChange({ unit })} style={styles.input} /></Field></View>
      <View style={styles.unitChips}>{UNITS.map((unit) => <Pressable key={unit} onPress={() => onChange({ unit })} style={[styles.unitChip, item.unit === unit && styles.unitChipActive]}><Text style={[styles.unitChipText, item.unit === unit && styles.unitChipTextActive]}>{unit}</Text></Pressable>)}</View>
      <Field label="Expiry date (YYYY-MM-DD)"><TextInput value={item.expiryDate} onChangeText={(expiryDate) => onChange({ expiryDate })} style={styles.input} placeholder="YYYY-MM-DD" /></Field>
      <Field label="Category (optional)"><TextInput value={item.category} onChangeText={(category) => onChange({ category })} style={styles.input} placeholder="Vegetables" /></Field>
      <Pressable onPress={onRemove} style={styles.removeButton}><Ionicons name="trash-outline" size={17} color={colors.danger} /><Text style={styles.removeText}>Remove incorrect detection</Text></Pressable>
    </View> : null}
  </View>;
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: object }) {
  return <View style={[styles.field, style]}><Text style={styles.fieldLabel}>{label}</Text>{children}</View>;
}

function EmptyResult({ message }: { message: string }) {
  return <View style={styles.emptyResult}><Ionicons name="leaf-outline" size={28} color={colors.textSubtle} /><Text style={styles.emptyResultText}>{message}</Text></View>;
}

function IngredientResults({ items, provider, expandedId, adding, onToggle, onChange, onRemove, onManual, onAdd, onScanAgain }: { items: EditableIngredient[]; provider?: IngredientDetectionResult["provider"]; expandedId?: string; adding: boolean; onToggle: (id: string) => void; onChange: (id: string, patch: Partial<EditableIngredient>) => void; onRemove: (id: string) => void; onManual: () => void; onAdd: () => void; onScanAgain: () => void }) {
  return <View style={styles.resultsContent}>
    <View style={styles.resultsTitleRow}><View><Text style={styles.resultsTitle}>Detected Ingredients</Text><Text style={styles.resultsSubtitle}>Review and edit before adding to your list.</Text></View><View style={styles.aiPill}><Ionicons name="sparkles" size={13} color={colors.primaryStrong} /><Text style={styles.aiPillText}>{provider === "food_detection_api" ? "EcoChef detector" : "Gemini fallback"}</Text></View></View>
    {items.length ? items.map((item) => <IngredientCard key={item.id} item={item} expanded={expandedId === item.id} onToggle={() => onToggle(item.id)} onChange={(patch) => onChange(item.id, patch)} onRemove={() => onRemove(item.id)} />) : <EmptyResult message="No ingredients remain. Add one manually or scan another photo." />}
    <Pressable onPress={onManual} style={styles.secondaryButton}><Ionicons name="create-outline" size={19} color={colors.text} /><Text style={styles.secondaryButtonText}>Add Manually</Text></Pressable>
    <Pressable disabled={!items.length || adding} onPress={onAdd} style={[styles.primaryButton, (!items.length || adding) && styles.buttonDisabled]}>{adding ? <ActivityIndicator color={colors.surface} /> : <><Ionicons name="add" size={21} color={colors.surface} /><Text style={styles.primaryButtonText}>Add {items.length} {items.length === 1 ? "Item" : "Items"} to Ingredient List</Text></>}</Pressable>
    <Pressable onPress={onScanAgain} style={styles.scanAgainButton}><Ionicons name="refresh-outline" size={18} color={colors.textMuted} /><Text style={styles.scanAgainText}>Scan Again</Text></Pressable>
  </View>;
}

type DialogState = { kind: "discard" } | { kind: "success"; count: number } | undefined;

function AppDialog({ dialog, onClose, onConfirm }: { dialog: DialogState; onClose: () => void; onConfirm: () => void }) {
  if (!dialog) return null;
  const discard = dialog.kind === "discard";
  return <Modal transparent animationType="fade" visible onRequestClose={onClose}><View style={styles.modalOverlay}><View style={styles.dialog}>
    <View style={[styles.dialogIcon, { backgroundColor: discard ? colors.warningSoft : colors.successSoft }]}><Ionicons name={discard ? "refresh-outline" : "checkmark"} size={26} color={discard ? colors.warningStrong : colors.success} /></View>
    <Text style={styles.dialogTitle}>{discard ? "Scan another photo?" : "Ingredients added"}</Text>
    <Text style={styles.dialogBody}>{discard ? "Your current detected ingredients and edits will be discarded." : `${dialog.count} ${dialog.count === 1 ? "item is" : "items are"} now in your ingredient list.`}</Text>
    {discard ? <View style={styles.dialogActions}><Pressable onPress={onClose} style={styles.dialogSecondary}><Text style={styles.dialogSecondaryText}>Keep editing</Text></Pressable><Pressable onPress={onConfirm} style={styles.dialogPrimary}><Text style={styles.dialogPrimaryText}>Scan again</Text></Pressable></View> : <Pressable onPress={onConfirm} style={styles.dialogPrimaryFull}><Text style={styles.dialogPrimaryText}>View Ingredient List</Text></Pressable>}
  </View></View></Modal>;
}

function ManualIngredientModal({ visible, onClose, onAdd }: { visible: boolean; onClose: () => void; onAdd: (item: EditableIngredient) => void }) {
  const [draft, setDraft] = useState<EditableIngredient>({ id: "", name: "", amount: "1", unit: "pcs", expiryDate: localDateAfter(7), category: "" });
  const valid = draft.name.trim() && draft.amount.trim() && /^\d{4}-\d{2}-\d{2}$/.test(draft.expiryDate);
  function close() { setDraft({ id: "", name: "", amount: "1", unit: "pcs", expiryDate: localDateAfter(7), category: "" }); onClose(); }
  return <Modal transparent animationType="slide" visible={visible} onRequestClose={close}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalOverlay}><View style={styles.manualSheet}>
    <View style={styles.sheetHandle} /><View style={styles.sheetTitleRow}><Text style={styles.dialogTitle}>Add an ingredient</Text><Pressable onPress={close} style={styles.iconButton}><Ionicons name="close" size={21} color={colors.text} /></Pressable></View>
    <Field label="Ingredient name"><TextInput autoFocus value={draft.name} onChangeText={(name) => setDraft((value) => ({ ...value, name }))} style={styles.input} placeholder="e.g. Avocado" /></Field>
    <View style={styles.twoColumns}><Field label="Amount" style={styles.column}><TextInput value={draft.amount} onChangeText={(amount) => setDraft((value) => ({ ...value, amount }))} keyboardType="decimal-pad" style={styles.input} /></Field><Field label="Unit" style={styles.column}><TextInput value={draft.unit} onChangeText={(unit) => setDraft((value) => ({ ...value, unit }))} style={styles.input} /></Field></View>
    <Field label="Expiry date"><TextInput value={draft.expiryDate} onChangeText={(expiryDate) => setDraft((value) => ({ ...value, expiryDate }))} style={styles.input} placeholder="YYYY-MM-DD" /></Field>
    <Pressable disabled={!valid} onPress={() => { onAdd({ ...draft, id: id("manual") }); close(); }} style={[styles.primaryButton, !valid && styles.buttonDisabled]}><Text style={styles.primaryButtonText}>Add to detected items</Text></Pressable>
  </View></KeyboardAvoidingView></Modal>;
}

export function ScanScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [mode, setMode] = useState<Mode>("freshness");
  const [phase, setPhase] = useState<Phase>("capture");
  const [image, setImage] = useState<SelectedImage>();
  const [freshness, setFreshness] = useState<FreshnessResult>();
  const [ingredients, setIngredients] = useState<EditableIngredient[]>([]);
  const [ingredientProvider, setIngredientProvider] = useState<IngredientDetectionResult["provider"]>();
  const [expandedFreshness, setExpandedFreshness] = useState(new Set<number>());
  const [expandedIngredient, setExpandedIngredient] = useState<string>();
  const [error, setError] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>();
  const modeTranslateX = useRef(new Animated.Value(0)).current;
  const modeOpacity = useRef(new Animated.Value(1)).current;
  const modeTransitioning = useRef(false);
  const scanRequestId = useRef(0);

  function reset(nextMode = mode) {
    scanRequestId.current += 1;
    setMode(nextMode); setPhase("capture"); setImage(undefined); setFreshness(undefined); setIngredients([]); setIngredientProvider(undefined); setExpandedFreshness(new Set()); setExpandedIngredient(undefined); setError(undefined);
  }

  function changeMode(nextMode: Mode) {
    if (phase !== "capture" || nextMode === mode || modeTransitioning.current) return;
    modeTransitioning.current = true;
    const direction = nextMode === "ingredients" ? 1 : -1;
    Animated.parallel([
      Animated.timing(modeTranslateX, { toValue: -direction * 72, duration: 145, useNativeDriver: true }),
      Animated.timing(modeOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
    ]).start(() => {
      reset(nextMode);
      modeTranslateX.setValue(direction * 72);
      Animated.parallel([
        Animated.spring(modeTranslateX, { toValue: 0, speed: 20, bounciness: 1, useNativeDriver: true }),
        Animated.timing(modeOpacity, { toValue: 1, duration: 190, useNativeDriver: true }),
      ]).start(() => { modeTransitioning.current = false; });
    });
  }

  async function selectImage(source: "camera" | "gallery") {
    setError(undefined);
    try {
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) { setError("Camera access is needed to take a food photo. You can still upload one from your gallery."); return; }
      }
      const result = source === "camera"
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.75, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.75, base64: true });
      if (result.canceled || !result.assets[0]) return;
      const selected = await normalizeAsset(result.assets[0]);
      setImage(selected); setPhase("processing");
      const requestId = ++scanRequestId.current;
      await analyze(selected, requestId);
    } catch (nextError) {
      setPhase("capture");
      setError(nextError instanceof Error ? nextError.message : "The photo could not be analyzed. Please try again.");
    }
  }

  async function analyze(selected: SelectedImage, requestId: number) {
    try {
      if (mode === "freshness") {
        const result = await api.analyzeFreshness<FreshnessResult>({ data: selected.base64, content_type: selected.contentType });
        if (requestId !== scanRequestId.current) return;
        setFreshness(result); setPhase("freshness-result"); setExpandedFreshness(result.items.length ? new Set([0]) : new Set());
        await saveScanHistory({ id: id("freshness"), mode: "freshness", createdAt: new Date().toISOString(), imageUri: selected.uri, freshnessItems: result.items });
      } else {
        const result = await api.detectIngredients<IngredientDetectionResult>({ data: selected.base64, content_type: selected.contentType });
        if (requestId !== scanRequestId.current) return;
        const editable = result.items.map((item) => ({ id: id("ingredient"), name: item.name, amount: String(item.suggested_amount), unit: item.suggested_unit, expiryDate: localDateAfter(item.suggested_expiry_days), category: item.category ?? "", confidence: item.confidence }));
        setIngredients(editable); setIngredientProvider(result.provider); setExpandedIngredient(editable[0]?.id); setPhase("ingredients-result");
        await saveScanHistory({ id: id("ingredients"), mode: "ingredients", createdAt: new Date().toISOString(), imageUri: selected.uri, ingredientNames: editable.map((item) => item.name) });
      }
    } catch (nextError) {
      if (requestId !== scanRequestId.current) return;
      setPhase("capture"); setImage(undefined);
      setError(nextError instanceof Error ? nextError.message : "The photo could not be analyzed. Please try again.");
    }
  }

  function toggleFreshness(index: number) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedFreshness((current) => { const next = new Set(current); next.has(index) ? next.delete(index) : next.add(index); return next; });
  }

  function toggleIngredient(itemId: string) { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setExpandedIngredient((current) => current === itemId ? undefined : itemId); }
  function updateIngredient(itemId: string, patch: Partial<EditableIngredient>) { setIngredients((current) => current.map((item) => item.id === itemId ? { ...item, ...patch } : item)); }
  function removeIngredient(itemId: string) { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setIngredients((current) => current.filter((item) => item.id !== itemId)); if (expandedIngredient === itemId) setExpandedIngredient(undefined); }

  function handleBack() {
    if (phase === "capture") {
      router.replace("/(tabs)");
      return;
    }
    if (phase === "ingredients-result" && ingredients.length > 0) {
      setDialog({ kind: "discard" });
      return;
    }
    reset(mode);
  }

  async function addIngredients() {
    const invalid = ingredients.find((item) => !item.name.trim() || !item.amount.trim() || !item.unit.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(item.expiryDate));
    if (invalid) { setExpandedIngredient(invalid.id); setError("Complete the name, amount, unit, and expiry date for every item."); return; }
    setAdding(true); setError(undefined);
    try {
      await api.addInventoryItems(ingredients.map((item) => ({ name: item.name.trim(), quantity: `${item.amount.trim()} ${item.unit.trim()}`, expiry_date: new Date(`${item.expiryDate}T12:00:00`).toISOString(), category: item.category.trim() || undefined, source: "scanned", icon: ingredientEmojiFor(item.name) })));
      setDialog({ kind: "success", count: ingredients.length });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The ingredients could not be added.");
    } finally { setAdding(false); }
  }

  return <View style={[styles.root, { paddingTop: insets.top }]}>
    <Header mode={mode} onChange={changeMode} showModeSwitcher={phase === "capture"} onBack={handleBack} />
    <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 105, 120) }]} keyboardShouldPersistTaps="handled">
      {phase === "capture" ? <Animated.View style={{ opacity: modeOpacity, transform: [{ translateX: modeTranslateX }] }}><CaptureView mode={mode} onCamera={() => void selectImage("camera")} onGallery={() => void selectImage("gallery")} error={error} /></Animated.View> : null}
      {phase === "processing" && image ? <ProcessingView image={image} mode={mode} /> : null}
      {phase === "freshness-result" && image && freshness ? <FreshnessResults result={freshness} image={image} expanded={expandedFreshness} onToggle={toggleFreshness} onScanAgain={() => reset()} /> : null}
      {phase === "ingredients-result" ? <><IngredientResults items={ingredients} provider={ingredientProvider} expandedId={expandedIngredient} adding={adding} onToggle={toggleIngredient} onChange={updateIngredient} onRemove={removeIngredient} onManual={() => setManualOpen(true)} onAdd={() => void addIngredients()} onScanAgain={() => setDialog({ kind: "discard" })} />{error ? <View style={styles.errorBox}><Ionicons name="alert-circle-outline" size={18} color={colors.danger} /><Text style={styles.errorText}>{error}</Text></View> : null}</> : null}
    </ScrollView>
    <ManualIngredientModal visible={manualOpen} onClose={() => setManualOpen(false)} onAdd={(item) => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setIngredients((current) => [...current, item]); setExpandedIngredient(item.id); }} />
    <AppDialog dialog={dialog} onClose={() => setDialog(undefined)} onConfirm={() => { if (dialog?.kind === "discard") { setDialog(undefined); reset("ingredients"); } else { setDialog(undefined); router.push("/ingredients"); } }} />
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  header: { paddingTop: PAGE_TOP_GAP, paddingHorizontal: 16, paddingBottom: 12, gap: 12, backgroundColor: colors.consumerCanvas },
  headerRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 },
  headerHeading: { flex: 1 },
  iconButton: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  historyButton: { backgroundColor: colors.primarySoft },
  segmented: { height: 42, flexDirection: "row", padding: 4, borderRadius: 14, backgroundColor: colors.surfaceMuted },
  segment: { flex: 1, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  segmentActive: { backgroundColor: colors.primaryStrong }, segmentText: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.bold }, segmentTextActive: { color: colors.surface },
  scrollContent: { paddingHorizontal: 16 }, captureContent: { paddingTop: 28, alignItems: "center" },
  heroTitle: { color: colors.text, fontSize: typography.mobile.rawSize.s22, fontWeight: typography.weight.extrabold, textAlign: "center" }, heroBody: { maxWidth: 310, marginTop: 7, color: colors.textMuted, fontSize: typography.mobile.rawSize.s14, lineHeight: 20, textAlign: "center" },
  cameraCard: { width: "100%", minHeight: 285, marginTop: 24, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.primaryBorder, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft, gap: 10 },
  cameraCircle: { width: 66, height: 66, borderRadius: 33, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }, cameraText: { color: colors.primaryStrong, fontSize: typography.mobile.rawSize.s15, fontWeight: typography.weight.extrabold }, cameraHint: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s12 },
  orRow: { width: "100%", marginVertical: 20, flexDirection: "row", alignItems: "center", gap: 12 }, orLine: { flex: 1, height: 1, backgroundColor: colors.border }, orText: { color: colors.textSubtle, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.extrabold },
  secondaryButton: { width: "100%", minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 15, backgroundColor: colors.surface }, secondaryButtonText: { color: colors.text, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.extrabold },
  errorBox: { width: "100%", marginTop: 14, padding: 12, flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 12, backgroundColor: colors.dangerSoft }, errorText: { flex: 1, color: colors.danger, fontSize: typography.mobile.rawSize.s13, lineHeight: 18 },
  processing: { minHeight: 510, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 }, processingImage: { width: 178, height: 178, marginBottom: 25, borderRadius: 24, backgroundColor: colors.surfaceMuted }, processingTitle: { marginTop: 14, color: colors.text, fontSize: typography.mobile.rawSize.s20, fontWeight: typography.weight.extrabold }, processingBody: { marginTop: 8, color: colors.textMuted, fontSize: typography.mobile.rawSize.s13, lineHeight: 19, textAlign: "center" },
  progressTrack: { width: 170, height: 4, marginTop: 20, overflow: "hidden", borderRadius: 4, backgroundColor: colors.border }, progressFill: { width: "68%", height: "100%", borderRadius: 4, backgroundColor: colors.primary },
  resultsContent: { paddingTop: 18, gap: 12 }, resultImage: { width: "100%", height: 190, borderRadius: 20, backgroundColor: colors.surfaceMuted },
  resultsTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, resultsTitle: { color: colors.text, fontSize: typography.mobile.rawSize.s19, fontWeight: typography.weight.extrabold }, resultsSubtitle: { marginTop: 3, color: colors.textMuted, fontSize: typography.mobile.rawSize.s12 },
  aiPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.primarySoft }, aiPillText: { color: colors.primaryStrong, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.extrabold }, countBadge: { minWidth: 31, height: 31, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft }, countBadgeText: { color: colors.primaryStrong, fontWeight: typography.weight.extrabold },
  resultCard: { overflow: "hidden", borderWidth: 1, borderColor: colors.border, borderRadius: 17, backgroundColor: colors.surface }, resultSummary: { minHeight: 74, padding: 11, flexDirection: "row", alignItems: "center", gap: 9 }, foodIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" }, foodEmoji: { fontSize: typography.mobile.rawSize.s23 }, resultHeading: { flex: 1, minWidth: 0 }, resultName: { color: colors.text, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.extrabold }, resultFinding: { marginTop: 3, color: colors.textMuted, fontSize: typography.mobile.rawSize.s11, lineHeight: 15 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10 }, statusText: { fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.black, textTransform: "uppercase" },
  details: { padding: 14, gap: 13, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surfaceMuted }, confidenceRow: { flexDirection: "row", justifyContent: "space-between" }, confidence: { color: colors.text, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.extrabold }, detailSection: { gap: 5 }, detailLabel: { color: colors.text, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.extrabold }, bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 }, bullet: { color: colors.primaryStrong, fontWeight: typography.weight.extrabold }, detailText: { flex: 1, color: colors.textMuted, fontSize: typography.mobile.rawSize.s12, lineHeight: 18 },
  safetyBox: { padding: 12, flexDirection: "row", alignItems: "flex-start", gap: 9, borderRadius: 13 }, safetyCopy: { flex: 1 }, safetyTitle: { color: colors.text, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.extrabold }, safetyNote: { marginTop: 3, color: colors.textMuted, fontSize: typography.mobile.rawSize.s11, lineHeight: 16 }, disclaimer: { padding: 12, flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderColor: colors.warningBorder, borderRadius: 13, backgroundColor: colors.warningSoft }, disclaimerText: { flex: 1, color: colors.warningStrong, fontSize: typography.mobile.rawSize.s11, lineHeight: 16 },
  ingredientCard: { overflow: "hidden", borderWidth: 1, borderColor: colors.primaryBorder, borderRadius: 16, backgroundColor: colors.surface }, ingredientSummary: { minHeight: 70, padding: 11, flexDirection: "row", alignItems: "center", gap: 9 }, ingredientEmojiBox: { width: 45, height: 45, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft }, detectedConfidence: { color: colors.success, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.extrabold },
  editor: { padding: 13, gap: 11, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surfaceMuted }, field: { gap: 6 }, fieldLabel: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.extrabold }, input: { height: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, color: colors.text, backgroundColor: colors.surface, fontSize: typography.mobile.rawSize.s14 }, twoColumns: { flexDirection: "row", gap: 10 }, column: { flex: 1 }, unitChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, unitChip: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.surface }, unitChipActive: { backgroundColor: colors.primarySoft }, unitChipText: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.bold }, unitChipTextActive: { color: colors.primaryStrong }, removeButton: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, removeText: { color: colors.danger, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.bold },
  primaryButton: { width: "100%", minHeight: 52, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 15, backgroundColor: colors.primaryStrong }, primaryButtonText: { color: colors.surface, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.extrabold, textAlign: "center" }, buttonDisabled: { opacity: 0.45 }, scanAgainButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }, scanAgainText: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.bold },
  emptyResult: { minHeight: 125, padding: 18, alignItems: "center", justifyContent: "center", gap: 9, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface }, emptyResultText: { maxWidth: 280, color: colors.textMuted, fontSize: typography.mobile.rawSize.s13, lineHeight: 18, textAlign: "center" },
  modalOverlay: { flex: 1, padding: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.overlay }, dialog: { width: "100%", maxWidth: 380, padding: 22, alignItems: "center", borderRadius: 22, backgroundColor: colors.surface }, dialogIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" }, dialogTitle: { marginTop: 12, color: colors.text, fontSize: typography.mobile.rawSize.s19, fontWeight: typography.weight.extrabold, textAlign: "center" }, dialogBody: { marginTop: 7, color: colors.textMuted, fontSize: typography.mobile.rawSize.s13, lineHeight: 19, textAlign: "center" }, dialogActions: { width: "100%", marginTop: 20, flexDirection: "row", gap: 10 }, dialogSecondary: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 14 }, dialogSecondaryText: { color: colors.text, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.extrabold }, dialogPrimary: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.primaryStrong }, dialogPrimaryFull: { width: "100%", minHeight: 48, marginTop: 20, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.primaryStrong }, dialogPrimaryText: { color: colors.surface, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.extrabold },
  manualSheet: { width: "100%", maxWidth: 430, padding: 20, gap: 13, borderRadius: 24, backgroundColor: colors.surface }, sheetHandle: { alignSelf: "center", width: 42, height: 4, borderRadius: 3, backgroundColor: colors.border }, sheetTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
