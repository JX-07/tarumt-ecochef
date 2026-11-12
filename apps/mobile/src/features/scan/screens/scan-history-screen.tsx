import { Text } from "../../../shared/components/themed-text";
import { colors, typography } from "@ecochef/design-tokens";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Image, LayoutAnimation, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { goBackOrReplace } from "../../../shared/navigation";
import { ingredientEmojiFor } from "../../../shared/ingredient-icons";
import { PAGE_TOP_GAP, PageHeader } from "../../../shared/components/page-header";
import { getScanHistory } from "../history";
import type { FreshnessItem, FreshnessStatus, ScanHistoryEntry } from "../types";

type HistoryMode = "freshness" | "ingredients";

function statusStyle(status: FreshnessStatus) {
  if (status === "fresh") return { label: "Fresh", color: colors.success, background: colors.successSoft };
  if (status === "use_soon") return { label: "Use soon", color: colors.warningStrong, background: colors.warningSoft };
  if (status === "spoiled") return { label: "Spoiled", color: colors.danger, background: colors.dangerSoft };
  return { label: "Unclear", color: colors.textMuted, background: colors.surfaceMuted };
}

function scanDate(date: string) {
  const value = new Date(date);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const time = value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (value.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (value.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return value.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

function FreshnessHistoryItem({ item, imageUri, date, expanded, onToggle }: { item: FreshnessItem; imageUri: string; date: string; expanded: boolean; onToggle: () => void }) {
  const status = statusStyle(item.status);
  return <View style={styles.card}>
    <Pressable onPress={onToggle} style={styles.summary}>
      <Image source={{ uri: imageUri }} style={styles.thumbnail} />
      <View style={styles.heading}><Text style={styles.name}>{item.name}</Text><Text style={styles.date}>{scanDate(date)}</Text></View>
      <View style={[styles.pill, { backgroundColor: status.background }]}><Text style={[styles.pillText, { color: status.color }]}>{status.label}</Text></View>
      <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={19} color={colors.textMuted} />
    </Pressable>
    {expanded ? <View style={styles.details}>
      <View style={styles.detailRow}><Text style={styles.detailLabel}>Confidence</Text><Text style={styles.detailValue}>{Math.round(item.confidence * 100)}% confidence</Text></View>
      <Text style={styles.detailLabel}>Finding</Text><Text style={styles.detailText}>{item.finding}</Text>
      <Text style={styles.detailLabel}>More information</Text><Text style={styles.detailText}>{item.safety_note}</Text>
      {item.prevention.length ? <><Text style={styles.detailLabel}>Prevention</Text><Text style={styles.detailText}>{item.prevention.join(" · ")}</Text></> : null}
    </View> : null}
  </View>;
}

function IngredientHistoryCard({ entry, expanded, onToggle }: { entry: ScanHistoryEntry; expanded: boolean; onToggle: () => void }) {
  const names = entry.ingredientNames ?? [];
  return <View style={styles.card}>
    <Pressable onPress={onToggle} style={styles.summary}>
      <Image source={{ uri: entry.imageUri }} style={styles.thumbnail} />
      <View style={styles.heading}><Text style={styles.name}>{names.length} {names.length === 1 ? "ingredient" : "ingredients"} detected</Text><Text style={styles.date}>{scanDate(entry.createdAt)}</Text></View>
      <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={19} color={colors.textMuted} />
    </Pressable>
    {expanded ? <View style={styles.ingredientList}>{names.map((name, index) => <View key={`${name}-${index}`} style={styles.ingredientRow}><Text style={styles.emoji}>{ingredientEmojiFor(name)}</Text><Text style={styles.ingredientName}>{name}</Text></View>)}</View> : null}
  </View>;
}

export function ScanHistoryScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<HistoryMode>("freshness");
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
  const [expanded, setExpanded] = useState<string>();

  useFocusEffect(useCallback(() => { void getScanHistory().then(setHistory); }, []));

  function toggle(key: string) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((current) => current === key ? undefined : key);
  }

  const freshness = history.filter((entry) => entry.mode === "freshness");
  const ingredients = history.filter((entry) => entry.mode === "ingredients");

  return <View style={[styles.root, { paddingTop: insets.top }]}>
    <View style={styles.header}>
      <View style={styles.headerRow}><Pressable onPress={() => goBackOrReplace("/(tabs)/scan")} style={styles.backButton}><Ionicons name="chevron-back" size={21} color={colors.text} /></Pressable><View style={styles.headerHeading}><PageHeader title="Scan History" /></View></View>
      <View style={styles.segmented}><Pressable onPress={() => { setMode("freshness"); setExpanded(undefined); }} style={[styles.segment, mode === "freshness" && styles.segmentActive]}><Text style={[styles.segmentText, mode === "freshness" && styles.segmentTextActive]}>Freshness</Text></Pressable><Pressable onPress={() => { setMode("ingredients"); setExpanded(undefined); }} style={[styles.segment, mode === "ingredients" && styles.segmentActive]}><Text style={[styles.segmentText, mode === "ingredients" && styles.segmentTextActive]}>Ingredients</Text></Pressable></View>
    </View>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}>
      {mode === "freshness" ? freshness.flatMap((entry) => (entry.freshnessItems ?? []).map((item, itemIndex) => { const key = `${entry.id}-${itemIndex}`; return <FreshnessHistoryItem key={key} item={item} imageUri={entry.imageUri} date={entry.createdAt} expanded={expanded === key} onToggle={() => toggle(key)} />; })) : ingredients.map((entry) => <IngredientHistoryCard key={entry.id} entry={entry} expanded={expanded === entry.id} onToggle={() => toggle(entry.id)} />)}
      {(mode === "freshness" ? freshness.length === 0 : ingredients.length === 0) ? <View style={styles.empty}><View style={styles.emptyIcon}><Ionicons name={mode === "freshness" ? "leaf-outline" : "basket-outline"} size={31} color={colors.primaryStrong} /></View><Text style={styles.emptyTitle}>No {mode} scans yet</Text><Text style={styles.emptyBody}>Your completed scans will appear here for easy reference.</Text><Pressable onPress={() => router.replace("/(tabs)/scan")} style={styles.scanButton}><Text style={styles.scanButtonText}>Start a scan</Text></Pressable></View> : null}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  header: { paddingTop: PAGE_TOP_GAP, paddingHorizontal: 16, paddingBottom: 12, gap: 12, backgroundColor: colors.consumerCanvas },
  headerRow: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 12 },
  headerHeading: { flex: 1 },
  backButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: colors.surface },
  segmented: { height: 42, flexDirection: "row", padding: 4, borderRadius: 14, backgroundColor: colors.surfaceMuted }, segment: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 11 }, segmentActive: { backgroundColor: colors.primaryStrong }, segmentText: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.extrabold }, segmentTextActive: { color: colors.surface },
  content: { padding: 16, gap: 12 }, card: { overflow: "hidden", borderWidth: 1, borderColor: colors.border, borderRadius: 17, backgroundColor: colors.surface }, summary: { minHeight: 74, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 }, thumbnail: { width: 52, height: 52, borderRadius: 14, backgroundColor: colors.surfaceMuted }, heading: { flex: 1 }, name: { color: colors.text, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.extrabold }, date: { marginTop: 4, color: colors.textMuted, fontSize: typography.mobile.rawSize.s11 }, pill: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10 }, pillText: { fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.black, textTransform: "uppercase" },
  details: { padding: 14, gap: 6, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surfaceMuted }, detailRow: { flexDirection: "row", justifyContent: "space-between" }, detailLabel: { marginTop: 3, color: colors.text, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.extrabold }, detailValue: { color: colors.text, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.extrabold }, detailText: { marginBottom: 4, color: colors.textMuted, fontSize: typography.mobile.rawSize.s12, lineHeight: 17 },
  ingredientList: { padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surfaceMuted }, ingredientRow: { minHeight: 39, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 11, backgroundColor: colors.surface }, emoji: { fontSize: typography.mobile.rawSize.s20 }, ingredientName: { color: colors.text, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.bold },
  empty: { minHeight: 390, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 }, emptyIcon: { width: 70, height: 70, borderRadius: 35, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft }, emptyTitle: { marginTop: 15, color: colors.text, fontSize: typography.mobile.rawSize.s18, fontWeight: typography.weight.extrabold }, emptyBody: { marginTop: 6, color: colors.textMuted, fontSize: typography.mobile.rawSize.s13, lineHeight: 19, textAlign: "center" }, scanButton: { minHeight: 46, marginTop: 18, paddingHorizontal: 25, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.primaryStrong }, scanButtonText: { color: colors.surface, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.extrabold },
});
