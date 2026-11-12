import { apiBaseUrl } from "../../../lib/api-url";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { colors, palette, typography } from "@ecochef/design-tokens";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../auth/auth-provider";
import { createMobileApi } from "../../../lib/api";
import type { RecipeList, RecipeSummary } from "../types";
import {
  PAGE_TOP_GAP,
  PageHeader,
} from "../../../shared/components/page-header";
import { AppMessageModal } from "../../../shared/components/app-message-modal";
import {
  RecipeFilterSheet,
  type RecipeFilters,
} from "../components/recipe-filter-sheet";
import { ScheduleSheet } from "../components/schedule-sheet";
import { recipeTagKind } from "../recipe-tag-options";
import { recipeImageUrl } from "../recipe-image";
import type { MealPlanCalendar } from "../../meal-planning/types";

const GREEN = palette.c12ad55;
const runtimeProcess = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process;

const tabs = ["For You", "Favourites", "Self-Created", "Community"] as const;

export function RecipesScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const listRef = useRef<FlatList<RecipeSummary>>(null);
  const requestIdRef = useRef(0);
  const previousQueryRef = useRef("");
  const recipeCacheRef = useRef(new Map<string, RecipeSummary[]>());
  const favouriteOverridesRef = useRef(
    new Map<string, { value: boolean; recipe: RecipeSummary }>(),
  );
  const { status, user } = useAuth();
  const api = useMemo(
    () => createMobileApi(apiBaseUrl, () => user?.getIdToken()),
    [user],
  );
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("For You");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [filters, setFilters] = useState<RecipeFilters>({
    mealTypes: [],
    dietary: [],
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [scheduleRecipe, setScheduleRecipe] = useState<RecipeSummary>();
  const [pageMessage, setPageMessage] = useState<{
    title: string;
    message: string;
    tone: "success" | "error" | "info";
  }>();

  function recipeParameters(tab = activeTab) {
    const parameters = new URLSearchParams();
    if (query.trim()) parameters.set("search", query.trim());
    if (tab === "Favourites") parameters.set("favourites_only", "true");
    if (tab === "Self-Created") parameters.set("mine_only", "true");
    if (tab === "Community") parameters.set("community_only", "true");
    [...filters.mealTypes, ...filters.dietary].forEach((tag) =>
      parameters.append("tags", tag.toLowerCase()),
    );
    if (filters.cookTime)
      parameters.set("max_total_time", String(filters.cookTime));
    return parameters.toString();
  }

  function applyFavouriteOverrides(
    items: RecipeSummary[],
    parameterString: string,
  ) {
    const next = items.map((item) => {
      const override = favouriteOverridesRef.current.get(item.id);
      if (!override) return item;
      if (item.is_favourite === override.value) {
        favouriteOverridesRef.current.delete(item.id);
        return item;
      }
      return { ...item, is_favourite: override.value };
    });
    if (
      new URLSearchParams(parameterString).get("favourites_only") === "true"
    ) {
      favouriteOverridesRef.current.forEach((override) => {
        if (
          override.value &&
          !next.some((item) => item.id === override.recipe.id)
        )
          next.unshift({ ...override.recipe, is_favourite: true });
      });
    }
    return next;
  }

  async function loadRecipes(refresh = false) {
    const requestId = ++requestIdRef.current;
    const parameterString = recipeParameters();
    const cached = recipeCacheRef.current.get(parameterString);
    if (cached && !refresh) setRecipes(cached);
    refresh ? setRefreshing(true) : setLoading(!cached);
    setError(undefined);
    try {
      const result = await api.getRecipes<RecipeList>(parameterString);
      const items = applyFavouriteOverrides(result.items, parameterString);
      recipeCacheRef.current.set(parameterString, items);
      if (requestId === requestIdRef.current) setRecipes(items);
    } catch (nextError) {
      if (requestId === requestIdRef.current)
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Recipes could not be loaded.",
        );
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    if (status !== "signed_in" || !user) return;
    const searchChanged = previousQueryRef.current !== query;
    previousQueryRef.current = query;
    const timer = setTimeout(() => void loadRecipes(), searchChanged ? 250 : 0);
    return () => clearTimeout(timer);
  }, [api, query, activeTab, filters, status, user]);
  useEffect(() => {
    // Expo Router's inferred root navigation type omits the parent Tabs event map.
    // @ts-expect-error tabPress is emitted by that parent navigator at runtime.
    return navigation.addListener("tabPress", () =>
      listRef.current?.scrollToOffset({ offset: 0, animated: true }),
    );
  }, [navigation]);
  useEffect(
    () =>
      navigation.addListener("focus", () => {
        if (status === "signed_in" && user) void loadRecipes();
      }),
    [navigation, api, query, activeTab, filters, status, user],
  );

  async function toggleFavourite(recipe: RecipeSummary) {
    const next = !recipe.is_favourite;
    favouriteOverridesRef.current.set(recipe.id, {
      value: next,
      recipe: { ...recipe, is_favourite: next },
    });
    recipeCacheRef.current.forEach((items, key) => {
      const favouritesOnly =
        new URLSearchParams(key).get("favourites_only") === "true";
      let updated = items.map((item) =>
        item.id === recipe.id ? { ...item, is_favourite: next } : item,
      );
      if (favouritesOnly)
        updated = next
          ? updated.some((item) => item.id === recipe.id)
            ? updated
            : [{ ...recipe, is_favourite: true }, ...updated]
          : updated.filter((item) => item.id !== recipe.id);
      recipeCacheRef.current.set(key, updated);
    });
    setRecipes((current) =>
      current.map((item) =>
        item.id === recipe.id ? { ...item, is_favourite: next } : item,
      ),
    );
    try {
      await api.setRecipeFavourite(recipe.id, next);
    } catch (nextError) {
      favouriteOverridesRef.current.delete(recipe.id);
      recipeCacheRef.current.forEach((items, key) =>
        recipeCacheRef.current.set(
          key,
          items.map((item) =>
            item.id === recipe.id ? { ...item, is_favourite: !next } : item,
          ),
        ),
      );
      setRecipes((current) =>
        current.map((item) =>
          item.id === recipe.id ? { ...item, is_favourite: !next } : item,
        ),
      );
      setPageMessage({
        title: "Favourite not updated",
        message:
          nextError instanceof Error
            ? nextError.message
            : "EcoChef could not update this favourite. Please try again.",
        tone: "error",
      });
    }
  }

  function selectTab(tab: (typeof tabs)[number]) {
    if (tab === activeTab) return;
    requestIdRef.current += 1;
    const cached = recipeCacheRef.current.get(recipeParameters(tab));
    if (cached) setRecipes(cached);
    else
      setRecipes((current) =>
        tab === "Favourites"
          ? current.filter((item) => item.is_favourite)
          : tab === "Self-Created"
            ? current.filter((item) => item.is_owner)
            : tab === "Community"
              ? current.filter((item) => !item.is_owner)
              : current,
      );
    setActiveTab(tab);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }

  const smartMatchRecipes = recipes.filter(
    (recipe) => (recipe.smart_match_ingredients ?? []).length > 0,
  );
  const smartMatchIngredients = Array.from(
    new Set(
      smartMatchRecipes.flatMap(
        (recipe) => recipe.smart_match_ingredients ?? [],
      ),
    ),
  );
  const smartMatchPreview = smartMatchIngredients.slice(0, 2).join(" and ");
  const relevantTagTerms = [...filters.mealTypes, ...filters.dietary, query]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const activeFilterCount =
    filters.mealTypes.length +
    filters.dietary.length +
    (filters.cookTime ? 1 : 0) +
    (filters.minimumRating ? 1 : 0);
  const loadPlannedMeals = useCallback(
    async (date: string) =>
      (await api.getMyMealPlan<MealPlanCalendar>(date, 1)).items,
    [api],
  );

  const header = (
    <View>
      <View style={styles.titleRow}>
        <PageHeader
          title="Recipes"
          action={
            <Pressable
              accessibilityLabel="Create recipe"
              style={({ pressed }) => [
                styles.addButton,
                pressed && styles.addButtonPressed,
              ]}
              onPress={() => router.push("/recipes/new")}
            >
              <Ionicons name="add" size={27} color={palette.cffffff} />
            </Pressable>
          }
        />
      </View>
      <View style={styles.search}>
        <Ionicons name="search-outline" size={18} color={palette.c9aa5b4} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="What do you want to cook?"
          placeholderTextColor={palette.c929cae}
          style={styles.searchInput}
          returnKeyType="search"
        />
        <Pressable
          style={({ pressed }) => [
            styles.filterButton,
            pressed && styles.filterButtonPressed,
          ]}
          onPress={() => setFiltersOpen(true)}
        >
          <Ionicons name="options-outline" size={15} color={GREEN} />
          <Text style={styles.filterButtonText}>Filter</Text>
          {activeFilterCount > 0 && (
            <View style={filterCountStyles.badge}>
              <Text style={filterCountStyles.text}>{activeFilterCount}</Text>
            </View>
          )}
        </Pressable>
      </View>
      <View style={styles.tabs}>
        {tabs.map((tab) => (
          <Pressable
            key={tab}
            onPress={() => selectTab(tab)}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === tab && styles.tabTextActive,
              ]}
            >
              {tab}
            </Text>
          </Pressable>
        ))}
      </View>
      {smartMatchRecipes.length > 0 && (
        <View style={styles.smartCard}>
          <View style={styles.smartIcon}>
            <Ionicons name="leaf-outline" size={23} color={palette.cffffff} />
          </View>
          <View style={styles.smartCardCopy}>
            <Text style={styles.smartTitle}>Smart Match active</Text>
            <Text style={styles.smartCopy}>
              {smartMatchRecipes.length}{" "}
              {smartMatchRecipes.length === 1 ? "recipe uses" : "recipes use"}{" "}
              {smartMatchPreview}
              {smartMatchIngredients.length > 2
                ? ` and ${smartMatchIngredients.length - 2} more`
                : ""}
            </Text>
          </View>
        </View>
      )}
      {smartMatchRecipes.length === 0 && <View style={{ height: 16 }} />}
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + PAGE_TOP_GAP }]}>
      <FlatList
        ref={listRef}
        data={recipes}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <RecipeCard
            recipe={item}
            relevantTagTerms={relevantTagTerms}
            onFavourite={() => void toggleFavourite(item)}
            onSchedule={() => setScheduleRecipe(item)}
            onCook={() =>
              router.push({
                pathname: "/recipes/[recipeId]",
                params: { recipeId: item.id, cookNow: "1" },
              })
            }
            onEdit={() =>
              router.push({
                pathname: "/recipes/[recipeId]/edit",
                params: { recipeId: item.id },
              })
            }
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          loading ? (
            <View style={styles.state}>
              <ActivityIndicator color={GREEN} />
              <Text style={styles.stateCopy}>Finding recipes…</Text>
            </View>
          ) : (
            <View style={styles.state}>
              <Text style={styles.emptyIcon}>{error ? "☁️" : "🍲"}</Text>
              <Text style={styles.emptyTitle}>
                {error ? "Unable to load recipes" : "No recipes found"}
              </Text>
              <Text style={styles.stateCopy}>
                {error ?? "Try another search or collection."}
              </Text>
              {error && (
                <Pressable
                  style={styles.retry}
                  onPress={() => void loadRecipes()}
                >
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              )}
            </View>
          )
        }
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 105, 120) }]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadRecipes(true)}
            tintColor={GREEN}
            colors={[GREEN]}
          />
        }
        showsVerticalScrollIndicator={false}
      />
      <RecipeFilterSheet
        visible={filtersOpen}
        value={filters}
        onClose={() => setFiltersOpen(false)}
        onApply={setFilters}
      />
      <ScheduleSheet
        recipe={scheduleRecipe}
        loadPlannedMeals={loadPlannedMeals}
        onClose={() => setScheduleRecipe(undefined)}
        onSave={async (date, meal, time, sharedGroupId) => {
          if (!scheduleRecipe) return;
          await api.scheduleRecipe(scheduleRecipe.id, {
            scheduled_date: date,
            meal_slot: meal,
            scheduled_time: time,
            shared_group_id: sharedGroupId,
          });
        }}
        onSuccess={(message) =>
          setPageMessage({
            title: "Added to meal plan",
            message,
            tone: "success",
          })
        }
      />
      <AppMessageModal
        visible={pageMessage !== undefined}
        title={pageMessage?.title ?? "EcoChef"}
        message={pageMessage?.message ?? ""}
        tone={pageMessage?.tone}
        onClose={() => setPageMessage(undefined)}
      />
    </View>
  );
}

