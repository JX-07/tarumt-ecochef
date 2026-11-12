import { apiBaseUrl } from "../../../lib/api-url";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { colors, palette, typography } from "@ecochef/design-tokens";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Alert,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomSheetSlide } from "../../../shared/hooks/use-bottom-sheet-slide";

import { useAuth } from "../../auth/auth-provider";
import { createMobileApi } from "../../../lib/api";
import { PAGE_TOP_GAP } from "../../../shared/components/page-header";
import { goBackOrReplace } from "../../../shared/navigation";
import {
  ingredientEmojiFor,
  selectableIngredientIcons,
} from "../../../shared/ingredient-icons";
import { requestShoppingReturn } from "../../meal-planning/shopping-return";

const GREEN = palette.c16a957;
const runtimeProcess = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process;


type InventoryItemSource = "manual" | "scanned" | "shopping";
type InventoryItemInput = {
  name: string;
  quantity: string;
  expiry_date: string;
  category?: string;
  source: InventoryItemSource;
  icon?: string;
};
type InventoryItem = InventoryItemInput & { id: string; date_recorded: string };
type InventoryList = {
  items: InventoryItem[];
  total: number;
  expiring_soon: number;
};

const selectableIcons = selectableIngredientIcons;
const quantityUnits = [
  "pcs",
  "g",
  "kg",
  "ml",
  "L",
  "bunch",
  "head",
  "slices",
  "packs",
  "Custom",
];

const unitRules: Array<{ terms: string[]; unit: string }> = [
  { terms: ["milk", "juice", "water", "oil", "sauce"], unit: "ml" },
  {
    terms: ["rice", "flour", "sugar", "salt", "meat", "chicken", "fish"],
    unit: "g",
  },
  { terms: ["spinach", "kale", "herb", "cilantro", "parsley"], unit: "bunch" },
  { terms: ["bread"], unit: "slices" },
];

function daysUntil(date: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(date);
  expiry.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000);
}

function expiryDateFromDays(days: number) {
  const result = new Date();
  result.setHours(12, 0, 0, 0);
  result.setDate(result.getDate() + days);
  return result.toISOString();
}

function itemEmoji(name: string) {
  return ingredientEmojiFor(name);
}

function defaultUnitForName(name: string) {
  const lower = name.toLowerCase();
  return (
    unitRules.find(({ terms }) => terms.some((term) => lower.includes(term)))
      ?.unit ?? "pcs"
  );
}

function splitQuantity(quantity: string) {
  const match = quantity.trim().match(/^(.+?)\s+([^\s]+)$/);
  return match
    ? { amount: match[1], unit: match[2] }
    : { amount: quantity, unit: "pcs" };
}

