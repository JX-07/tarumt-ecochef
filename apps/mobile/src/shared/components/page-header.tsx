import { Text } from "./themed-text";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { colors, typography } from "@ecochef/design-tokens";

export const PAGE_TOP_GAP = 30;

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return <View style={styles.row}><Text style={styles.title}>{title}</Text>{action ? <View style={styles.action}>{action}</View> : null}</View>;
}

const styles = StyleSheet.create({
  row: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.text, fontSize: typography.mobile.size.pageTitle, lineHeight: 38, fontWeight: typography.weight.bold, letterSpacing: -0.45 },
  action: { alignItems: "center", justifyContent: "center" },
});
