import { apiBaseUrl } from "../../../lib/api-url";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, palette, typography } from "@ecochef/design-tokens";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../auth/auth-provider";
import { createMobileApi } from "../../../lib/api";
import type { RecipeDetail } from "../types";
import { PAGE_TOP_GAP } from "../../../shared/components/page-header";
import { ContentReportSheet } from "../../../shared/components/content-report-sheet";
import { AppMessageModal } from "../../../shared/components/app-message-modal";
import { goBackOrReplace } from "../../../shared/navigation";
import { ingredientEmojiFor } from "../../../shared/ingredient-icons";
import { recipeTagKind } from "../recipe-tag-options";
import { recipeImageUrl } from "../recipe-image";
import { recipeWarningGroups } from "../warning-groups";
import { ScheduleSheet } from "../components/schedule-sheet";
import type { MealPlanCalendar, MealPlanEntry, MealSlot } from "../../meal-planning/types";
import { dateToIso } from "../../meal-planning/components/date-picker-sheet";

const GREEN = palette.c19a95b;
const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process;

type InventoryList = { items: Array<{ name: string; expiry_date: string }> };
type CookFlow =
  | { kind: "confirm" }
  | { kind: "checking" }
  | { kind: "missing"; ingredients: string[] }
  | { kind: "deduction" }
  | { kind: "scheduling"; deductIngredients: boolean }
  | {
      kind: "scheduled";
      slot: MealSlot;
      time: string;
      deductIngredients: boolean;
    };
const normalizeIngredient = (value: string) => {
  const normalized = value
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized.length > 3 && normalized.endsWith("s") ? normalized.slice(0, -1) : normalized;
};
const fallbackMealSlot = (minutes: number): MealSlot =>
  minutes >= 300 && minutes < 660
    ? "breakfast"
    : minutes >= 660 && minutes < 1020
      ? "lunch"
      : "dinner";
const inferMealSlot = (items: MealPlanEntry[], minutes: number): MealSlot => {
  const timed = items
    .filter(
      (item): item is MealPlanEntry & { scheduled_time: string } =>
        Boolean(item.scheduled_time) && ["breakfast", "lunch", "dinner"].includes(item.meal_slot),
    )
    .map((item) => ({
      slot: item.meal_slot,
      time: Number(item.scheduled_time.slice(0, 2)) * 60 + Number(item.scheduled_time.slice(3, 5)),
    }))
    .sort((a, b) => a.time - b.time);
  if (!timed.length) return fallbackMealSlot(minutes);
  const next = timed.find((item) => item.time >= minutes);
  if (next) return next.slot;
  const latest = timed[timed.length - 1].slot;
  return latest === "breakfast" ? "lunch" : "dinner";
};