function expiryDateFromText(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const result = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12,
    0,
    0,
    0,
  );
  if (
    result.getFullYear() !== Number(match[1]) ||
    result.getMonth() !== Number(match[2]) - 1 ||
    result.getDate() !== Number(match[3])
  )
    return undefined;
  return result;
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function InventoryScreen() {
  const { returnTo, date: returnDate } = useLocalSearchParams<{ returnTo?: string; date?: string }>();
  const { user } = useAuth();
  const navigation = useNavigation();
  const listRef = useRef<FlatList<InventoryItem>>(null);
  const hasLoadedInventory = useRef(false);
  const insets = useSafeAreaInsets();
  const api = useMemo(
    () => createMobileApi(apiBaseUrl, () => user?.getIdToken()),
    [user],
  );
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem>();
  const [pendingDelete, setPendingDelete] = useState<InventoryItem>();
  const [deleting, setDeleting] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const returningToShopping = useRef(false);
  const allowShoppingReturn = useRef(returnTo === "shopping");

  useEffect(() => {
    allowShoppingReturn.current = returnTo === "shopping";
    returningToShopping.current = false;
  }, [returnTo, returnDate]);

  const leaveInventory = () => {
    if (returnTo === "shopping" && allowShoppingReturn.current) {
      returningToShopping.current = true;
      requestShoppingReturn(returnDate);
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/plan");
      return;
    }
    goBackOrReplace("/(tabs)");
  };

  useEffect(() => (navigation as unknown as { addListener: (name: "beforeRemove", listener: (event: { preventDefault: () => void }) => void) => () => void }).addListener("beforeRemove", (event) => {
    if (returnTo !== "shopping" || !allowShoppingReturn.current || returningToShopping.current) return;
    event.preventDefault();
    leaveInventory();
  }), [navigation, returnTo, returnDate]);
  useEffect(() => navigation.addListener("blur", () => {
    if (!returningToShopping.current) allowShoppingReturn.current = false;
  }), [navigation]);
  useFocusEffect(useCallback(() => {
    if (returnTo !== "shopping") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      leaveInventory();
      return true;
    });
    return () => subscription.remove();
  }, [returnTo, returnDate]));

  async function loadInventory(refresh = false) {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(undefined);
    try {
      const result = await api.getMyInventory<InventoryList>();
      setItems(result.items);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Your ingredient list could not be loaded.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      void loadInventory(hasLoadedInventory.current);
      hasLoadedInventory.current = true;
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }, [api]),
  );

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? items.filter((item) => item.name.toLowerCase().includes(normalized))
      : items;
  }, [items, query]);
  const expiringSoon = items.filter((item) => {
    const days = daysUntil(item.expiry_date);
    return days >= 0 && days <= 3;
  }).length;
  const expiredItems = items.filter((item) => daysUntil(item.expiry_date) < 0);

  function openAdd() {
    setEditingItem(undefined);
    setEditorOpen(true);
  }

  function openEdit(item: InventoryItem) {
    setEditingItem(item);
    setEditorOpen(true);
  }

  function confirmDelete(item: InventoryItem) {
    setPendingDelete(item);
  }

  async function removePendingItem() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.removeInventoryItem(pendingDelete.id);
      setItems((current) =>
        current.filter((candidate) => candidate.id !== pendingDelete.id),
      );
      setPendingDelete(undefined);
    } catch (nextError) {
      Alert.alert(
        "Could not remove ingredient",
        nextError instanceof Error ? nextError.message : "Please try again.",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function removeAllExpiredItems() {
    if (!expiredItems.length) return;
    setBulkDeleting(true);
    const expiredIds = expiredItems.map((item) => item.id);
    try {
      const results = await Promise.allSettled(
        expiredIds.map((itemId) => api.removeInventoryItem(itemId)),
      );
      const removedIds = new Set(
        expiredIds.filter((_, index) => results[index]?.status === "fulfilled"),
      );
      setItems((current) => current.filter((item) => !removedIds.has(item.id)));
      setBulkDeleteOpen(false);

      const failedCount = results.length - removedIds.size;
      if (failedCount) {
        Alert.alert(
          "Some ingredients could not be removed",
          `${removedIds.size} expired ${removedIds.size === 1 ? "item was" : "items were"} removed, but ${failedCount} could not be removed. Please try again.`,
        );
      } else {
        Alert.alert(
          "Expired ingredients removed",
          `${removedIds.size} expired ${removedIds.size === 1 ? "item has" : "items have"} been removed from your ingredient list.`,
        );
      }
    } finally {
      setBulkDeleting(false);
    }
  }

  async function saveItem(input: InventoryItemInput) {
    const saved = editingItem
      ? await api.updateInventoryItem<InventoryItem>(editingItem.id, input)
      : await api.addInventoryItem<InventoryItem>(input);
    setItems((current) => {
      const withoutSaved = current.filter((item) => item.id !== saved.id && item.id !== editingItem?.id);
      return [...withoutSaved, saved].sort((a, b) =>
        a.expiry_date.localeCompare(b.expiry_date),
      );
    });
    setEditorOpen(false);
  }

  const header = (
    <>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Go back"
          style={styles.roundButton}
          onPress={leaveInventory}
        >
          <Ionicons name="chevron-back" size={20} color={palette.c687586} />
        </Pressable>
        <Text style={styles.title}>Ingredient List</Text>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="Scan ingredients"
            style={[styles.roundButton, styles.cameraButton]}
            onPress={() => router.push("/(tabs)/scan")}
          >
            <Ionicons name="camera-outline" size={19} color={GREEN} />
          </Pressable>
          <Pressable
            accessibilityLabel="Add ingredient"
            style={[styles.roundButton, styles.addButton]}
            onPress={openAdd}
          >
            <Ionicons name="add" size={24} color={palette.cffffff} />
          </Pressable>
        </View>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={18} color={palette.c9aa6b6} />
        <TextInput
          accessibilityLabel="Search ingredients"
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search ingredients..."
          placeholderTextColor={palette.ca4adba}
          returnKeyType="search"
        />
        {!!query && (
          <Pressable
            accessibilityLabel="Clear search"
            onPress={() => setQuery("")}
          >
            <Ionicons name="close-circle" size={18} color={palette.ca4adba} />
          </Pressable>
        )}
      </View>

      <View style={styles.divider} />
      <View style={styles.summaryRow}>
        <SummaryCard
          icon="cube-outline"
          label="Total"
          value={`${items.length} ${items.length === 1 ? "item" : "items"}`}
        />
        <SummaryCard
          warning
          icon="warning-outline"
          label="Expiring Soon"
          value={`${expiringSoon} ${expiringSoon === 1 ? "item" : "items"}`}
        />
      </View>
      <Pressable
        accessibilityLabel={`Remove all expired ingredients${expiredItems.length ? `, ${expiredItems.length} items` : ""}`}
        accessibilityState={{ disabled: expiredItems.length === 0 }}
        disabled={expiredItems.length === 0}
        style={[
          styles.removeExpiredButton,
          expiredItems.length === 0 && styles.removeExpiredButtonDisabled,
        ]}
        onPress={() => setBulkDeleteOpen(true)}
      >
        <Ionicons name="trash-bin-outline" size={18} color={expiredItems.length ? palette.cd9505b : palette.caab2bd} />
        <Text style={[styles.removeExpiredText, expiredItems.length === 0 && styles.removeExpiredTextDisabled]}>
          Remove all expired{expiredItems.length ? ` (${expiredItems.length})` : ""}
        </Text>
      </Pressable>
    </>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={GREEN} />
        <Text style={styles.stateText}>Loading your ingredients…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + PAGE_TOP_GAP }]}>
      <View pointerEvents="none" style={[styles.safeHeaderBackground,{height:insets.top+PAGE_TOP_GAP}]} />
      <FlatList
        ref={listRef}
        data={filteredItems}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <IngredientCard
            item={item}
            onEdit={() => openEdit(item)}
            onDelete={() => confirmDelete(item)}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>{error ? "☁️" : "🧺"}</Text>
            <Text style={styles.emptyTitle}>
              {error
                ? "Unable to load ingredients"
                : query
                  ? "No ingredients found"
                  : "Your list is empty"}
            </Text>
            <Text style={styles.emptyCopy}>
              {error ??
                (query
                  ? "Try a different search term."
                  : "Add your first ingredient to start tracking what is available.")}
            </Text>
            {error && (
              <Pressable
                style={styles.retryButton}
                onPress={() => void loadInventory()}
              >
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            )}
          </View>
        }
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={GREEN}
            colors={[GREEN]}
            onRefresh={() => void loadInventory(true)}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      <IngredientEditor
        visible={editorOpen}
        item={editingItem}
        onClose={() => setEditorOpen(false)}
        onSave={saveItem}
      />
      <DeleteConfirmation
        item={pendingDelete}
        deleting={deleting}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={() => void removePendingItem()}
      />
      <BulkDeleteConfirmation
        count={expiredItems.length}
        visible={bulkDeleteOpen}
        deleting={bulkDeleting}
        onCancel={() => setBulkDeleteOpen(false)}
        onConfirm={() => void removeAllExpiredItems()}
      />
    </View>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  warning = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <View style={[styles.summaryCard, warning && styles.summaryWarning]}>
      <Ionicons name={icon} size={20} color={warning ? palette.cf39a17 : palette.cb6774c} />
      <View>
        <Text style={styles.summaryLabel}>{label}</Text>
        <Text
          style={[styles.summaryValue, warning && styles.summaryWarningText]}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

