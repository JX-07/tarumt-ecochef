import { apiBaseUrl } from "../../../lib/api-url";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useBottomSheetSlide } from "../../../shared/hooks/use-bottom-sheet-slide";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import type { MarketplaceProductReviewList } from "@ecochef/contracts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { createMobileApi } from "../../../lib/api";
import { useAuth } from "../../auth/auth-provider";

export function ProductReviewForm({
  productId,
  productName,
  onClose,
  onSaved,
}: {
  productId?: string;
  productName?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [data, setData] = useState<MarketplaceProductReviewList>();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!productId) return;
    let active = true;
    setLoading(true);
    setData(undefined);
    setError(undefined);
    setRating(0);
    setComment("");
    api
      .getMarketplaceProductReviews<MarketplaceProductReviewList>(productId)
      .then((result) => {
        if (!active) return;
        setData(result);
        setRating(result.my_review?.rating ?? 0);
        setComment(result.my_review?.comment ?? "");
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "Reviews could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, productId]);
  const save = async () => {
    if (!productId || !rating || !data?.can_review || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await api.submitMarketplaceProductReview<MarketplaceProductReviewList>(productId, {
        rating,
        comment: comment.trim() || undefined,
      });
      onSaved?.();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your rating could not be saved.");
    } finally {
      setSaving(false);
    }
  };
  const sheetMotion = useBottomSheetSlide(Boolean(productId));
  return (
    <Modal
      visible={!!productId}
      transparent
      presentationStyle="overFullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={() => {
        if (!saving) onClose();
      }}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable
          accessibilityLabel="Dismiss rating popup"
          disabled={saving}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing[5]) },
            sheetMotion,
          ]}
          accessibilityViewIsModal
        >
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <Text style={styles.title}>
                {data?.my_review ? "Edit your product rating" : "Rate your purchased item"}
              </Text>
              <Pressable disabled={saving} accessibilityLabel="Close rating" onPress={onClose}>
                <Ionicons name="close" size={spacing[6]} color={colors.text} />
              </Pressable>
            </View>
            <Text style={styles.name}>{productName}</Text>
            {loading ? (
              <ActivityIndicator color={colors.primary} />
            ) : data?.can_review ? (
              <>
                <View style={styles.stars}>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <Pressable
                      key={value}
                      disabled={saving}
                      accessibilityRole="radio"
                      accessibilityLabel={`${value} star${value === 1 ? "" : "s"}`}
                      accessibilityState={{ selected: rating === value }}
                      onPress={() => setRating(value)}
                    >
                      <Ionicons
                        name={value <= rating ? "star" : "star-outline"}
                        size={spacing[8]}
                        color={colors.ratingStar}
                      />
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.help}>Description (optional)</Text>
                <TextInput
                  accessibilityLabel="Product feedback"
                  multiline
                  maxLength={2000}
                  editable={!saving}
                  value={comment}
                  onChangeText={setComment}
                  placeholder="What did you think of this item? (optional)"
                  placeholderTextColor={colors.textSubtle}
                  style={styles.input}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={!rating || saving}
                  onPress={() => void save()}
                  style={[styles.button, (!rating || saving) && styles.disabled]}
                >
                  {saving ? (
                    <ActivityIndicator color={colors.surface} />
                  ) : (
                    <Text style={styles.buttonText}>Save product rating</Text>
                  )}
                </Pressable>
              </>
            ) : data ? (
              <Text style={styles.help}>
                {data.review_eligibility_reason ??
                  "Only customers whose paid order for this exact item is completed can rate it."}
              </Text>
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  sheet: {
    maxHeight: "85%",
    padding: spacing[5],
    borderTopLeftRadius: spacing[6],
    borderTopRightRadius: spacing[6],
    backgroundColor: colors.surface,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: typography.mobile.size.bodyTextHeavy,
    fontWeight: typography.weight.bold,
  },
  name: {
    marginTop: spacing[3],
    color: colors.text,
    fontSize: typography.mobile.size.secondaryTextHeavy,
    fontWeight: typography.weight.semibold,
  },
  help: {
    marginTop: spacing[3],
    color: colors.textMuted,
    fontSize: typography.mobile.size.secondaryInteraction,
    lineHeight: spacing[5],
  },
  stars: { flexDirection: "row", gap: spacing[3], marginVertical: spacing[5] },
  input: {
    minHeight: spacing[16] * 2,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[3],
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    fontSize: typography.mobile.size.bodyInteraction,
    textAlignVertical: "top",
  },
  button: {
    padding: spacing[4],
    marginTop: spacing[4],
    borderRadius: spacing[3],
    alignItems: "center",
    backgroundColor: colors.primaryStrong,
  },
  buttonText: {
    color: colors.surface,
    fontSize: typography.mobile.size.bodyInteraction,
    fontWeight: typography.weight.bold,
  },
  disabled: { opacity: 0.5 },
  error: {
    marginTop: spacing[3],
    color: colors.danger,
    fontSize: typography.mobile.size.secondaryInteraction,
  },
});