function RecipeCard({
  recipe,
  relevantTagTerms,
  onFavourite,
  onSchedule,
  onCook,
  onEdit,
}: {
  recipe: RecipeSummary;
  relevantTagTerms: string[];
  onFavourite: () => void;
  onSchedule: () => void;
  onCook: () => void;
  onEdit: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [recipe.image_url]);
  const matchedIngredientCount = (recipe.smart_match_ingredients ?? []).length;
  const tagPriority = { meal: 0, dietary: 1, custom: 2 };
  const relevance = (tag: string) =>
    relevantTagTerms.some((term) => tag.toLowerCase().includes(term)) ? 0 : 1;
  const orderedTags = [...recipe.dietary_tags].sort(
    (left, right) =>
      relevance(left) - relevance(right) ||
      tagPriority[recipeTagKind(left)] - tagPriority[recipeTagKind(right)],
  );
  const hiddenTagCount = Math.max(0, orderedTags.length - 3);
  const open = () =>
    router.push({
      pathname: "/recipes/[recipeId]",
      params: { recipeId: recipe.id },
    });
  const imageUrl = recipeImageUrl(recipe.image_url, apiBaseUrl);
  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.hero}>
        {imageUrl && !imageFailed ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.image}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={styles.imageFallback}>
            <Text style={styles.foodEmoji}>🍽️</Text>
          </View>
        )}
        {matchedIngredientCount > 0 && (
          <View style={styles.match}>
            <Text style={styles.matchText}>
              {matchedIngredientCount} expiring{" "}
              {matchedIngredientCount === 1 ? "item" : "items"}
            </Text>
          </View>
        )}
        <Pressable
          accessibilityLabel={
            recipe.is_favourite ? "Remove from favourites" : "Add to favourites"
          }
          style={styles.heart}
          onPress={(event) => {
            event.stopPropagation();
            onFavourite();
          }}
        >
          <Ionicons
            name={recipe.is_favourite ? "heart" : "heart-outline"}
            size={22}
            color={recipe.is_favourite ? palette.cf45151 : palette.c9aa3af}
          />
        </Pressable>
        <View style={styles.timeBadge}>
          <Ionicons name="time-outline" size={12} color={palette.cffffff} />
          <Text style={styles.timeText}>{recipe.total_time} min</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.recipeTitleRow}>
          <Text style={styles.recipeTitle} numberOfLines={1}>
            {recipe.title}
          </Text>
          <View style={styles.rating}>
            <Ionicons name="star" size={15} color={palette.cf5a623} />
            <Text style={styles.ratingText}>
              {typeof recipe.average_rating === "number"
                ? recipe.average_rating.toFixed(1)
                : "New"}
            </Text>
          </View>
        </View>
        <View style={styles.meta}>
          {recipe.cuisine && (
            <Text style={styles.metaText}>{recipe.cuisine}</Text>
          )}
          {orderedTags.slice(0, 3).map((tag) => {
            const kind = recipeTagKind(tag);
            return (
              <Text
                key={tag}
                style={[
                  cardTagStyles.tag,
                  kind === "meal"
                    ? cardTagStyles.meal
                    : kind === "dietary"
                      ? cardTagStyles.dietary
                      : cardTagStyles.custom,
                ]}
              >
                {tag}
              </Text>
            );
          })}
          {hiddenTagCount > 0 && (
            <Text style={cardTagStyles.more}>+{hiddenTagCount} more</Text>
          )}
        </View>
        {recipe.safety_warnings.length > 0 && (
          <Text style={styles.safety} numberOfLines={1}>
            ⚠ {recipe.safety_warnings.join(" · ")}
          </Text>
        )}
        <View style={styles.actions}>
          {recipe.is_owner && (
            <Pressable
              style={historyStyles.editButton}
              onPress={(event) => {
                event.stopPropagation();
                onEdit();
              }}
            >
              <Ionicons name="pencil-outline" size={16} color={GREEN} />
              <Text style={historyStyles.editText}>Edit</Text>
            </Pressable>
          )}
          <Pressable
            style={styles.scheduleButton}
            onPress={(event) => {
              event.stopPropagation();
              onSchedule();
            }}
          >
            <Ionicons
              name="calendar-outline"
              size={17}
              color={palette.c344154}
            />
            <Text style={styles.scheduleText}>Add to Schedule</Text>
          </Pressable>
          <Pressable
            style={styles.cookButton}
            onPress={(event) => {
              event.stopPropagation();
              onCook();
            }}
          >
            <MaterialCommunityIcons
              name="chef-hat"
              size={18}
              color={palette.cffffff}
            />
            <Text style={styles.cookText}>Cook Now</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  content: { paddingHorizontal: 16, paddingBottom: 112 },
  titleRow: {},
  addButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: GREEN,
    shadowColor: GREEN,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 4,
  },
  addButtonPressed: { opacity: 0.58, backgroundColor: palette.c078e43 },
  search: {
    height: 49,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 15,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: palette.ce0e3e6,
    borderRadius: 16,
    backgroundColor: palette.cffffff,
    shadowColor: palette.c25372f,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    color: palette.c253348,
    fontSize: typography.mobile.rawSize.s14,
  },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: palette.ceaf7ee,
  },
  filterButtonPressed: {
    opacity: 0.48,
    backgroundColor: palette.ccdefd9,
    transform: [{ scale: 0.97 }],
  },
  filterButtonText: {
    color: GREEN,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.extrabold,
  },
  tabs: { flexDirection: "row", gap: 7, marginTop: 14 },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: palette.ce1e4e8,
    borderRadius: 16,
    backgroundColor: palette.cffffff,
  },
  tabActive: { borderColor: GREEN, backgroundColor: GREEN },
  tabText: {
    color: palette.c758092,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.bold,
  },
  tabTextActive: { color: palette.cffffff },
  smartCard: {
    minHeight: 67,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 17,
    marginBottom: 16,
    paddingHorizontal: 15,
    borderRadius: 16,
    backgroundColor: GREEN,
    shadowColor: GREEN,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 7,
    elevation: 3,
  },
  smartCardCopy: { flex: 1 },
  smartIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: palette.crgba_255_255_255_0_19,
  },
  smartTitle: {
    color: palette.cffffff,
    fontSize: typography.mobile.rawSize.s14,
    fontWeight: typography.weight.extrabold,
  },
  smartCopy: {
    marginTop: 3,
    color: palette.cdff8e8,
    fontSize: typography.mobile.rawSize.s10,
  },
  card: {
    overflow: "hidden",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: palette.ce5e5e3,
    borderRadius: 17,
    backgroundColor: palette.cffffff,
    shadowColor: palette.c34453d,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 7,
    elevation: 3,
  },
  cardPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.985 }],
    borderColor: palette.c9bd9b4,
  },
  hero: { height: 166, backgroundColor: palette.cdce8de },
  image: { width: "100%", height: "100%" },
  imageFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  foodEmoji: { fontSize: typography.mobile.rawSize.s58 },
  match: {
    position: "absolute",
    left: 11,
    top: 10,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 11,
    backgroundColor: GREEN,
  },
  matchText: {
    color: palette.cffffff,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.extrabold,
  },
  heart: {
    position: "absolute",
    right: 11,
    top: 10,
    width: 37,
    height: 37,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: palette.cffffff,
  },
  timeBadge: {
    position: "absolute",
    right: 10,
    bottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 11,
    backgroundColor: palette.crgba_27_29_31_0_73,
  },
  timeText: {
    color: palette.cffffff,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.bold,
  },
  cardBody: { padding: 15 },
  recipeTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  recipeTitle: {
    flex: 1,
    color: palette.c14233a,
    fontSize: typography.mobile.rawSize.s17,
    fontWeight: typography.weight.extrabold,
  },
  rating: {
    minHeight: 27,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 11,
    backgroundColor: palette.cfff7e8,
  },
  ratingText: {
    color: palette.c715629,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.black,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 9,
  },
  metaText: { color: palette.c8a95a5, fontSize: typography.mobile.rawSize.s10 },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9,
    color: palette.c798391,
    backgroundColor: palette.cf0f2f4,
    fontSize: typography.mobile.rawSize.s9,
    textTransform: "capitalize",
  },
  safety: {
    marginTop: 8,
    color: palette.ca16207,
    fontSize: typography.mobile.rawSize.s10,
  },
  actions: { flexDirection: "row", gap: 8, marginTop: 13 },
  scheduleButton: {
    flex: 1,
    height: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 13,
    backgroundColor: palette.cf4f5f6,
  },
  scheduleText: {
    color: palette.c344154,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.extrabold,
  },
  cookButton: {
    flex: 1,
    height: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 13,
    backgroundColor: GREEN,
  },
  cookText: {
    color: palette.cffffff,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.extrabold,
  },
  state: { alignItems: "center", paddingVertical: 45 },
  emptyIcon: { fontSize: typography.mobile.rawSize.s42 },
  emptyTitle: {
    marginTop: 10,
    color: palette.c294036,
    fontSize: typography.mobile.rawSize.s17,
    fontWeight: typography.weight.extrabold,
  },
  stateCopy: { marginTop: 7, color: palette.c7a8781, textAlign: "center" },
  retry: {
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: GREEN,
  },
  retryText: { color: palette.cffffff, fontWeight: typography.weight.bold },
});
const historyStyles = StyleSheet.create({
  editButton: {
    minWidth: 58,
    height: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: palette.cb9e2c8,
    borderRadius: 13,
    backgroundColor: palette.ceff9f2,
  },
  editText: {
    color: GREEN,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.extrabold,
  },
});
const cardTagStyles = StyleSheet.create({
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.bold,
    textTransform: "capitalize",
  },
  meal: { color: palette.c96621d, backgroundColor: palette.cfff0cf },
  dietary: { color: palette.c187a47, backgroundColor: palette.ce2f5e9 },
  custom: { color: palette.c66539b, backgroundColor: palette.ceee9f8 },
  more: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9,
    color: palette.c657080,
    backgroundColor: palette.ce9edf0,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.extrabold,
  },
});
const filterCountStyles = StyleSheet.create({
  badge: {
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 2,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: GREEN,
  },
  text: {
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.black,
  },
});