export function RecipeDetailScreen() {
  const { recipeId, cookNow } = useLocalSearchParams<{
    recipeId: string;
    cookNow?: string;
  }>();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [recipe, setRecipe] = useState<RecipeDetail>();
  const [imageFailed, setImageFailed] = useState(false);
  const [error, setError] = useState<string>();
  const [reportOpen, setReportOpen] = useState(false);
  const [flagReviewId, setFlagReviewId] = useState<string>();
  const [flagDescription, setFlagDescription] = useState("");
  const [flagging, setFlagging] = useState(false);
  const [feedback, setFeedback] = useState<{
    title: string;
    message: string;
    tone: "success" | "error" | "info";
  }>();
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewError, setReviewError] = useState<string>();
  const [reviewing, setReviewing] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [cookFlow, setCookFlow] = useState<CookFlow>();
  const cookLaunchHandledRef = useRef<string | undefined>(undefined);

  async function loadRecipe() {
    if (!recipeId) return;
    setError(undefined);
    try {
      const loaded = await api.getRecipe<RecipeDetail>(recipeId);
      setRecipe(loaded);
      if (loaded.my_feedback_status === "unverified") {
        setReviewRating(loaded.my_feedback_rating ?? 0);
        setReviewComment(loaded.my_feedback_comment ?? "");
      }
      setImageFailed(false);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Recipe details could not be loaded.",
      );
    }
  }

  useEffect(() => {
    void loadRecipe();
  }, [api, recipeId]);
  useEffect(
    () => navigation.addListener("focus", () => void loadRecipe()),
    [navigation, api, recipeId],
  );
  useEffect(() => {
    if (recipe && cookNow === "1" && cookLaunchHandledRef.current !== recipe.id) {
      cookLaunchHandledRef.current = recipe.id;
      setCookFlow({ kind: "confirm" });
    }
  }, [recipe, cookNow]);
  const loadPlannedMeals = useCallback(
    async (date: string) => (await api.getMyMealPlan<MealPlanCalendar>(date, 1)).items,
    [api],
  );

  async function toggleFavourite() {
    if (!recipe) return;
    const next = !recipe.is_favourite;
    setRecipe({ ...recipe, is_favourite: next });
    try {
      await api.setRecipeFavourite(recipe.id, next);
    } catch (nextError) {
      setRecipe((current) => (current ? { ...current, is_favourite: !next } : current));
      setFeedback({
        title: "Favourite not updated",
        message:
          nextError instanceof Error ? nextError.message : "The favourite could not be updated.",
        tone: "error",
      });
    }
  }

  async function shareRecipe() {
    if (!recipe) return;
    await Share.share({
      title: recipe.title,
      message: `${recipe.title}\n\n${recipe.summary ?? "A recipe shared from EcoChef."}\n\nIngredients: ${recipe.ingredients.map((item) => `${item.quantity} ${item.name}`).join(", ")}`,
    });
  }
  async function submitFeedbackFlag() {
    if (!recipe || !flagReviewId || flagging || flagDescription.trim().length < 10) return;
    setFlagging(true);
    try {
      await api.flagRecipeReview(recipe.id, flagReviewId, flagDescription.trim());
      setFlagReviewId(undefined);
      setFlagDescription("");
      await loadRecipe();
      setFeedback({
        title: "Feedback flagged",
        message:
          "A moderator will review your explanation. You and the reviewer will be told the outcome.",
        tone: "success",
      });
    } catch (reason) {
      setFeedback({
        title: "Flag not submitted",
        message: reason instanceof Error ? reason.message : "The feedback could not be flagged.",
        tone: "error",
      });
    } finally {
      setFlagging(false);
    }
  }
  async function submitReview() {
    if (!recipe || reviewing) return;
    if (!recipe.can_review) {
      setReviewError(
        recipe.review_eligibility_reason ??
          "Use Cook Now or schedule this recipe before reviewing it.",
      );
      return;
    }
    if (reviewRating < 1) {
      setReviewError("Choose a star rating before submitting.");
      return;
    }
    setReviewError(undefined);
    setReviewing(true);
    try {
      await api.reviewRecipe(recipe.id, {
        rating: reviewRating,
        comment: reviewComment.trim() || undefined,
      });
      await loadRecipe();
      setReviewRating(0);
      setReviewComment("");
      setFeedback({
        title: "Review submitted",
        message: "Your review has been added. Thank you for sharing your experience!",
        tone: "success",
      });
    } catch (nextError) {
      setReviewError(
        nextError instanceof Error ? nextError.message : "Your review could not be submitted.",
      );
    } finally {
      setReviewing(false);
    }
  }
  async function startCooking() {
    if (!recipe) return;
    setCookFlow({ kind: "checking" });
    try {
      await api.startRecipeCooking(recipe.id);
      setRecipe((current) =>
        current && (!current.my_feedback_status || current.my_feedback_status === "unverified")
          ? { ...current, can_review: true }
          : current,
      );
      const inventory = await api.getMyInventory<InventoryList>();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const available = new Set(
        inventory.items
          .filter((item) => new Date(item.expiry_date) >= todayStart)
          .map((item) => normalizeIngredient(item.name)),
      );
      const missing = recipe.ingredients
        .map((item) => item.name)
        .filter((name) => !available.has(normalizeIngredient(name)));
      if (missing.length) {
        setCookFlow({ kind: "missing", ingredients: missing });
        return;
      }
      setCookFlow({ kind: "deduction" });
    } catch (nextError) {
      setCookFlow(undefined);
      setFeedback({
        title: "Cook Now unavailable",
        message:
          nextError instanceof Error
            ? nextError.message
            : "EcoChef could not check your kitchen right now.",
        tone: "error",
      });
    }
  }
  async function addToTodayPlan(deductIngredients: boolean) {
    if (!recipe) return;
    setCookFlow({ kind: "scheduling", deductIngredients });
    try {
      const now = new Date();
      const scheduledDate = dateToIso(now);
      const scheduledTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const plan = await api.getMyMealPlan<MealPlanCalendar>(scheduledDate, 1);
      const slot = inferMealSlot(plan.items, now.getHours() * 60 + now.getMinutes());
      await api.scheduleRecipe(recipe.id, {
        scheduled_date: scheduledDate,
        meal_slot: slot,
        scheduled_time: scheduledTime,
      });
      setCookFlow({
        kind: "scheduled",
        slot,
        time: now.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        }),
        deductIngredients,
      });
    } catch (nextError) {
      setCookFlow(undefined);
      setFeedback({
        title: "Could not update today’s plan",
        message:
          nextError instanceof Error
            ? nextError.message
            : "EcoChef could not add this recipe to today’s plan.",
        tone: "error",
      });
    }
  }

  if (!recipe)
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        {error ? (
          <>
            <Text style={styles.errorTitle}>Unable to open recipe</Text>
            <Text style={styles.errorCopy}>{error}</Text>
            <Pressable style={styles.retry} onPress={() => void loadRecipe()}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator color={GREEN} />
            <Text style={styles.errorCopy}>Preparing recipe…</Text>
          </>
        )}
      </View>
    );

  const nutrition = Object.entries(recipe.nutrition)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .flatMap(([key, value]): [string, number][] =>
      key === "calories_kcal"
        ? [
            [key, value],
            ["total_calories_kcal", Math.round(value * (recipe.servings ?? 1))],
          ]
        : [[key, value]],
    );
  const orderedTags = [...recipe.dietary_tags].sort(
    (first, second) =>
      ({ meal: 0, dietary: 1, custom: 2 })[recipeTagKind(first)] -
      { meal: 0, dietary: 1, custom: 2 }[recipeTagKind(second)],
  );
  const allergyWarnings = recipe.safety_warnings.filter((warning) =>
    warning.startsWith("Contains "),
  );
  const warningGroups = recipeWarningGroups(recipe.safety_warnings);
  const matchedAllergens = new Set(
    allergyWarnings.map((warning) => warning.slice("Contains ".length).toLowerCase()),
  );
  const orderedAllergens = [...recipe.allergen_tags].sort(
    (first, second) =>
      Number(matchedAllergens.has(second.toLowerCase())) -
      Number(matchedAllergens.has(first.toLowerCase())),
  );
  const imageUrl = recipeImageUrl(recipe.image_url, apiBaseUrl);
  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
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
              <Text style={styles.emoji}>🍽️</Text>
            </View>
          )}
          <View style={[styles.topActions, { paddingTop: insets.top + PAGE_TOP_GAP }]}>
            <Pressable style={styles.circle} onPress={() => goBackOrReplace("/(tabs)/recipes")}>
              <Ionicons name="chevron-back" size={23} color={palette.c294036} />
            </Pressable>
            <View style={styles.rightActions}>
              {recipe.is_owner && (
                <Pressable
                  accessibilityLabel="Edit recipe"
                  style={styles.circle}
                  onPress={() =>
                    router.push({
                      pathname: "/recipes/[recipeId]/edit",
                      params: { recipeId: recipe.id },
                    })
                  }
                >
                  <Ionicons name="pencil-outline" size={21} color={palette.c294036} />
                </Pressable>
              )}
              <Pressable
                accessibilityLabel="Share recipe"
                style={styles.circle}
                onPress={() => void shareRecipe()}
              >
                <Ionicons name="share-social-outline" size={21} color={palette.c294036} />
              </Pressable>
              <Pressable
                accessibilityLabel="Report recipe"
                style={styles.circle}
                onPress={() => setReportOpen(true)}
              >
                <Ionicons name="flag-outline" size={21} color={palette.c294036} />
              </Pressable>
              <Pressable
                accessibilityLabel={
                  recipe.is_favourite ? "Remove from favourites" : "Add to favourites"
                }
                style={styles.circle}
                onPress={() => void toggleFavourite()}
              >
                <Ionicons
                  name={recipe.is_favourite ? "heart" : "heart-outline"}
                  size={23}
                  color={recipe.is_favourite ? palette.ce25252 : palette.c294036}
                />
              </Pressable>
            </View>
          </View>
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>{recipe.title}</Text>
          {(recipe.summary || recipe.cuisine) && (
            <Text style={styles.summary}>{recipe.summary ?? recipe.cuisine}</Text>
          )}
          <Text style={styles.author}>By {recipe.author_name}</Text>
          <View style={styles.tags}>
            {orderedTags.map((tag) => {
              const kind = recipeTagKind(tag);
              return (
                <Text
                  key={tag}
                  style={[
                    detailTagStyles.tag,
                    kind === "meal"
                      ? detailTagStyles.meal
                      : kind === "dietary"
                        ? detailTagStyles.dietary
                        : detailTagStyles.custom,
                  ]}
                >
                  {tag}
                </Text>
              );
            })}
          </View>
          {warningGroups.map((group) => (
            <View key={group.title} style={styles.alert}>
              <Ionicons name="warning-outline" size={22} color={palette.ca46100} />
              <View style={styles.alertBody}>
                <Text style={styles.alertTitle}>{group.title}</Text>
                {group.warnings.map((warning) => (
                  <Text key={warning} style={styles.alertCopy}>
                    • {warning}
                  </Text>
                ))}
              </View>
            </View>
          ))}
          <View style={styles.stats}>
            <Stat icon="time-outline" value={`${recipe.total_time} min`} label="Total" />
            <Stat icon="people-outline" value={`${recipe.servings ?? "-"} pax`} label="Servings" />
            <Stat icon="speedometer-outline" value={recipe.difficulty} label="Level" />
          </View>
          {nutrition.length > 0 && (
            <>
              <SectionTitle title="Nutrition" subtitle="Per serving + total" />
              <View style={nutritionStyles.grid}>
                {nutrition.map(([key, value]) => (
                  <NutritionTile key={key} name={key} value={value} />
                ))}
              </View>
            </>
          )}
          {recipe.allergen_tags.length > 0 && (
            <>
              <SectionTitle
                title="Allergens"
                subtitle={`${recipe.allergen_tags.length} declared`}
              />
              <View
                style={[
                  allergenDetailStyles.card,
                  allergyWarnings.length > 0 && allergenDetailStyles.cardWarning,
                ]}
              >
                <View style={allergenDetailStyles.tags}>
                  {orderedAllergens.map((allergen) => {
                    const matched = matchedAllergens.has(allergen.toLowerCase());
                    return (
                      <View
                        key={allergen}
                        style={[
                          allergenDetailStyles.tag,
                          matched && allergenDetailStyles.tagWarning,
                        ]}
                      >
                        <Ionicons
                          name="alert-circle-outline"
                          size={14}
                          color={matched ? palette.cc23f48 : GREEN}
                        />
                        <Text
                          style={[
                            allergenDetailStyles.tagText,
                            matched && allergenDetailStyles.tagTextWarning,
                          ]}
                        >
                          {allergen}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </>
          )}
          <SectionTitle title="Ingredients" subtitle={`${recipe.ingredients.length} items`} />
          {recipe.ingredients.map((ingredient) => (
            <View key={`${ingredient.name}-${ingredient.quantity}`} style={styles.ingredient}>
              <View style={styles.check}>
                <Text style={styles.ingredientEmoji}>
                  {ingredient.icon ?? ingredientEmojiFor(ingredient.name)}
                </Text>
              </View>
              <Text style={styles.ingredientName}>{ingredient.name}</Text>
              <Text style={styles.quantity}>{ingredient.quantity}</Text>
            </View>
          ))}
          <SectionTitle title="Directions" subtitle={`${recipe.instructions.length} steps`} />
          {recipe.instructions.map((instruction, index) => (
            <View key={`${index}-${instruction}`} style={styles.step}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{index + 1}</Text>
              </View>
              <Text style={styles.stepText}>{instruction}</Text>
            </View>
          ))}
          <SectionTitle
            title="Reviews"
            subtitle={recipe.reviews.length === 1 ? "1 review" : `${recipe.reviews.length} reviews`}
          />
          {!recipe.is_owner && !recipe.can_review ? (
            <View style={reviewStyles.form}>
              <Text style={reviewStyles.formTitle}>
                {recipe.my_feedback_status === "unverified"
                  ? "Earlier feedback saved privately"
                  : recipe.my_feedback_status
                    ? "Your feedback outcome"
                    : "Try this recipe before reviewing"}
              </Text>
              <Text style={reviewStyles.formCopy}>
                {recipe.review_eligibility_reason ??
                  "Use Cook Now or add this recipe to your schedule to unlock feedback."}
              </Text>
              {recipe.my_feedback_status ? (
                <Text style={reviewStyles.formCopy}>
                  {recipe.my_feedback_status === "pending"
                    ? "Awaiting moderation"
                    : recipe.my_feedback_status === "removed"
                      ? "Feedback removed"
                      : recipe.my_feedback_status === "unverified"
                        ? "Not included in public reviews or ratings"
                        : "Feedback kept"}
                  {recipe.my_feedback_resolution ? `: ${recipe.my_feedback_resolution}` : ""}
                </Text>
              ) : null}
            </View>
          ) : null}
          {!recipe.is_owner && recipe.can_review && recipe.my_feedback_status === "unverified" ? (
            <Text style={reviewStyles.formCopy}>
              Your earlier feedback is saved below. Review and resubmit it to publish it after your
              recorded cooking or scheduling action.
            </Text>
          ) : null}
          {!recipe.is_owner && recipe.can_review && (
            <View style={reviewStyles.form}>
              <View style={reviewStyles.formHeading}>
                <View>
                  <Text style={reviewStyles.formTitle}>Leave a review</Text>
                  <Text style={reviewStyles.formCopy}>
                    How was your experience with this recipe?
                  </Text>
                </View>
                <Ionicons name="chatbubble-ellipses-outline" size={22} color={GREEN} />
              </View>
              <View style={reviewStyles.ratingPicker}>
                {[1, 2, 3, 4, 5].map((rating) => (
                  <Pressable
                    key={rating}
                    accessibilityRole="button"
                    accessibilityLabel={`${rating} star${rating === 1 ? "" : "s"}`}
                    onPress={() => {
                      setReviewRating(rating);
                      setReviewError(undefined);
                    }}
                    hitSlop={5}
                  >
                    <Ionicons
                      name={rating <= reviewRating ? "star" : "star-outline"}
                      size={31}
                      color={rating <= reviewRating ? palette.cf5a623 : palette.caeb7b2}
                    />
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={reviewComment}
                onChangeText={setReviewComment}
                maxLength={500}
                multiline
                textAlignVertical="top"
                placeholder="Share what you liked or what could be improved (optional)"
                placeholderTextColor={palette.c98a39d}
                style={reviewStyles.input}
              />
              <View style={reviewStyles.formFooter}>
                <Text style={reviewStyles.counter}>{reviewComment.length}/500</Text>
                <Pressable
                  disabled={reviewing}
                  onPress={() => void submitReview()}
                  style={({ pressed }) => [
                    reviewStyles.submit,
                    (pressed || reviewing) && reviewStyles.submitPressed,
                  ]}
                >
                  {reviewing ? (
                    <ActivityIndicator size="small" color={palette.cfff} />
                  ) : (
                    <>
                      <Ionicons name="send-outline" size={16} color={palette.cfff} />
                      <Text style={reviewStyles.submitText}>Submit review</Text>
                    </>
                  )}
                </Pressable>
              </View>
              {reviewError && (
                <View style={reviewStyles.formError}>
                  <Ionicons name="alert-circle-outline" size={15} color={palette.cb42331} />
                  <Text style={reviewStyles.formErrorText}>{reviewError}</Text>
                </View>
              )}
            </View>
          )}
          {recipe.reviews.length > 0 ? (
            <View style={reviewStyles.card}>
              {recipe.reviews.map((review, index) => (
                <View
                  key={review.id}
                  style={[
                    reviewStyles.entry,
                    index < recipe.reviews.length - 1 && reviewStyles.entryBorder,
                  ]}
                >
                  <View style={reviewStyles.avatar}>
                    <Text style={reviewStyles.avatarText}>
                      {review.user_name.trim().charAt(0).toUpperCase() || "?"}
                    </Text>
                  </View>
                  <View style={reviewStyles.copy}>
                    <View style={reviewStyles.meta}>
                      <Text style={reviewStyles.name}>{review.user_name}</Text>
                      <Text style={reviewStyles.date}>
                        {new Date(review.date_submitted).toLocaleDateString()}
                      </Text>
                    </View>
                    <Text style={reviewStyles.stars}>
                      {"★".repeat(review.rating)}
                      <Text style={reviewStyles.emptyStars}>{"★".repeat(5 - review.rating)}</Text>
                    </Text>
                    {review.comment && <Text style={reviewStyles.comment}>{review.comment}</Text>}
                    {(recipe.is_owner || review.is_mine) && review.flag_status ? (
                      <Text style={reviewStyles.formCopy}>
                        {review.flag_status === "pending"
                          ? "Author flag awaiting moderator review"
                          : "Moderator kept this feedback"}
                        {review.flag_resolution ? `: ${review.flag_resolution}` : ""}
                      </Text>
                    ) : null}
                    {review.can_flag ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          setFlagReviewId(review.id);
                          setFlagDescription("");
                        }}
                      >
                        <Text style={reviewStyles.formCopy}>Flag inaccurate feedback</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={reviewStyles.empty}>
              <Ionicons name="chatbubble-ellipses-outline" size={23} color={palette.c8a958f} />
              <Text style={reviewStyles.emptyTitle}>No reviews yet</Text>
              <Text style={reviewStyles.emptyCopy}>
                Be the first to share your experience with this recipe.
              </Text>
            </View>
          )}
          {recipe.is_owner && recipe.edit_log.length > 0 && (
            <>
              <SectionTitle title="Edit History" subtitle={`${recipe.edit_log.length} recent`} />
              <View style={editHistoryStyles.card}>
                {recipe.edit_log.map((log, index) => (
                  <View
                    key={log.edited_at}
                    style={[
                      editHistoryStyles.entry,
                      index < recipe.edit_log.length - 1 && editHistoryStyles.entryBorder,
                    ]}
                  >
                    <View style={editHistoryStyles.marker}>
                      <Ionicons name="pencil-outline" size={14} color={GREEN} />
                    </View>
                    <View style={editHistoryStyles.copy}>
                      <Text style={editHistoryStyles.subjects}>{log.subjects.join(" · ")}</Text>
                      <Text style={editHistoryStyles.date}>
                        {new Date(log.edited_at).toLocaleString()}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>
      <View style={[bottomActionStyles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            bottomActionStyles.schedule,
            pressed && bottomActionStyles.pressed,
          ]}
          onPress={() => setScheduleOpen(true)}
        >
          <Ionicons name="calendar-outline" size={19} color={palette.c344154} />
          <Text style={bottomActionStyles.scheduleText}>Add to Schedule</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [bottomActionStyles.cook, pressed && bottomActionStyles.pressed]}
          onPress={() => setCookFlow({ kind: "confirm" })}
        >
          <MaterialCommunityIcons name="chef-hat" size={20} color={palette.cfff} />
          <Text style={bottomActionStyles.cookText}>Cook Now</Text>
        </Pressable>
      </View>
      <ContentReportSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        subjectType="recipe"
        subjectId={recipe.id}
        subjectName={recipe.title}
      />
      <Modal
        visible={!!flagReviewId}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!flagging) setFlagReviewId(undefined);
        }}
      >
        <View style={reportStyles.overlay}>
          <View style={reportStyles.card}>
            <Text style={reportStyles.title}>Flag inaccurate feedback</Text>
            <Text style={reportStyles.copy}>
              Explain the accusation and why you believe it is incorrect. The feedback stays visible
              until a moderator decides.
            </Text>
            <TextInput
              accessibilityLabel="Explanation for moderator"
              multiline
              maxLength={2000}
              value={flagDescription}
              onChangeText={setFlagDescription}
              style={reviewStyles.input}
              placeholder="Describe the inaccuracy in at least 10 characters"
              placeholderTextColor={colors.textSubtle}
            />
            <Pressable
              disabled={flagging || flagDescription.trim().length < 10}
              onPress={() => void submitFeedbackFlag()}
              style={[
                reportStyles.submit,
                (flagging || flagDescription.trim().length < 10) && reportStyles.submitDisabled,
              ]}
            >
              <Text style={reportStyles.submitText}>
                {flagging ? "Submitting…" : "Send to moderator"}
              </Text>
            </Pressable>
            <Pressable
              disabled={flagging}
              onPress={() => setFlagReviewId(undefined)}
              style={reportStyles.close}
            >
              <Text style={reviewStyles.formCopy}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <ScheduleSheet
        recipe={scheduleOpen ? recipe : undefined}
        loadPlannedMeals={loadPlannedMeals}
        onClose={() => setScheduleOpen(false)}
        onSave={async (date, meal, time, sharedGroupId) => {
          await api.scheduleRecipe(recipe.id, {
            scheduled_date: date,
            meal_slot: meal,
            scheduled_time: time,
            shared_group_id: sharedGroupId,
          });
          await loadRecipe();
        }}
        onSuccess={(message) =>
          setFeedback({ title: "Added to meal plan", message, tone: "success" })
        }
      />
      <CookNowModal
        flow={cookFlow}
        recipeTitle={recipe.title}
        onClose={() => setCookFlow(undefined)}
        onConfirm={() => void startCooking()}
        onDeductionChoice={(deduct) => void addToTodayPlan(deduct)}
        onSchedule={() => {
          setCookFlow(undefined);
          setScheduleOpen(true);
        }}
        onStartCooking={(deduct) => {
          setCookFlow(undefined);
          router.push({
            pathname: "/recipes/[recipeId]/cook",
            params: {
              recipeId: recipe.id,
              plannedDate: dateToIso(new Date()),
              deductIngredients: deduct ? "1" : "0",
            },
          });
        }}
      />
      <AppMessageModal
        visible={feedback !== undefined}
        title={feedback?.title ?? "EcoChef"}
        message={feedback?.message ?? ""}
        tone={feedback?.tone}
        onClose={() => setFeedback(undefined)}
      />
    </View>
  );
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={21} color={GREEN} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
    </View>
  );
}
function NutritionTile({ name, value }: { name: string; value: number; key?: string }) {
  const data: Record<
    string,
    {
      label: string;
      unit: string;
      icon: keyof typeof Ionicons.glyphMap;
      color: string;
      background: string;
    }
  > = {
    calories_kcal: {
      label: "Per serving",
      unit: "kcal",
      icon: "flame-outline",
      color: palette.cb66c24,
      background: palette.cfff0dd,
    },
    total_calories_kcal: {
      label: "Total recipe",
      unit: "kcal",
      icon: "restaurant-outline",
      color: palette.c23877f,
      background: palette.cddf4f2,
    },
    protein_g: {
      label: "Protein",
      unit: "g",
      icon: "fitness-outline",
      color: palette.c8a5bc4,
      background: palette.cf3ecfc,
    },
    carbohydrates_g: {
      label: "Carbs",
      unit: "g",
      icon: "restaurant-outline",
      color: palette.cc68a19,
      background: palette.cfff7df,
    },
    fat_g: {
      label: "Fat",
      unit: "g",
      icon: "water-outline",
      color: palette.c3d7fb1,
      background: palette.ceaf5fc,
    },
    fibre_g: {
      label: "Fibre",
      unit: "g",
      icon: "leaf-outline",
      color: GREEN,
      background: palette.ceaf7ee,
    },
  };
  const item = data[name] ?? {
    label: name.replaceAll("_", " "),
    unit: "",
    icon: "nutrition-outline" as const,
    color: GREEN,
    background: palette.ceaf7ee,
  };
  return (
    <View style={[nutritionStyles.tile, { backgroundColor: item.background }]}>
      <View style={[nutritionStyles.tileIcon, { backgroundColor: `${item.color}18` }]}>
        <Ionicons name={item.icon} size={17} color={item.color} />
      </View>
      <View>
        <Text style={[nutritionStyles.value, { color: item.color }]}>
          {value}
          <Text style={nutritionStyles.unit}> {item.unit}</Text>
        </Text>
        <Text style={nutritionStyles.label}>{item.label}</Text>
      </View>
    </View>
  );
}
function CookNowModal({
  flow,
  recipeTitle,
  onClose,
  onConfirm,
  onDeductionChoice,
  onSchedule,
  onStartCooking,
}: {
  flow?: CookFlow;
  recipeTitle: string;
  onClose: () => void;
  onConfirm: () => void;
  onDeductionChoice: (deduct: boolean) => void;
  onSchedule: () => void;
  onStartCooking: (deduct: boolean) => void;
}) {
  const missing = flow?.kind === "missing" ? flow.ingredients : [];
  const busy = flow?.kind === "checking" || flow?.kind === "scheduling";
  const title =
    flow?.kind === "confirm"
      ? "Cook this recipe now?"
      : flow?.kind === "checking"
        ? "Checking your kitchen…"
        : flow?.kind === "missing"
          ? "Ingredients are missing"
          : flow?.kind === "deduction"
            ? "Update ingredients after cooking?"
            : flow?.kind === "scheduling"
              ? "Adding to today’s plan…"
              : "Added to today’s plan";
  return (
    <Modal
      visible={flow !== undefined}
      transparent
      animationType="fade"
      onRequestClose={busy ? undefined : onClose}
    >
      <View style={cookFlowStyles.overlay}>
        <View style={cookFlowStyles.card}>
          <View
            style={[cookFlowStyles.icon, flow?.kind === "missing" && cookFlowStyles.warningIcon]}
          >
            {busy ? (
              <ActivityIndicator color={GREEN} />
            ) : (
              <MaterialCommunityIcons
                name={
                  flow?.kind === "missing"
                    ? "basket-remove-outline"
                    : flow?.kind === "deduction"
                      ? "basket-check-outline"
                      : "chef-hat"
                }
                size={27}
                color={flow?.kind === "missing" ? palette.cb66a22 : GREEN}
              />
            )}
          </View>
          <Text style={cookFlowStyles.title}>{title}</Text>
          {flow?.kind === "confirm" && (
            <Text style={cookFlowStyles.copy}>
              EcoChef will check whether your kitchen has everything required for {recipeTitle}.
            </Text>
          )}
          {flow?.kind === "checking" && (
            <Text style={cookFlowStyles.copy}>
              Reviewing the recipe ingredients and today’s meal plan.
            </Text>
          )}
          {flow?.kind === "deduction" && (
            <Text style={cookFlowStyles.copy}>
              Should EcoChef deduct compatible recipe quantities from your Ingredient List when you
              finish cooking?
            </Text>
          )}
          {flow?.kind === "scheduling" && (
            <Text style={cookFlowStyles.copy}>
              Assigning the best meal time and preparing Cooking Mode.
            </Text>
          )}
          {flow?.kind === "missing" && (
            <>
              <Text style={cookFlowStyles.copy}>You still need:</Text>
              <ScrollView
                style={cookFlowStyles.missingList}
                contentContainerStyle={cookFlowStyles.missingContent}
              >
                {missing.map((name) => (
                  <View key={name} style={cookFlowStyles.missingRow}>
                    <Ionicons name="close-circle-outline" size={16} color={palette.cb66a22} />
                    <Text style={cookFlowStyles.missingText}>{name}</Text>
                  </View>
                ))}
              </ScrollView>
              <Text style={cookFlowStyles.question}>Add this recipe to your schedule instead?</Text>
            </>
          )}
          {flow?.kind === "scheduled" && (
            <Text style={cookFlowStyles.copy}>
              {recipeTitle} was automatically added for{" "}
              <Text style={cookFlowStyles.strong}>
                {flow.slot.charAt(0).toUpperCase() + flow.slot.slice(1)}
              </Text>{" "}
              today at <Text style={cookFlowStyles.strong}>{flow.time}</Text>.
            </Text>
          )}
          {flow?.kind === "confirm" && (
            <>
              <Pressable style={cookFlowStyles.primary} onPress={onConfirm}>
                <Text style={cookFlowStyles.primaryText}>Check & cook now</Text>
              </Pressable>
              <Pressable style={cookFlowStyles.secondary} onPress={onClose}>
                <Text style={cookFlowStyles.secondaryText}>Not now</Text>
              </Pressable>
            </>
          )}
          {flow?.kind === "deduction" && (
            <>
              <Pressable style={cookFlowStyles.primary} onPress={() => onDeductionChoice(true)}>
                <Text style={cookFlowStyles.primaryText}>Automatically deduct ingredients</Text>
              </Pressable>
              <Pressable style={cookFlowStyles.secondary} onPress={() => onDeductionChoice(false)}>
                <Text style={cookFlowStyles.secondaryText}>View cooking mode only</Text>
              </Pressable>
              <Pressable style={cookFlowStyles.cancel} onPress={onClose}>
                <Text style={cookFlowStyles.cancelText}>Cancel cooking</Text>
              </Pressable>
            </>
          )}
          {flow?.kind === "missing" && (
            <>
              <Pressable style={cookFlowStyles.primary} onPress={onSchedule}>
                <Text style={cookFlowStyles.primaryText}>Add to schedule</Text>
              </Pressable>
              <Pressable style={cookFlowStyles.secondary} onPress={onClose}>
                <Text style={cookFlowStyles.secondaryText}>Not now</Text>
              </Pressable>
            </>
          )}
          {flow?.kind === "scheduled" && (
            <Pressable
              style={cookFlowStyles.primary}
              onPress={() => onStartCooking(flow.deductIngredients)}
            >
              <Text style={cookFlowStyles.primaryText}>Continue to cooking</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  scroll: { flex: 1 },
  content: { paddingBottom: 40 },
  hero: { height: 290, backgroundColor: palette.cddebdd },
  image: { width: "100%", height: "100%" },
  imageFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: typography.mobile.rawSize.s75 },
  topActions: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rightActions: { flexDirection: "row", gap: 9 },
  circle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.crgba_255_255_255_0_94,
  },
  body: { padding: 22 },
  cuisine: {
    color: GREEN,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.extrabold,
    letterSpacing: 1.2,
  },
  title: {
    marginTop: 6,
    color: palette.c19382c,
    fontSize: typography.mobile.rawSize.s30,
    lineHeight: 36,
    fontWeight: typography.weight.extrabold,
  },
  summary: {
    marginTop: 9,
    color: palette.c6f7d76,
    fontSize: typography.mobile.rawSize.s15,
    lineHeight: 22,
  },
  author: {
    marginTop: 9,
    color: palette.c3c5b4e,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.semibold,
  },
  stats: {
    flexDirection: "row",
    marginTop: 22,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.ce8ece9,
  },
  stat: { flex: 1, alignItems: "center" },
  statValue: {
    marginTop: 5,
    color: palette.c294036,
    fontSize: typography.mobile.rawSize.s14,
    fontWeight: typography.weight.extrabold,
    textTransform: "capitalize",
  },
  statLabel: {
    marginTop: 2,
    color: palette.c87928d,
    fontSize: typography.mobile.rawSize.s11,
  },
  alert: {
    flexDirection: "row",
    gap: 11,
    marginTop: 19,
    padding: 15,
    borderRadius: 15,
    backgroundColor: palette.cfff2d7,
  },
  alertBody: { flex: 1 },
  alertTitle: {
    color: palette.c7b4b09,
    fontSize: typography.mobile.rawSize.s14,
    fontWeight: typography.weight.extrabold,
  },
  alertCopy: {
    marginTop: 3,
    color: palette.c8d622a,
    fontSize: typography.mobile.rawSize.s12,
    lineHeight: 17,
  },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 16 },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 11,
    color: palette.c28734d,
    backgroundColor: palette.ce8f5ec,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.semibold,
    textTransform: "capitalize",
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 28,
    marginBottom: 12,
  },
  sectionTitle: {
    color: palette.c213a30,
    fontSize: typography.mobile.rawSize.s21,
    fontWeight: typography.weight.extrabold,
  },
  sectionSubtitle: {
    color: palette.c8a958f,
    fontSize: typography.mobile.rawSize.s12,
  },
  ingredient: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 49,
    borderBottomWidth: 1,
    borderColor: palette.cedf0ed,
  },
  check: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.ce8f5ec,
  },
  ingredientEmoji: {
    fontSize: typography.mobile.rawSize.s18,
    textAlign: "center",
  },
  ingredientName: {
    flex: 1,
    marginLeft: 11,
    color: palette.c3a4e45,
    fontSize: typography.mobile.rawSize.s14,
  },
  quantity: {
    color: palette.c6f7c75,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.semibold,
  },
  nutrition: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  nutritionItem: {
    minWidth: "29%",
    flexGrow: 1,
    padding: 12,
    borderRadius: 13,
    backgroundColor: palette.cf3f7f3,
  },
  nutritionValue: {
    color: palette.c24744b,
    fontSize: typography.mobile.rawSize.s17,
    fontWeight: typography.weight.extrabold,
  },
  nutritionLabel: {
    marginTop: 2,
    color: palette.c7d8983,
    fontSize: typography.mobile.rawSize.s10,
    textTransform: "capitalize",
  },
  step: { flexDirection: "row", gap: 13, marginBottom: 19 },
  stepNumber: {
    width: 31,
    height: 31,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GREEN,
  },
  stepNumberText: {
    color: palette.cffffff,
    fontWeight: typography.weight.extrabold,
  },
  stepText: {
    flex: 1,
    paddingTop: 4,
    color: palette.c4a5b53,
    fontSize: typography.mobile.rawSize.s14,
    lineHeight: 21,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: palette.cf6f8f4,
  },
  errorTitle: {
    color: palette.c294036,
    fontSize: typography.mobile.rawSize.s19,
    fontWeight: typography.weight.extrabold,
  },
  errorCopy: { marginTop: 9, color: palette.c77837d, textAlign: "center" },
  retry: {
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: GREEN,
  },
  retryText: { color: palette.cffffff, fontWeight: typography.weight.bold },
});
const reportStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: palette.crgba_20_35_58_44,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    padding: 20,
    borderRadius: 22,
    backgroundColor: palette.cfff,
  },
  heading: { flexDirection: "row", alignItems: "center", gap: 11 },
  icon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: palette.cfff0f0,
  },
  headingCopy: { flex: 1 },
  title: {
    color: palette.c1d342b,
    fontSize: typography.mobile.rawSize.s18,
    fontWeight: typography.weight.extrabold,
  },
  copy: {
    marginTop: 3,
    color: palette.c7a8781,
    fontSize: typography.mobile.rawSize.s12,
  },
  close: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: palette.cf1f3f2,
  },
  options: { gap: 8, marginTop: 18 },
  option: {
    height: 45,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: palette.ce2e6e3,
    borderRadius: 13,
    backgroundColor: palette.cf8f9f8,
  },
  optionActive: { borderColor: GREEN, backgroundColor: palette.cedf9f1 },
  optionText: {
    color: palette.c4b5b54,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.semibold,
  },
  optionTextActive: {
    color: palette.c168b4e,
    fontWeight: typography.weight.extrabold,
  },
  submit: {
    alignItems: "center",
    marginTop: 18,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: GREEN,
  },
  submitDisabled: { opacity: 0.45 },
  submitText: {
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.extrabold,
  },
  feedbackCard: {
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    padding: 24,
    borderRadius: 22,
    backgroundColor: palette.cfff,
  },
  successIcon: {
    width: 50,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 13,
    borderRadius: 25,
    backgroundColor: palette.ce7f7ed,
  },
  feedbackText: {
    marginTop: 8,
    color: palette.c68758a,
    fontSize: typography.mobile.rawSize.s13,
    lineHeight: 19,
    textAlign: "center",
  },
  done: {
    width: "100%",
    alignItems: "center",
    marginTop: 19,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: GREEN,
  },
});
const allergenDetailStyles = StyleSheet.create({
  card: {
    padding: 14,
    borderWidth: 1,
    borderColor: palette.ccde8d6,
    borderRadius: 16,
    backgroundColor: palette.cf1faf4,
  },
  cardWarning: {
    borderColor: palette.ce8d9c8,
    backgroundColor: palette.cfff9f1,
  },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: palette.cb9dec7,
    borderRadius: 11,
    backgroundColor: palette.cfff,
  },
  tagWarning: {
    borderColor: palette.ce69da3,
    backgroundColor: palette.cfff0f1,
  },
  tagText: {
    color: palette.c16834b,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.extrabold,
    textTransform: "capitalize",
  },
  tagTextWarning: { color: palette.cb42331 },
  warning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 13,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.cf0b5ba,
    borderRadius: 13,
    backgroundColor: palette.cfff0f1,
  },
  warningCopy: { flex: 1 },
  warningTitle: {
    color: palette.ca92835,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.black,
  },
  warningText: {
    marginTop: 4,
    color: palette.cb13d48,
    fontSize: typography.mobile.rawSize.s11,
    lineHeight: 16,
  },
});
const nutritionStyles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  tile: {
    width: "48%",
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderRadius: 15,
  },
  tileIcon: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
  },
  value: {
    fontSize: typography.mobile.rawSize.s16,
    fontWeight: typography.weight.black,
  },
  unit: {
    color: palette.c7a8580,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.bold,
  },
  label: {
    marginTop: 2,
    color: palette.c69766f,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.bold,
    textTransform: "capitalize",
  },
});
const reviewStyles = StyleSheet.create({
  form: {
    marginBottom: 14,
    padding: 15,
    borderWidth: 1,
    borderColor: palette.cdce9e1,
    borderRadius: 17,
    backgroundColor: palette.cf7fbf8,
  },
  formHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  formTitle: {
    color: palette.c294036,
    fontSize: typography.mobile.rawSize.s15,
    fontWeight: typography.weight.black,
  },
  formCopy: {
    marginTop: 3,
    color: palette.c7c8982,
    fontSize: typography.mobile.rawSize.s11,
  },
  ratingPicker: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginVertical: 16,
  },
  input: {
    minHeight: 92,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.cdce4df,
    borderRadius: 13,
    backgroundColor: palette.cfff,
    color: palette.c344b40,
    fontSize: typography.mobile.rawSize.s13,
    lineHeight: 19,
  },
  formFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
  },
  counter: { color: palette.c929d97, fontSize: typography.mobile.rawSize.s10 },
  submit: {
    minWidth: 132,
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 14,
    borderRadius: 13,
    backgroundColor: GREEN,
  },
  submitPressed: { opacity: 0.62 },
  submitText: {
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.black,
  },
  formError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
  },
  formErrorText: {
    flex: 1,
    color: palette.cb42331,
    fontSize: typography.mobile.rawSize.s11,
  },
  card: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.ce2eae5,
    borderRadius: 15,
    backgroundColor: palette.cffffff,
  },
  entry: { flexDirection: "row", gap: 11, padding: 14 },
  entryBorder: { borderBottomWidth: 1, borderBottomColor: palette.ce8ede9 },
  avatar: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: palette.ce3f5e9,
  },
  avatarText: {
    color: GREEN,
    fontSize: typography.mobile.rawSize.s14,
    fontWeight: typography.weight.black,
  },
  copy: { flex: 1 },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  name: {
    flex: 1,
    color: palette.c30483d,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.extrabold,
  },
  date: { color: palette.c909a95, fontSize: typography.mobile.rawSize.s10 },
  stars: {
    marginTop: 3,
    color: palette.cf5a623,
    fontSize: typography.mobile.rawSize.s14,
    letterSpacing: 1,
  },
  emptyStars: { color: palette.cdce2de },
  comment: {
    marginTop: 6,
    color: palette.c5f6f67,
    fontSize: typography.mobile.rawSize.s13,
    lineHeight: 19,
  },
  empty: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 22,
    borderWidth: 1,
    borderColor: palette.ce2eae5,
    borderRadius: 15,
    backgroundColor: palette.cf8faf8,
  },
  emptyTitle: {
    marginTop: 8,
    color: palette.c40544b,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.extrabold,
  },
  emptyCopy: {
    marginTop: 4,
    color: palette.c8a958f,
    fontSize: typography.mobile.rawSize.s11,
    lineHeight: 16,
    textAlign: "center",
  },
});
const editHistoryStyles = StyleSheet.create({
  card: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.ce2eae5,
    borderRadius: 15,
    backgroundColor: palette.cf7faf8,
  },
  entry: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  entryBorder: { borderBottomWidth: 1, borderBottomColor: palette.ce5ece7 },
  marker: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: palette.ce3f5e9,
  },
  copy: { flex: 1 },
  subjects: {
    color: palette.c30483d,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.extrabold,
  },
  date: {
    marginTop: 4,
    color: palette.c849088,
    fontSize: typography.mobile.rawSize.s10,
  },
});
const detailTagStyles = StyleSheet.create({
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 11,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.bold,
    textTransform: "capitalize",
  },
  meal: { color: palette.c96621d, backgroundColor: palette.cfff0cf },
  dietary: { color: palette.c187a47, backgroundColor: palette.ce2f5e9 },
  custom: { color: palette.c66539b, backgroundColor: palette.ceee9f8 },
});
const bottomActionStyles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    gap: 10,
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: palette.ce1e6e3,
    backgroundColor: palette.cfff,
    shadowColor: palette.c1e3429,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 10,
  },
  schedule: {
    flex: 1,
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: palette.cdde3df,
    borderRadius: 14,
    backgroundColor: palette.cf5f6f5,
  },
  scheduleText: {
    color: palette.c344154,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.black,
  },
  cook: {
    flex: 1,
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 14,
    backgroundColor: GREEN,
  },
  cookText: {
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.black,
  },
  pressed: { opacity: 0.68, transform: [{ scale: 0.985 }] },
});
const cookFlowStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: palette.crgba_20_35_30_48,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    padding: 23,
    borderRadius: 23,
    backgroundColor: palette.cfff,
    shadowColor: palette.c173c39,
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 9,
  },
  icon: {
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 27,
    backgroundColor: palette.ce7f7ed,
  },
  warningIcon: { backgroundColor: palette.cfff1e4 },
  title: {
    marginTop: 14,
    color: palette.c1d382c,
    fontSize: typography.mobile.rawSize.s19,
    fontWeight: typography.weight.black,
    textAlign: "center",
  },
  copy: {
    marginTop: 8,
    color: palette.c687a71,
    fontSize: typography.mobile.rawSize.s13,
    lineHeight: 19,
    textAlign: "center",
  },
  strong: { color: palette.c1d4935, fontWeight: typography.weight.black },
  missingList: { width: "100%", maxHeight: 150, marginTop: 11 },
  missingContent: { gap: 7 },
  missingRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: palette.cfff7ee,
  },
  missingText: {
    flex: 1,
    color: palette.c7c552e,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.bold,
  },
  question: {
    marginTop: 13,
    color: palette.c40564a,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.black,
    textAlign: "center",
  },
  primary: {
    width: "100%",
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 19,
    borderRadius: 13,
    backgroundColor: GREEN,
  },
  primaryText: {
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.black,
  },
  secondary: {
    width: "100%",
    height: 41,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 7,
    borderRadius: 13,
    backgroundColor: palette.ceef7f1,
  },
  secondaryText: {
    color: palette.c28704b,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.extrabold,
  },
  cancel: {
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 5,
    paddingHorizontal: 16,
  },
  cancelText: {
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.extrabold,
  },
});
