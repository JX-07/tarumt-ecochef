import { ActivityIndicator, StyleSheet, View } from "react-native";
import { colors } from "@ecochef/design-tokens";
export function AppLoadingScreen() {
  return (
    <View style={styles.root}>
      <ActivityIndicator color={colors.primaryStrong} size="large" />
    </View>
  );
}
const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.consumerCanvas,
  },
});