function IngredientCard({
  item,
  onEdit,
  onDelete,
}: {
  item: InventoryItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const days = daysUntil(item.expiry_date);
  const urgent = days <= 3;
  const daysLabel = days < 0 ? "Expired" : days === 0 ? "Today" : `${days}d`;
  return (
    <View style={[styles.itemCard, urgent && styles.itemCardUrgent]}>
      <Text style={styles.itemEmoji}>{item.icon ?? itemEmoji(item.name)}</Text>
      <View style={styles.itemBody}>
        <View style={styles.itemNameRow}>
          <Text style={styles.itemName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.sourceBadge}>{item.source.toUpperCase()}</Text>
        </View>
        <Text style={styles.itemQuantity}>{item.quantity}</Text>
      </View>
      <Text style={[styles.daysBadge, urgent && styles.daysBadgeUrgent]}>
        {daysLabel}
      </Text>
      <Pressable
        accessibilityLabel={`Edit ${item.name}`}
        hitSlop={8}
        onPress={onEdit}
      >
        <Ionicons name="pencil-outline" size={18} color={palette.c9aa5b1} />
      </Pressable>
      <Pressable
        accessibilityLabel={`Remove ${item.name}`}
        style={styles.deleteIconButton}
        hitSlop={8}
        onPress={onDelete}
      >
        <Ionicons name="trash-outline" size={18} color={palette.ce5484d} />
      </Pressable>
    </View>
  );
}

function IngredientEditor({
  visible,
  item,
  onClose,
  onSave,
}: {
  visible: boolean;
  item?: InventoryItem;
  onClose: () => void;
  onSave: (input: InventoryItemInput) => Promise<void>;
}) {
  const sheetMotion = useBottomSheetSlide(visible);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [unitManuallyChanged, setUnitManuallyChanged] = useState(false);
  const [days, setDays] = useState("");
  const [expiryMode, setExpiryMode] = useState<"days" | "date">("days");
  const [expiryDate, setExpiryDate] = useState("");
  const [selectedIcon, setSelectedIcon] = useState<string>();
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);
  const [customUnitOpen, setCustomUnitOpen] = useState(false);
  const [customUnit, setCustomUnit] = useState("");
  const [customIcon, setCustomIcon] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    if (!visible) return;
    const parsedQuantity = splitQuantity(item?.quantity ?? "");
    setName(item?.name ?? "");
    setAmount(parsedQuantity.amount);
    setUnit(item ? parsedQuantity.unit : "pcs");
    setUnitManuallyChanged(!!item);
    setDays(item ? String(Math.max(0, daysUntil(item.expiry_date))) : "");
    setExpiryDate(item ? item.expiry_date.slice(0, 10) : "");
    setExpiryMode("days");
    setSelectedIcon(item?.icon);
    setCustomIcon("");
    setIconPickerOpen(false);
    setUnitPickerOpen(false);
    setCalendarOpen(false);
    setCustomUnitOpen(false);
    setCustomUnit("");
    setMessage(undefined);
  }, [item, visible]);

  function updateName(value: string) {
    setName(value);
    if (!unitManuallyChanged) setUnit(defaultUnitForName(value));
  }

  async function submit() {
    const parsedDays = Number(days);
    const parsedDate = expiryDateFromText(expiryDate);
    const resolvedExpiry =
      expiryMode === "days"
        ? Number.isInteger(parsedDays) && parsedDays >= 0 && parsedDays <= 3650
          ? new Date(expiryDateFromDays(parsedDays))
          : undefined
        : parsedDate;
    if (!name.trim() || !amount.trim() || !unit || !resolvedExpiry) {
      setMessage(
        `Enter a name, quantity, unit, and a valid ${expiryMode === "days" ? "number of days" : "date in YYYY-MM-DD format"}.`,
      );
      return;
    }
    setSaving(true);
    setMessage(undefined);
    try {
      await onSave({
        name: name.trim(),
        quantity: `${amount.trim()} ${unit}`,
        expiry_date: resolvedExpiry.toISOString(),
        category: item?.category,
        source: item?.source ?? "manual",
        icon: selectedIcon,
      });
    } catch (nextError) {
      setMessage(
        nextError instanceof Error
          ? nextError.message
          : "The ingredient could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <Animated.View style={[styles.editor, sheetMotion]}>
          <View style={styles.editorHeader}>
            <Text style={styles.editorTitle}>
              {item ? "Edit Ingredient" : "Add Ingredient"}
            </Text>
            <Pressable
              accessibilityLabel="Close"
              style={styles.closeButton}
              onPress={onClose}
            >
              <Ionicons name="close" size={20} color={palette.c4c5865} />
            </Pressable>
          </View>
          <View style={styles.nameRow}>
            <Pressable
              accessibilityLabel="Choose ingredient icon"
              style={styles.emojiInput}
              onPress={() => setIconPickerOpen((current) => !current)}
            >
              <Text
                style={[
                  styles.editorEmoji,
                  !name.trim() && !selectedIcon && styles.questionIcon,
                ]}
              >
                {selectedIcon ?? itemEmoji(name)}
              </Text>
              <View style={styles.iconEditBadge}>
                <Ionicons name="pencil" size={9} color={palette.cffffff} />
              </View>
            </Pressable>
            <TextInput
              style={[styles.input, styles.flexInput]}
              value={name}
              onChangeText={updateName}
              placeholder="Name*"
              placeholderTextColor={palette.c9aa4b1}
              autoFocus={!item}
            />
          </View>
          {iconPickerOpen && (
            <View style={styles.pickerPanel}>
              <Pressable
                style={[
                  styles.autoIconChoice,
                  !selectedIcon && styles.pickerChoiceActive,
                ]}
                onPress={() => {
                  setSelectedIcon(undefined);
                  setCustomIcon("");
                  setIconPickerOpen(false);
                }}
              >
                <Text style={styles.autoIconPreview}>{itemEmoji(name)}</Text>
                <Text style={styles.autoIconText}>Auto-generate</Text>
              </Pressable>
              <View style={styles.iconGrid}>
                {selectableIcons.map((icon) => (
                  <Pressable
                    key={icon}
                    style={[
                      styles.iconChoice,
                      selectedIcon === icon && styles.pickerChoiceActive,
                    ]}
                    onPress={() => {
                      setSelectedIcon(icon);
                      setCustomIcon("");
                      setIconPickerOpen(false);
                    }}
                  >
                    <Text style={styles.choiceEmoji}>{icon}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.customIconRow}>
                <TextInput
                  style={[styles.input, styles.customIconInput]}
                  value={customIcon}
                  onChangeText={(value) => setCustomIcon(value.slice(0, 4))}
                  placeholder="Custom icon"
                  placeholderTextColor={palette.c9aa4b1}
                />
                <Pressable
                  style={styles.useIconButton}
                  onPress={() => {
                    const icon = customIcon.trim();
                    if (icon) {
                      setSelectedIcon(icon);
                      setIconPickerOpen(false);
                    }
                  }}
                >
                  <Text style={styles.useIconText}>Use</Text>
                </Pressable>
              </View>
            </View>
          )}
          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>Quantity</Text>
            <View style={styles.compactFieldRow}>
              <TextInput
                style={[styles.input, styles.amountInput]}
                value={amount}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor={palette.c9aa4b1}
                keyboardType="decimal-pad"
              />
              <Pressable
                style={styles.unitButton}
                onPress={() => setUnitPickerOpen((current) => !current)}
              >
                <Text style={styles.unitText}>{unit}</Text>
                <Ionicons name="chevron-down" size={14} color={palette.c667281} />
              </Pressable>
            </View>
            {unitPickerOpen && (
              <View style={styles.unitGrid}>
                {quantityUnits.map((choice) => (
                  <Pressable
                    key={choice}
                    style={[
                      styles.unitChoice,
                      (unit === choice ||
                        (choice === "Custom" && customUnitOpen)) &&
                        styles.unitChoiceActive,
                    ]}
                    onPress={() => {
                      if (choice === "Custom") {
                        setCustomUnitOpen(true);
                        return;
                      }
                      setUnit(choice);
                      setUnitManuallyChanged(true);
                      setCustomUnitOpen(false);
                      setUnitPickerOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.unitChoiceText,
                        (unit === choice ||
                          (choice === "Custom" && customUnitOpen)) &&
                          styles.unitChoiceTextActive,
                      ]}
                    >
                      {choice}
                    </Text>
                  </Pressable>
                ))}
                {customUnitOpen && (
                  <View style={styles.customUnitRow}>
                    <TextInput
                      style={[styles.input, styles.customUnitInput]}
                      value={customUnit}
                      onChangeText={(value) =>
                        setCustomUnit(value.slice(0, 12))
                      }
                      placeholder="Enter unit"
                      placeholderTextColor={palette.c9aa4b1}
                      autoFocus
                    />
                    <Pressable
                      style={styles.useUnitButton}
                      onPress={() => {
                        const nextUnit = customUnit.trim();
                        if (nextUnit) {
                          setUnit(nextUnit);
                          setUnitManuallyChanged(true);
                          setCustomUnitOpen(false);
                          setUnitPickerOpen(false);
                        }
                      }}
                    >
                      <Text style={styles.useIconText}>Use</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}
          </View>
          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>
              {expiryMode === "days" ? "Days left" : "Expiration date"}
            </Text>
            <View style={styles.expiryInputRow}>
              {expiryMode === "days" ? (
                <TextInput
                  style={[styles.input, styles.expiryValueInput]}
                  value={days}
                  onChangeText={setDays}
                  placeholder="0"
                  placeholderTextColor={palette.c9aa4b1}
                  keyboardType="number-pad"
                />
              ) : (
                <Pressable
                  style={[styles.input, styles.datePickerButton]}
                  onPress={() => setCalendarOpen(true)}
                >
                  <Ionicons name="calendar-outline" size={17} color={GREEN} />
                  <Text
                    style={[
                      styles.datePickerText,
                      !expiryDate && styles.datePickerPlaceholder,
                    ]}
                  >
                    {expiryDate || "Select date"}
                  </Text>
                </Pressable>
              )}
              <View style={styles.modeSwitch}>
                <Pressable
                  style={[
                    styles.modeChoice,
                    expiryMode === "days" && styles.modeChoiceActive,
                  ]}
                  onPress={() => setExpiryMode("days")}
                >
                  <Text
                    style={[
                      styles.modeText,
                      expiryMode === "days" && styles.modeTextActive,
                    ]}
                  >
                    Days
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.modeChoice,
                    expiryMode === "date" && styles.modeChoiceActive,
                  ]}
                  onPress={() => setExpiryMode("date")}
                >
                  <Text
                    style={[
                      styles.modeText,
                      expiryMode === "date" && styles.modeTextActive,
                    ]}
                  >
                    Date
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
          {!!message && <Text style={styles.formError}>{message}</Text>}
          <Pressable
            style={[styles.saveButton, saving && styles.disabledButton]}
            disabled={saving}
            onPress={() => void submit()}
          >
            {saving ? (
              <ActivityIndicator color={palette.cffffff} />
            ) : (
              <Text style={styles.saveText}>
                {item ? "Save Changes" : "Add to List"}
              </Text>
            )}
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
      <CalendarPicker
        visible={calendarOpen}
        selectedDate={expiryDate}
        onClose={() => setCalendarOpen(false)}
        onSelect={(date) => {
          setExpiryDate(formatLocalDate(date));
          setCalendarOpen(false);
        }}
      />
    </Modal>
  );
}

function CalendarPicker({
  visible,
  selectedDate,
  onClose,
  onSelect,
}: {
  visible: boolean;
  selectedDate: string;
  onClose: () => void;
  onSelect: (date: Date) => void;
}) {
  const initialDate = expiryDateFromText(selectedDate) ?? new Date();
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1),
  );

  useEffect(() => {
    if (!visible) return;
    const nextDate = expiryDateFromText(selectedDate) ?? new Date();
    setVisibleMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
  }, [selectedDate, visible]);

  const calendarDays = useMemo(() => {
    const startOffset = visibleMonth.getDay();
    const numberOfDays = new Date(
      visibleMonth.getFullYear(),
      visibleMonth.getMonth() + 1,
      0,
    ).getDate();
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - startOffset + 1;
      return day >= 1 && day <= numberOfDays ? day : undefined;
    });
  }, [visibleMonth]);
  const selected = expiryDateFromText(selectedDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthLabel = visibleMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.calendarRoot}>
        <Pressable style={styles.confirmBackdrop} onPress={onClose} />
        <View style={styles.calendarCard}>
          <View style={styles.calendarHeader}>
            <Pressable
              accessibilityLabel="Previous month"
              style={styles.calendarNav}
              onPress={() =>
                setVisibleMonth(
                  (current) =>
                    new Date(current.getFullYear(), current.getMonth() - 1, 1),
                )
              }
            >
              <Ionicons name="chevron-back" size={19} color={palette.c53645c} />
            </Pressable>
            <Text style={styles.calendarTitle}>{monthLabel}</Text>
            <Pressable
              accessibilityLabel="Next month"
              style={styles.calendarNav}
              onPress={() =>
                setVisibleMonth(
                  (current) =>
                    new Date(current.getFullYear(), current.getMonth() + 1, 1),
                )
              }
            >
              <Ionicons name="chevron-forward" size={19} color={palette.c53645c} />
            </Pressable>
          </View>
          <View style={styles.weekRow}>
            {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
              <Text key={`${day}-${index}`} style={styles.weekDay}>
                {day}
              </Text>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {calendarDays.map((day, index) => {
              if (!day)
                return (
                  <View key={`empty-${index}`} style={styles.calendarDay} />
                );
              const date = new Date(
                visibleMonth.getFullYear(),
                visibleMonth.getMonth(),
                day,
                12,
              );
              const isPast = date.getTime() < today.getTime();
              const isSelected =
                !!selected &&
                selected.getFullYear() === date.getFullYear() &&
                selected.getMonth() === date.getMonth() &&
                selected.getDate() === day;
              return (
                <Pressable
                  key={day}
                  disabled={isPast}
                  style={[
                    styles.calendarDay,
                    isSelected && styles.calendarDaySelected,
                  ]}
                  onPress={() => onSelect(date)}
                >
                  <Text
                    style={[
                      styles.calendarDayText,
                      isPast && styles.calendarDayDisabled,
                      isSelected && styles.calendarDayTextSelected,
                    ]}
                  >
                    {day}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable style={styles.calendarCancel} onPress={onClose}>
            <Text style={styles.calendarCancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function DeleteConfirmation({
  item,
  deleting,
  onCancel,
  onConfirm,
}: {
  item?: InventoryItem;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      visible={!!item}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.confirmRoot}>
        <Pressable style={styles.confirmBackdrop} onPress={onCancel} />
        <View style={styles.confirmCard}>
          <View style={styles.confirmIcon}>
            <Ionicons name="trash-outline" size={27} color={palette.ce5484d} />
          </View>
          <Text style={styles.confirmTitle}>Remove ingredient?</Text>
          <Text style={styles.confirmCopy}>
            <Text style={styles.confirmName}>{item?.name}</Text> will be removed
            from your ingredient list. This action cannot be undone.
          </Text>
          <View style={styles.confirmActions}>
            <Pressable
              style={styles.cancelButton}
              disabled={deleting}
              onPress={onCancel}
            >
              <Text style={styles.cancelButtonText}>Keep item</Text>
            </Pressable>
            <Pressable
              style={[styles.removeButton, deleting && styles.disabledButton]}
              disabled={deleting}
              onPress={onConfirm}
            >
              {deleting ? (
                <ActivityIndicator color={palette.cffffff} />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={16} color={palette.cffffff} />
                  <Text style={styles.removeButtonText}>Remove</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function BulkDeleteConfirmation({
  count,
  visible,
  deleting,
  onCancel,
  onConfirm,
}: {
  count: number;
  visible: boolean;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.confirmRoot}>
        <Pressable style={styles.confirmBackdrop} onPress={onCancel} disabled={deleting} />
        <View style={styles.confirmCard}>
          <View style={styles.confirmIcon}>
            <Ionicons name="trash-bin-outline" size={27} color={palette.ce5484d} />
          </View>
          <Text style={styles.confirmTitle}>Remove all expired items?</Text>
          <Text style={styles.confirmCopy}>
            {count} expired {count === 1 ? "ingredient" : "ingredients"} will be permanently removed from your ingredient list. This action cannot be undone.
          </Text>
          <View style={styles.confirmActions}>
            <Pressable style={styles.cancelButton} disabled={deleting} onPress={onCancel}>
              <Text style={styles.cancelButtonText}>Keep items</Text>
            </Pressable>
            <Pressable style={[styles.removeButton, deleting && styles.disabledButton]} disabled={deleting} onPress={onConfirm}>
              {deleting ? <ActivityIndicator color={palette.cffffff} /> : <>
                <Ionicons name="trash-outline" size={16} color={palette.cffffff} />
                <Text style={styles.removeButtonText}>Remove all</Text>
              </>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  safeHeaderBackground:{position:"absolute",left:0,right:0,top:0,backgroundColor:colors.consumerCanvas},
  listContent: { flexGrow: 1, paddingBottom: 112 },
  header: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    backgroundColor: palette.cffffff,
  },
  title: { color: palette.c101828, fontSize: typography.mobile.rawSize.s20, fontWeight: typography.weight.extrabold },
  headerActions: { flexDirection: "row", gap: 10 },
  roundButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: palette.cf2f4f6,
  },
  cameraButton: { backgroundColor: palette.cedfaf2 },
  addButton: {
    backgroundColor: GREEN,
    shadowColor: GREEN,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  searchBox: {
    minHeight: 45,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginHorizontal: 16,
    marginBottom: 14,
    paddingHorizontal: 13,
    borderRadius: 13,
    backgroundColor: palette.cf2f3f5,
  },
  searchInput: { flex: 1, color: palette.c263746, fontSize: typography.mobile.rawSize.s13 },
  divider: { height: 1, backgroundColor: palette.ce4e5e1 },
  summaryRow: { flexDirection: "row", gap: 8, padding: 14 },
  summaryCard: {
    flex: 1,
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: palette.ce4e5e2,
    borderRadius: 13,
    backgroundColor: palette.cffffff,
    shadowColor: palette.c475467,
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 2,
  },
  summaryWarning: { borderColor: palette.cf5d7aa, backgroundColor: palette.cfff9f0 },
  summaryLabel: { color: palette.c98a2b3, fontSize: typography.mobile.rawSize.s9 },
  summaryValue: {
    marginTop: 2,
    color: palette.c162435,
    fontSize: typography.mobile.rawSize.s14,
    fontWeight: typography.weight.extrabold,
  },
  summaryWarningText: { color: palette.cff5a1f },
  removeExpiredButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: palette.cf4c98e,
    borderRadius: 12,
    backgroundColor: palette.cfff1f1,
  },
  removeExpiredButtonDisabled: { borderColor: palette.ce4e5e2, backgroundColor: palette.cf2f3f5 },
  removeExpiredText: { color: palette.cd9505b, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.extrabold },
  removeExpiredTextDisabled: { color: palette.caab2bd },
  itemCard: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: palette.ce4e4e1,
    borderRadius: 15,
    backgroundColor: palette.cffffff,
    shadowColor: palette.c475467,
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 2,
  },
  itemCardUrgent: { borderColor: palette.cf4c98e },
  itemEmoji: { width: 28, fontSize: typography.mobile.rawSize.s25, textAlign: "center" },
  itemBody: { flex: 1 },
  itemNameRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  itemName: {
    maxWidth: "68%",
    color: palette.c172536,
    fontSize: typography.mobile.rawSize.s14,
    fontWeight: typography.weight.extrabold,
  },
  sourceBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 7,
    color: palette.c657180,
    backgroundColor: palette.cf1f2f4,
    fontSize: typography.mobile.rawSize.s7,
    fontWeight: typography.weight.extrabold,
  },
  itemQuantity: { marginTop: 4, color: palette.c9aa4b1, fontSize: typography.mobile.rawSize.s11 },
  deleteIconButton: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: palette.cfff1f1,
  },
  daysBadge: {
    minWidth: 34,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
    color: palette.c0b9a4a,
    backgroundColor: palette.cddf8e7,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.extrabold,
    textAlign: "center",
  },
  daysBadgeUrgent: { color: palette.cff6b18, backgroundColor: palette.cfff0db },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: palette.cf7f5ef,
  },
  stateText: { color: palette.c718096 },
  emptyState: { alignItems: "center", paddingHorizontal: 36, paddingTop: 50 },
  emptyEmoji: { fontSize: typography.mobile.rawSize.s38 },
  emptyTitle: {
    marginTop: 12,
    color: palette.c1c2a39,
    fontSize: typography.mobile.rawSize.s17,
    fontWeight: typography.weight.extrabold,
  },
  emptyCopy: {
    marginTop: 7,
    color: palette.c7a8794,
    fontSize: typography.mobile.rawSize.s13,
    lineHeight: 19,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: GREEN,
  },
  retryText: { color: palette.cffffff, fontWeight: typography.weight.extrabold },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: palette.crgba_20_28_36_0_45,
  },
  editor: {
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: Platform.OS === "ios" ? 36 : 22,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: palette.cffffff,
  },
  editorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  editorTitle: { color: palette.c111d2c, fontSize: typography.mobile.rawSize.s20, fontWeight: typography.weight.extrabold },
  closeButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: palette.cf1f2f4,
  },
  nameRow: { flexDirection: "row", gap: 8 },
  emojiInput: {
    width: 52,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.ce4e6e8,
    borderRadius: 12,
    backgroundColor: palette.cf5f6f7,
  },
  editorEmoji: { fontSize: typography.mobile.rawSize.s25 },
  questionIcon: { color: palette.caab2bd, fontSize: typography.mobile.rawSize.s25, fontWeight: typography.weight.extrabold },
  iconEditBadge: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: palette.cffffff,
    borderRadius: 9,
    backgroundColor: GREEN,
  },
  input: {
    height: 48,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: palette.ce4e6e8,
    borderRadius: 12,
    color: palette.c213142,
    backgroundColor: palette.cf5f6f7,
    fontSize: typography.mobile.rawSize.s13,
  },
  flexInput: { flex: 1 },
  pickerPanel: {
    gap: 10,
    marginTop: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.ce3e8e4,
    borderRadius: 14,
    backgroundColor: palette.cf8faf8,
  },
  autoIconChoice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: palette.ce1e6e2,
    borderRadius: 11,
    backgroundColor: palette.cffffff,
  },
  autoIconPreview: {
    width: 24,
    color: palette.c9aa4b1,
    fontSize: typography.mobile.rawSize.s19,
    fontWeight: typography.weight.extrabold,
    textAlign: "center",
  },
  autoIconText: { color: palette.c506057, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.bold },
  iconGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  iconChoice: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.ce3e7e4,
    borderRadius: 10,
    backgroundColor: palette.cffffff,
  },
  pickerChoiceActive: { borderColor: GREEN, backgroundColor: palette.ceaf8ef },
  choiceEmoji: { fontSize: typography.mobile.rawSize.s21 },
  customIconRow: { flexDirection: "row", gap: 8 },
  customIconInput: { flex: 1, height: 42 },
  useIconButton: {
    minWidth: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: palette.c263746,
  },
  useIconText: { color: palette.cffffff, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.extrabold },
  formGroup: { marginTop: 14 },
  fieldLabel: {
    marginBottom: 7,
    color: palette.c425149,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.extrabold,
  },
  compactFieldRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  amountInput: { width: 92 },
  unitButton: {
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: palette.cdde3df,
    borderRadius: 11,
    backgroundColor: palette.cffffff,
  },
  unitText: { minWidth: 42, color: palette.c35443c, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.bold },
  unitGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 9 },
  unitChoice: {
    width: 68,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: palette.cdde3df,
    borderRadius: 11,
    backgroundColor: palette.cffffff,
  },
  unitChoiceActive: { borderColor: GREEN, backgroundColor: palette.ceaf8ef },
  unitChoiceText: { color: palette.c66736c, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.bold },
  unitChoiceTextActive: { color: palette.c118247 },
  customUnitRow: { width: "100%", flexDirection: "row", gap: 8, marginTop: 2 },
  customUnitInput: { flex: 1, height: 44 },
  useUnitButton: {
    minWidth: 68,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: palette.c263746,
  },
  expiryInputRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  expiryValueInput: { flex: 1, height: 46 },
  datePickerButton: {
    flex: 1,
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  datePickerText: { color: palette.c35443c, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.bold },
  datePickerPlaceholder: { color: palette.c9aa4b1, fontWeight: typography.weight.regular },
  modeSwitch: {
    flexDirection: "row",
    padding: 2,
    borderRadius: 11,
    backgroundColor: palette.ceff2f0,
  },
  modeChoice: {
    minWidth: 68,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 9,
  },
  modeChoiceActive: {
    backgroundColor: palette.cffffff,
    shadowColor: palette.c34433b,
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  modeText: { color: palette.c89958e, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.bold },
  modeTextActive: { color: GREEN },
  formError: { marginTop: 10, color: palette.cd14343, fontSize: typography.mobile.rawSize.s12 },
  saveButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: GREEN,
  },
  disabledButton: { opacity: 0.65 },
  saveText: { color: palette.cffffff, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.extrabold },
  confirmRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  confirmBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: palette.crgba_20_38_31_0_42,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    padding: 22,
    borderRadius: 22,
    backgroundColor: palette.cfffefa,
    shadowColor: palette.c19352a,
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 8,
  },
  confirmIcon: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 28,
    backgroundColor: palette.cfff0f1,
  },
  confirmTitle: {
    marginTop: 14,
    color: palette.c1e372f,
    fontSize: typography.mobile.rawSize.s20,
    fontWeight: typography.weight.extrabold,
  },
  confirmCopy: {
    marginTop: 8,
    color: palette.c687b73,
    fontSize: typography.mobile.rawSize.s13,
    lineHeight: 19,
    textAlign: "center",
  },
  confirmName: { color: palette.c344b42, fontWeight: typography.weight.extrabold },
  confirmActions: {
    width: "100%",
    flexDirection: "row",
    gap: 9,
    marginTop: 22,
  },
  cancelButton: {
    flex: 1,
    minHeight: 45,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.cdce5e0,
    borderRadius: 12,
    backgroundColor: palette.cf7f9f7,
  },
  cancelButtonText: { color: palette.c3d5d51, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.extrabold },
  removeButton: {
    flex: 1,
    minHeight: 45,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 12,
    backgroundColor: palette.cd9505b,
  },
  removeButtonText: { color: palette.cffffff, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.extrabold },
  calendarRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
  },
  calendarCard: {
    width: "100%",
    maxWidth: 350,
    minHeight: 430,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 22,
    borderRadius: 22,
    backgroundColor: palette.cfffefa,
    shadowColor: palette.c19352a,
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  calendarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  calendarNav: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: palette.cf0f4f1,
  },
  calendarTitle: { color: palette.c1e372f, fontSize: typography.mobile.rawSize.s17, fontWeight: typography.weight.extrabold },
  weekRow: { flexDirection: "row", marginBottom: 5 },
  weekDay: {
    width: "14.2857%",
    color: palette.c92a099,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.extrabold,
    textAlign: "center",
  },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  calendarDay: {
    width: "14.2857%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  calendarDaySelected: { backgroundColor: GREEN },
  calendarDayText: { color: palette.c36483f, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.bold },
  calendarDayDisabled: { color: palette.cc8cfca },
  calendarDayTextSelected: { color: palette.cffffff },
  calendarCancel: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: palette.cf3f6f4,
  },
  calendarCancelText: { color: palette.c3d5d51, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.extrabold },
});
