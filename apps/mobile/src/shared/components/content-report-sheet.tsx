import { apiBaseUrl } from "../../lib/api-url";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useBottomSheetSlide } from "../hooks/use-bottom-sheet-slide";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../features/auth/auth-provider";
import { createMobileApi } from "../../lib/api";
import { Text, TextInput } from "./themed-text";

type ReportSubject = "recipe" | "store";
type ReportCategory = { id: string; label: string; description: string };
type ReportCategories = { categories: ReportCategory[] };
type ReportableProduct = {
  id: string;
  name: string;
  category?: string | null;
  subcategory?: string | null;
};

type ReportReceipt = { id: string; status: string };

type ContentReportSheetProps = {
  visible: boolean;
  onClose: () => void;
  subjectType: ReportSubject;
  subjectId: string;
  subjectName: string;
};

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process;

/** Reporting does not require a purchase or a cooking action. */
export function ContentReportSheet({
  visible,
  onClose,
  subjectType,
  subjectId,
  subjectName,
}: ContentReportSheetProps) {
  const insets = useSafeAreaInsets();
  const sheetMotion = useBottomSheetSlide(visible);
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [categories, setCategories] = useState<ReportCategory[]>([]);
  const [category, setCategory] = useState<string>();
  const [products, setProducts] = useState<ReportableProduct[]>([]);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productId, setProductId] = useState<string>();
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string>();
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [receipt, setReceipt] = useState<ReportReceipt>();
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const submitInProgress = useRef(false);

  useEffect(() => {
    if (!visible) return;
    const current = ++generation.current;
    setCategory(undefined);
    setProductPickerOpen(false);
    setProductId(undefined);
    setProducts([]);
    setProductsError(undefined);
    setDescription("");
    setReceipt(undefined);
    setError(undefined);
    setCategories([]);
    setLoading(true);
    setSubmitting(false);
    submitInProgress.current = false;
    api
      .getReportCategories<ReportCategories>()
      .then((result: ReportCategories) => {
        if (generation.current !== current) return;
        setCategories(result.categories);
        if (!result.categories.length)
          setError("Reporting is temporarily unavailable. Please try again later.");
      })
      .catch((reason: unknown) => {
        if (generation.current === current)
          setError(
            reason instanceof Error ? reason.message : "Report categories could not be loaded.",
          );
      })
      .finally(() => {
        if (generation.current === current) setLoading(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [api, visible, subjectType, subjectId, retry]);

  const categorySelected = !!category;
  useEffect(() => {
    if (!visible || !categorySelected || subjectType !== "store") return;
    let active = true;
    setProductsLoading(true);
    setProductsError(undefined);
    api
      .getReportableProducts<{ products: ReportableProduct[] }>(subjectId)
      .then((result) => {
        if (active) setProducts(result.products);
      })
      .catch(() => {
        if (active)
          setProductsError(
            "Listings could not be loaded. You can still report the shop without selecting an item.",
          );
      })
      .finally(() => {
        if (active) setProductsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, visible, categorySelected, subjectType, subjectId]);

  const productGroups = useMemo(() => {
    const groups = new Map<string, ReportableProduct[]>();
    for (const product of products) {
      const tag = product.subcategory?.trim() || product.category?.trim() || "Other products";
      groups.set(tag, [...(groups.get(tag) ?? []), product]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [products]);
  const selectedProduct = products.find((product) => product.id === productId);
  const selectProduct = (id?: string) => {
    setProductId(id);
    setProductPickerOpen(false);
  };

  const trimmedDescription = description.trim();
  const valid = !!category && trimmedDescription.length >= 10 && trimmedDescription.length <= 2000;
  const close = () => {
    if (!submitInProgress.current) onClose();
  };
  const submit = async () => {
    if (!valid || loading || submitInProgress.current) return;
    const current = generation.current;
    submitInProgress.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await api.submitContentReport<ReportReceipt>({
        subject_type: subjectType,
        subject_id: subjectId,
        category: category as string,
        description: trimmedDescription,
        ...(subjectType === "store" && productId ? { product_id: productId } : {}),
      });
      if (generation.current === current) setReceipt(result);
    } catch (reason) {
      if (generation.current === current)
        setError(
          reason instanceof Error
            ? reason.message
            : "Your report could not be submitted. Please try again.",
        );
    } finally {
      if (generation.current === current) {
        submitInProgress.current = false;
        setSubmitting(false);
      }
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          accessibilityLabel="Close report"
          disabled={submitting}
          style={StyleSheet.absoluteFill}
          onPress={close}
        />
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing[4]) },
            sheetMotion,
          ]}
          accessibilityViewIsModal
        >
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              {receipt ? "Report received" : `Report this ${subjectType}`}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close report"
              disabled={submitting}
              hitSlop={spacing[2]}
              onPress={close}
              style={styles.close}
            >
              <Ionicons name="close" size={spacing[6]} color={colors.textMuted} />
            </Pressable>
          </View>
          {receipt ? (
            <View style={styles.success}>
              <Ionicons name="checkmark-circle-outline" size={spacing[12]} color={colors.success} />
              <Text style={styles.successTitle}>Thank you for reporting this {subjectType}.</Text>
              <Text style={styles.copy}>
                A moderator will review your report. You will be notified when a decision is made.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onClose();
                  router.push("/reports" as never);
                }}
                style={styles.submit}
              >
                <Text style={styles.submitText}>View your reports</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
              <Text style={styles.subject} numberOfLines={3}>
                {subjectName}
              </Text>
              <Text style={styles.copy}>
                You can report a {subjectType} without{" "}
                {subjectType === "store" ? "buying anything from it" : "cooking or scheduling it"}.
                Choose the reason that best describes the issue.
              </Text>
              {loading ? (
                <View style={styles.status}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.copy}>Loading report categories…</Text>
                </View>
              ) : (
                <View
                  accessibilityRole="radiogroup"
                  accessibilityLabel="Report category"
                  style={styles.categories}
                >
                  {categories.map((item) => (
                    <Pressable
                      key={item.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: category === item.id, disabled: submitting }}
                      disabled={submitting}
                      onPress={() => setCategory(item.id)}
                      style={[styles.category, category === item.id && styles.categorySelected]}
                    >
                      <Ionicons
                        name={category === item.id ? "radio-button-on" : "radio-button-off"}
                        size={spacing[6]}
                        color={category === item.id ? colors.primaryStrong : colors.textSubtle}
                      />
                      <View style={styles.categoryCopy}>
                        <Text style={styles.categoryTitle}>{item.label}</Text>
                        <Text style={styles.categoryDescription}>{item.description}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
              {category && subjectType === "store" ? (
                <View style={styles.categories}>
                  <Text style={styles.label}>
                    Select Relevant Product <Text style={styles.help}>(Optional)</Text>
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Select relevant product, ${selectedProduct?.name ?? "none selected"}`}
                    accessibilityState={{
                      expanded: productPickerOpen,
                      disabled: submitting || productsLoading,
                    }}
                    disabled={submitting || productsLoading}
                    onPress={() => setProductPickerOpen((open) => !open)}
                    style={styles.productDropdown}
                  >
                    <Text style={[styles.categoryTitle, styles.categoryCopy]}>
                      {productsLoading
                        ? "Loading products…"
                        : (selectedProduct?.name ?? "Select a product")}
                    </Text>
                    <Ionicons
                      name={productPickerOpen ? "chevron-up" : "chevron-down"}
                      size={spacing[5]}
                      color={colors.textMuted}
                    />
                  </Pressable>
                  {productPickerOpen ? (
                    <ScrollView
                      nestedScrollEnabled
                      keyboardShouldPersistTaps="handled"
                      style={styles.productOptions}
                    >
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ selected: !productId }}
                        disabled={submitting}
                        onPress={() => selectProduct()}
                        style={[styles.productOption, !productId && styles.categorySelected]}
                      >
                        <Text style={styles.copy}>No specific product</Text>
                        {!productId ? (
                          <Ionicons
                            name="checkmark"
                            size={spacing[5]}
                            color={colors.primaryStrong}
                          />
                        ) : null}
                      </Pressable>
                      {productGroups.map(([tag, items]) => (
                        <View key={tag}>
                          <Text accessibilityRole="header" style={styles.productGroup}>
                            {tag}
                          </Text>
                          {items.map((item) => (
                            <Pressable
                              key={item.id}
                              accessibilityRole="radio"
                              accessibilityState={{ selected: productId === item.id }}
                              disabled={submitting}
                              onPress={() => selectProduct(item.id)}
                              style={[
                                styles.productOption,
                                productId === item.id && styles.categorySelected,
                              ]}
                            >
                              <Text style={styles.categoryTitle}>{item.name}</Text>
                              {productId === item.id ? (
                                <Ionicons
                                  name="checkmark"
                                  size={spacing[5]}
                                  color={colors.primaryStrong}
                                />
                              ) : null}
                            </Pressable>
                          ))}
                        </View>
                      ))}
                    </ScrollView>
                  ) : null}
                  {productsError ? (
                    <Text style={styles.copy}>{productsError}</Text>
                  ) : !productsLoading && !products.length ? (
                    <Text style={styles.copy}>This shop has no active listings to select.</Text>
                  ) : null}
                </View>
              ) : null}
              {!loading && categories.length ? (
                <>
                  <Text style={styles.label}>Tell us what happened</Text>
                  <TextInput
                    accessibilityLabel="Report description"
                    editable={!submitting}
                    multiline
                    maxLength={2000}
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Describe the issue so a moderator can investigate it."
                    placeholderTextColor={colors.textSubtle}
                    textAlignVertical="top"
                    style={styles.input}
                  />
                  <View style={styles.helpRow}>
                    <Text style={styles.help}>At least 10 characters</Text>
                    <Text style={styles.help}>{description.length}/2000</Text>
                  </View>
                </>
              ) : null}
              {error ? (
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  style={styles.error}
                >
                  {error}
                </Text>
              ) : null}
              {!loading && !categories.length ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setRetry((value) => value + 1)}
                  style={styles.retry}
                >
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !valid || loading || submitting, busy: submitting }}
                disabled={!valid || loading || submitting}
                onPress={() => void submit()}
                style={[styles.submit, (!valid || loading || submitting) && styles.disabled]}
              >
                {submitting ? (
                  <ActivityIndicator color={colors.surface} />
                ) : (
                  <Text style={styles.submitText}>Submit report</Text>
                )}
              </Pressable>
              <Text style={styles.note}>
                Reports about the same issue are reviewed together. Please include specific details
                that help explain your experience.
              </Text>
            </ScrollView>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  sheet: {
    maxHeight: "90%",
    borderTopLeftRadius: spacing[6],
    borderTopRightRadius: spacing[6],
    backgroundColor: colors.surface,
    paddingTop: spacing[5],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[4],
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: typography.mobile.size.bodyTextHeavy,
    fontWeight: typography.weight.bold,
  },
  close: { padding: spacing[2], borderRadius: spacing[6], backgroundColor: colors.surfaceMuted },
  content: { paddingHorizontal: spacing[5], paddingBottom: spacing[4], gap: spacing[3] },
  subject: {
    color: colors.text,
    fontSize: typography.mobile.size.secondaryTextHeavy,
    fontWeight: typography.weight.semibold,
  },
  copy: {
    color: colors.textMuted,
    fontSize: typography.mobile.size.secondaryInteraction,
    lineHeight: typography.mobile.size.secondaryInteraction * typography.lineHeight.body,
  },
  status: { padding: spacing[6], alignItems: "center", gap: spacing[3] },
  productDropdown: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[3],
    backgroundColor: colors.surface,
  },
  productOptions: {
    maxHeight: spacing[16] * 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[3],
    backgroundColor: colors.surface,
  },
  productOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
  },
  productGroup: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    color: colors.textMuted,
    fontSize: typography.mobile.size.caption,
    fontWeight: typography.weight.bold,
    backgroundColor: colors.surfaceMuted,
  },
  categories: { gap: spacing[2] },
  category: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[3],
    backgroundColor: colors.surface,
  },
  categorySelected: { borderColor: colors.primaryStrong, backgroundColor: colors.primarySoft },
  categoryCopy: { flex: 1, gap: spacing[1] },
  categoryTitle: {
    color: colors.text,
    fontSize: typography.mobile.size.secondaryInteraction,
    fontWeight: typography.weight.semibold,
  },
  categoryDescription: {
    color: colors.textMuted,
    fontSize: typography.mobile.size.caption,
    lineHeight: typography.mobile.size.caption * typography.lineHeight.body,
  },
  label: {
    color: colors.text,
    fontSize: typography.mobile.size.secondaryInteraction,
    fontWeight: typography.weight.semibold,
    marginTop: spacing[1],
  },
  input: {
    minHeight: spacing[16] * 2,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing[3],
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
    fontSize: typography.mobile.size.bodyInteraction,
    lineHeight: typography.mobile.size.bodyInteraction * typography.lineHeight.body,
  },
  helpRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing[3] },
  help: { color: colors.textMuted, fontSize: typography.mobile.size.caption },
  error: {
    padding: spacing[3],
    borderRadius: spacing[3],
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
    fontSize: typography.mobile.size.secondaryInteraction,
  },
  retry: {
    padding: spacing[3],
    alignItems: "center",
    borderRadius: spacing[3],
    backgroundColor: colors.surfaceMuted,
  },
  retryText: {
    color: colors.primaryStrong,
    fontSize: typography.mobile.size.secondaryInteraction,
    fontWeight: typography.weight.semibold,
  },
  submit: {
    width: "100%",
    minHeight: spacing[12],
    alignItems: "center",
    justifyContent: "center",
    padding: spacing[3],
    borderRadius: spacing[3],
    backgroundColor: colors.primaryStrong,
  },
  submitText: {
    color: colors.surface,
    fontSize: typography.mobile.size.bodyInteraction,
    fontWeight: typography.weight.bold,
  },
  disabled: { opacity: 0.5 },
  note: {
    color: colors.textMuted,
    fontSize: typography.mobile.size.caption,
    lineHeight: typography.mobile.size.caption * typography.lineHeight.body,
  },
  success: { padding: spacing[5], alignItems: "center", gap: spacing[4] },
  successTitle: {
    color: colors.text,
    fontSize: typography.mobile.size.bodyTextHeavy,
    fontWeight: typography.weight.semibold,
    textAlign: "center",
  },
});
