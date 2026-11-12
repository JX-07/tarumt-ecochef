import { Text } from "../../shared/components/themed-text";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PAGE_TOP_GAP, PageHeader } from "../../shared/components/page-header";

function Placeholder({ title, body }: { title: string; body: string }) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.root, { paddingTop: insets.top + PAGE_TOP_GAP }]}>
    <PageHeader title={title} />
    <Text style={styles.body}>{body}</Text>
    <Text style={styles.offline}>Offline-ready shell: feature data will appear here when its module is available.</Text>
  </View>;
}

export const HomeScreen = () => <Placeholder title="Welcome to EcoChef" body="Your kitchen, recipes, and food-waste insights will appear here." />;
export const InventoryPlaceholder = () => <Placeholder title="Inventory" body="Ingredient inventory is coming next." />;
export const RecipesPlaceholder = () => <Placeholder title="Recipes" body="Browse and save recipes once the catalogue is ready." />;
export const ScanPlaceholder = () => <Placeholder title="Scan" body="Scan a food image to identify ingredients and reduce waste." />;
export const PlanPlaceholder = () => <Placeholder title="Plan" body="Plan meals and organise upcoming cooking activities." />;

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16, paddingBottom: 112, gap: spacing[3], backgroundColor: colors.consumerCanvas },
  body: { color: colors.textMuted, fontSize: typography.mobile.size.bodyTextHeavy },
  offline: { marginTop: spacing[4], color: colors.success, fontSize: typography.mobile.size.secondaryInteraction },
});
