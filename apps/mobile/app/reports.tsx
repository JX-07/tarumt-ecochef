import { apiBaseUrl } from "../src/lib/api-url";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../src/features/auth/auth-provider";
import { createMobileApi } from "../src/lib/api";
import { Text } from "../src/shared/components/themed-text";
import { PAGE_TOP_GAP } from "../src/shared/components/page-header";

type Report = {
  id: string;
  product_name?: string;
  subject_name: string;
  subject_type: "recipe" | "store";
  category: string;
  description: string;
  status: string;
  created_at: string;
  resolution_note?: string;
  resolved_at?: string;
};
const label = (value: string) => value.replaceAll("_", " ");

export default function ReportsScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setError(undefined);
      api
        .getMyReports<{ reports: Report[] }>()
        .then((result) => {
          if (active) setReports(result.reports);
        })
        .catch((reason) => {
          if (active)
            setError(
              reason instanceof Error ? reason.message : "Your reports could not be loaded.",
            );
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [api]),
  );
  const refresh = async () => {
    setLoading(true);
    setError(undefined);
    try {
      setReports((await api.getMyReports<{ reports: Report[] }>()).reports);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your reports could not be loaded.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <View style={styles.root}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void refresh()}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + PAGE_TOP_GAP, paddingBottom: insets.bottom + spacing[8] },
        ]}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to purchase history"
            style={styles.back}
            onPress={() =>
              router.canGoBack()
                ? router.back()
                : router.replace("/account?section=purchases" as never)
            }
          >
            <Ionicons name="chevron-back" size={22} color={colors.textMuted} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Report & Outcome</Text>
            <Text style={styles.subtitle}>Follow the reports you have submitted</Text>
          </View>
        </View>
        {error ? (
          <Pressable accessibilityRole="button" onPress={() => void refresh()}>
            <Text style={styles.error}>{error} Tap to retry.</Text>
          </Pressable>
        ) : null}
        {loading && !reports.length ? (
          <ActivityIndicator color={colors.primary} />
        ) : !reports.length && !error ? (
          <Text style={styles.copy}>You have not submitted any reports yet.</Text>
        ) : (
          reports.map((report) => (
            <View key={report.id} style={styles.card}>
              <View style={styles.categoryRow}>
                <View style={styles.subjectType}>
                  <Ionicons
                    name={
                      report.subject_type === "store" ? "storefront-outline" : "restaurant-outline"
                    }
                    size={16}
                    color={colors.primaryStrong}
                  />
                  <Text style={styles.subjectLabel}>
                    {report.subject_type === "store" ? "Shop" : "Recipe"}
                  </Text>
                </View>
                <View style={styles.categoryBadge}>
                  <Text style={styles.categoryText}>{label(report.category)}</Text>
                </View>
              </View>
              <Text style={styles.name}>{report.subject_name}</Text>
              <Text style={styles.status}>
                {report.status === "pending"
                  ? "Awaiting moderator review"
                  : report.status === "upheld"
                    ? "Report confirmed"
                    : "Report dismissed"}
              </Text>
              {report.product_name ? (
                <Text style={styles.name}>Listing: {report.product_name}</Text>
              ) : null}
              <Text style={styles.copy}>{report.description}</Text>
              <Text style={styles.caption}>
                Submitted{" "}
                {new Date(report.created_at).toLocaleString("en-MY", {
                  timeZone: "Asia/Kuala_Lumpur",
                })}
              </Text>
              {report.resolution_note ? (
                <View style={styles.outcome}>
                  <Text style={styles.name}>Moderator’s explanation</Text>
                  <Text style={styles.copy}>{report.resolution_note}</Text>
                  {report.resolved_at ? (
                    <Text style={styles.caption}>
                      Replied{" "}
                      {new Date(report.resolved_at).toLocaleString("en-MY", {
                        timeZone: "Asia/Kuala_Lumpur",
                      })}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  content: { padding: spacing[5], gap: spacing[4] },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 },
  back: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
  },
  headerCopy: { flex: 1 },
  title: {
    fontSize: typography.mobile.rawSize.s21,
    fontWeight: typography.weight.bold,
    color: colors.text,
  },
  subtitle: { marginTop: 1, color: colors.textMuted, fontSize: typography.mobile.rawSize.s11 },
  copy: {
    fontSize: typography.mobile.size.bodyInteraction,
    color: colors.textMuted,
    lineHeight: typography.mobile.size.bodyInteraction * typography.lineHeight.body,
  },
  card: {
    padding: spacing[4],
    gap: spacing[3],
    borderRadius: spacing[4],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing[2] },
  subjectType: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  subjectLabel: {
    fontSize: typography.mobile.size.caption,
    fontWeight: typography.weight.semibold,
    color: colors.text,
  },
  categoryBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: spacing[2],
    backgroundColor: colors.warningSoft,
  },
  categoryText: {
    fontSize: typography.mobile.size.caption,
    fontWeight: typography.weight.semibold,
    color: colors.warningStrong,
    textTransform: "capitalize",
  },
  name: {
    fontSize: typography.mobile.size.secondaryTextHeavy,
    fontWeight: typography.weight.semibold,
    color: colors.text,
  },
  caption: { fontSize: typography.mobile.size.caption, color: colors.textMuted },
  status: {
    fontSize: typography.mobile.size.secondaryInteraction,
    fontWeight: typography.weight.bold,
    color: colors.primaryStrong,
  },
  outcome: {
    padding: spacing[3],
    gap: spacing[2],
    backgroundColor: colors.primarySoft,
    borderRadius: spacing[2],
  },
  error: { color: colors.danger, fontSize: typography.mobile.size.bodyInteraction },
});
