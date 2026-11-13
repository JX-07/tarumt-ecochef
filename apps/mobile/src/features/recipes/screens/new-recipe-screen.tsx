import { apiBaseUrl } from "../../../lib/api-url";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { colors, palette, typography } from "@ecochef/design-tokens";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomSheetSlide } from "../../../shared/hooks/use-bottom-sheet-slide";
import { useAuth } from "../../auth/auth-provider";
import { createMobileApi } from "../../../lib/api";
import { PAGE_TOP_GAP } from "../../../shared/components/page-header";
import { goBackOrReplace } from "../../../shared/navigation";
import type { RecipeDetail } from "../types";
import {
  dietaryIngredientIssues,
  recipeDietaryTags,
  recipeMealTypes,
  recipeTagKind,
} from "../recipe-tag-options";
import { recipeImageUrl } from "../recipe-image";

type Row = { name: string; amount: string; unit: string; customUnit: string };
type PageMessage = {
  title: string;
  message: string;
  icon: keyof typeof Ionicons.glyphMap;
};
type EstimateSession = {
  remaining: Row[];
  total: number;
  matched: number;
  measurable: number;
  skipped: number;
  autoFilled: number;
};
type AIEstimate = {
  caloriesPerServing: number;
  totalCalories: number;
  confidence: "low" | "medium" | "high";
  assumptions: string[];
};
const quantityUnits = ["g", "kg", "ml", "L", "pcs", "tbsp", "tsp", "cup", "bunch", "Custom"];
const kcalPer100: Record<string, number> = {
  chicken: 165,
  rice: 130,
  beef: 250,
  salmon: 208,
  tomato: 18,
  potato: 77,
  carrot: 41,
  spinach: 23,
  milk: 61,
  cheese: 402,
  flour: 364,
  sugar: 387,
  butter: 717,
  avocado: 160,
  onion: 40,
};
const kcalPerPiece: Record<string, number> = {
  egg: 72,
  banana: 105,
  apple: 95,
  bread: 80,
};
const allergenOptions = [
  "nuts",
  "peanuts",
  "tree nuts",
  "milk",
  "eggs",
  "wheat",
  "gluten",
  "soy",
  "fish",
  "shellfish",
  "sesame",
  "sulphites",
];
const nutTerms = [
  "nut",
  "nuts",
  "nut butter",
  "peanut",
  "groundnut",
  "almond",
  "cashew",
  "walnut",
  "pecan",
  "pistachio",
  "hazelnut",
  "macadamia",
  "brazil nut",
];
const allergenTerms: Record<string, string[]> = {
  nuts: nutTerms,
  peanuts: ["peanut", "groundnut"],
  "tree nuts": [
    "almond",
    "cashew",
    "walnut",
    "pecan",
    "pistachio",
    "hazelnut",
    "macadamia",
    "brazil nut",
  ],
  milk: ["milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "whey", "casein", "ghee"],
  eggs: ["egg", "eggs", "mayonnaise", "mayo"],
  wheat: ["wheat", "flour", "bread", "pasta", "couscous", "semolina"],
  gluten: ["wheat", "flour", "bread", "pasta", "barley", "rye", "couscous", "semolina"],
  soy: ["soy", "soya", "tofu", "tempeh", "edamame", "miso"],
  fish: ["fish", "salmon", "tuna", "cod", "sardine", "anchovy", "mackerel", "trout"],
  shellfish: ["prawn", "shrimp", "crab", "lobster", "mussel", "oyster", "scallop", "clam"],
  sesame: ["sesame", "tahini"],
  sulphites: ["sulphite", "sulfite"],
};
const dietaryAllergenConflicts: Record<string, string[]> = {
  "nut-free": ["nuts", "peanuts", "tree nuts"],
  "dairy-free": ["milk"],
  "gluten-free": ["wheat", "gluten"],
  vegan: ["milk", "eggs", "fish", "shellfish"],
  vegetarian: ["fish", "shellfish"],
};
function detectAllergens(names: string[]) {
  const normalized = names.map(
    (name) =>
      ` ${name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()} `,
  );
  return allergenOptions.filter((allergen) =>
    allergenTerms[allergen].some((term) =>
      normalized.some((name) => {
        if (
          allergen === "milk" &&
          (/ (almond|soy|soya|oat|coconut|rice|cashew) milk /.test(name) ||
            / (peanut|almond|cashew|nut) butter /.test(name))
        )
          return false;
        if (
          (allergen === "wheat" || allergen === "gluten") &&
          / (almond|rice|coconut|corn|chickpea|oat) flour /.test(name)
        )
          return false;
        return name.includes(` ${term} `) || (!term.endsWith("s") && name.includes(` ${term}s `));
      }),
    ),
  );
}
const GREEN = palette.c12ad55;
const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process;

export function NewRecipeScreen() {
  const { recipeId } = useLocalSearchParams<{ recipeId?: string }>();
  const editing = Boolean(recipeId);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [photo, setPhoto] = useState<string>();
  const [published, setPublished] = useState(false);
  const [reviews, setReviews] = useState(true);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [calories, setCalories] = useState("0");
  const [caloriesEdited, setCaloriesEdited] = useState(false);
  const [estimateCoverage, setEstimateCoverage] = useState<string>();
  const [minutes, setMinutes] = useState("");
  const [prepMinutes, setPrepMinutes] = useState("");
  const [servings, setServings] = useState("2");
  const [tag, setTag] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [ingredients, setIngredients] = useState<Row[]>([
    { name: "", amount: "", unit: "g", customUnit: "" },
  ]);
  const [allergenTags, setAllergenTags] = useState<string[]>([]);
  const previousDetectedAllergens = useRef<string[]>([]);
  const [unitPicker, setUnitPicker] = useState<number>();
  const unitSheetMotion = useBottomSheetSlide(unitPicker !== undefined);
  const [steps, setSteps] = useState([""]);
  const [saving, setSaving] = useState(false);
  const [pageMessage, setPageMessage] = useState<PageMessage>();
  const [estimateSession, setEstimateSession] = useState<EstimateSession>();
  const [manualCalories, setManualCalories] = useState<string[]>([]);
  const [aiEstimating, setAiEstimating] = useState(false);
  const [aiEstimate, setAiEstimate] = useState<AIEstimate>();
  const detectedAllergens = useMemo(
    () => detectAllergens(ingredients.map((item) => item.name)),
    [ingredients],
  );
  const allergenChoices = useMemo(
    () => Array.from(new Set([...allergenOptions, ...allergenTags])),
    [allergenTags],
  );
  useEffect(() => {
    const previous = previousDetectedAllergens.current;
    setAllergenTags((current) =>
      Array.from(
        new Set([
          ...current.filter((item) => !previous.includes(item) || detectedAllergens.includes(item)),
          ...detectedAllergens.filter((item) => !previous.includes(item)),
        ]),
      ),
    );
    const invalidDietary = tags.filter((tag) =>
      (dietaryAllergenConflicts[tag] ?? []).some((item) => detectedAllergens.includes(item)),
    );
    if (invalidDietary.length) {
      setTags((current) => current.filter((tag) => !invalidDietary.includes(tag)));
      setPageMessage({
        title: "Dietary tag removed",
        message: `${invalidDietary.map((tag) => tag.replace(/(^|-)(\w)/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`)).join(", ")} no longer matches the ingredients because a conflicting allergen was detected.`,
        icon: "warning-outline",
      });
    }
    previousDetectedAllergens.current = detectedAllergens;
  }, [detectedAllergens]);
  useEffect(() => {
    if (!recipeId) return;
    void api
      .getRecipe<RecipeDetail>(recipeId)
      .then((recipe) => {
        if (!recipe.is_owner) {
          setPageMessage({
            title: "Editing unavailable",
            message: "Only the recipe owner can edit this recipe.",
            icon: "lock-closed-outline",
          });
          return;
        }
        setPhoto(recipeImageUrl(recipe.image_url, apiBaseUrl));
        setPublished(recipe.is_published);
        setTitle(recipe.title);
        setSummary(recipe.summary ?? "");
        setCalories(
          recipe.nutrition.calories_kcal === undefined
            ? ""
            : String(recipe.nutrition.calories_kcal),
        );
        setCaloriesEdited(recipe.nutrition.calories_kcal !== undefined);
        setMinutes(String(recipe.cook_time ?? recipe.total_time));
        setPrepMinutes(String(recipe.prep_time ?? 0));
        setServings(String(recipe.servings ?? 2));
        const firstMeal = recipe.dietary_tags.find((item) => recipeTagKind(item) === "meal");
        setTags(
          recipe.dietary_tags
            .filter((item) => recipeTagKind(item) !== "meal")
            .concat(firstMeal ? [firstMeal] : []),
        );
        setAllergenTags(recipe.allergen_tags);
        setSteps(recipe.instructions);
        setIngredients(
          recipe.ingredients.map((item) => {
            const match = item.quantity.trim().match(/^(.+?)\s+([^\s]+)$/);
            const amount = match?.[1] ?? item.quantity;
            const parsedUnit = match?.[2] ?? "pcs";
            return quantityUnits.includes(parsedUnit)
              ? { name: item.name, amount, unit: parsedUnit, customUnit: "" }
              : {
                  name: item.name,
                  amount,
                  unit: "Custom",
                  customUnit: parsedUnit,
                };
          }),
        );
      })
      .catch((error) =>
        setPageMessage({
          title: "Could not load recipe",
          message: error instanceof Error ? error.message : "Please try again.",
          icon: "cloud-offline-outline",
        }),
      );
  }, [api, recipeId]);
  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (!result.canceled) setPhoto(result.assets[0].uri);
  }
  function addTag() {
    const next = tag.trim().toLowerCase();
    if (next && !tags.includes(next)) {
      if (recipeTagKind(next) === "dietary") toggleDietaryTag(next);
      else
        setTags((current) =>
          recipeTagKind(next) === "meal"
            ? [...current.filter((item) => recipeTagKind(item) !== "meal"), next]
            : [...current, next],
        );
    }
    setTag("");
  }
  function toggleMealTag(label: string) {
    const value = label.toLowerCase();
    setTags((current) => {
      const withoutMeals = current.filter((item) => recipeTagKind(item) !== "meal");
      return current.includes(value) ? withoutMeals : [...withoutMeals, value];
    });
  }
  function toggleDietaryTag(label: string) {
    const value = label.toLowerCase();
    if (tags.includes(value)) {
      setTags((current) => current.filter((item) => item !== value));
      return;
    }
    const ingredientIssue = dietaryIngredientIssues(
      [value],
      ingredients.map((item) => item.name),
    )[0];
    const conflictingAllergens = allergenTags.filter((item) =>
      (dietaryAllergenConflicts[value] ?? []).includes(item),
    );
    if (ingredientIssue || conflictingAllergens.length) {
      setPageMessage({
        title: "Tag does not match",
        message:
          ingredientIssue ??
          `${label} cannot be selected while ${conflictingAllergens.join(", ")} ${conflictingAllergens.length === 1 ? "is" : "are"} marked as a possible allergen. Review the ingredients and allergen selections first.`,
        icon: "warning-outline",
      });
      return;
    }
    setTags((current) => [...current, value]);
  }
  function toggleAllergen(item: string) {
    if (allergenTags.includes(item)) {
      setAllergenTags((current) => current.filter((value) => value !== item));
      return;
    }
    const conflictingTags = tags.filter((tag) =>
      (dietaryAllergenConflicts[tag] ?? []).includes(item),
    );
    if (conflictingTags.length) {
      setPageMessage({
        title: "Allergen conflicts with dietary tag",
        message: `${item.replace(/^\w/, (letter) => letter.toUpperCase())} cannot be selected while ${conflictingTags.join(", ")} ${conflictingTags.length === 1 ? "is" : "are"} selected. Remove the dietary tag first if this recipe may contain the allergen.`,
        icon: "warning-outline",
      });
      return;
    }
    setAllergenTags((current) => [...current, item]);
  }
  function finishEstimate(total: number, matched: number, measurable: number, skipped: number) {
    if (!matched) {
      setPageMessage({
        title: "Estimate cancelled",
        message:
          "No calorie values were added. Enter calories manually or try the estimator again.",
        icon: "information-circle-outline",
      });
      return;
    }
    const portions = Math.max(1, Number(servings) || 1);
    const perServing = Math.round(total / portions);
    const coverage = Math.round((matched / Math.max(1, measurable)) * 100);
    setCalories(String(perServing));
    setCaloriesEdited(true);
    setEstimateCoverage(
      `${matched} of ${measurable} ingredients included (${coverage}% coverage)${skipped ? ` · ${skipped} skipped` : ""}`,
    );
    setPageMessage({
      title: "Approximate estimate",
      message: `About ${perServing} kcal per serving (${Math.round(total)} kcal for the full recipe). ${matched} of ${measurable} measured ingredients were included.`,
      icon: "sparkles-outline",
    });
  }
  function estimateCalories() {
    const measurable = ingredients.filter((item) => item.name.trim() && Number(item.amount) > 0);
    if (!measurable.length) {
      setPageMessage({
        title: "Add ingredient amounts",
        message: "Enter at least one ingredient and its quantity before estimating calories.",
        icon: "information-circle-outline",
      });
      return;
    }
    let autoFilled = 0;
    const values = measurable.map((item) => {
      const name = item.name.toLowerCase();
      const amount = Number(item.amount);
      const piece = Object.entries(kcalPerPiece).find(([key]) => name.includes(key));
      if (piece && item.unit === "pcs") {
        autoFilled++;
        return String(Math.round(piece[1] * amount));
      }
      const density = Object.entries(kcalPer100).find(([key]) => name.includes(key));
      const base =
        item.unit === "kg" || item.unit === "L"
          ? amount * 1000
          : item.unit === "g" || item.unit === "ml"
            ? amount
            : 0;
      if (density && base) {
        autoFilled++;
        return String(Math.round((density[1] * base) / 100));
      }
      return "";
    });
    setManualCalories(values);
    setEstimateSession({
      remaining: measurable,
      total: 0,
      matched: 0,
      measurable: measurable.length,
      skipped: 0,
      autoFilled,
    });
  }
  function completeManualEstimate() {
    if (!estimateSession) return;
    const entered = manualCalories.map((value) => (Number(value) > 0 ? Number(value) : 0));
    const included = entered.filter((value) => value > 0).length;
    const manualTotal = entered.reduce((sum, value) => sum + value, 0);
    setEstimateSession(undefined);
    setManualCalories([]);
    finishEstimate(
      estimateSession.total + manualTotal,
      estimateSession.matched + included,
      estimateSession.measurable,
      estimateSession.remaining.length - included,
    );
  }
  async function estimateCaloriesWithAI() {
    const usable = ingredients.filter((item) => item.name.trim() && item.amount.trim());
    if (!usable.length) {
      setPageMessage({
        title: "Add ingredients first",
        message: "Enter at least one ingredient and quantity before requesting an AI estimate.",
        icon: "information-circle-outline",
      });
      return;
    }
    if (Number(servings) <= 0) {
      setPageMessage({
        title: "Add servings first",
        message: "Enter a valid number of servings before requesting an AI estimate.",
        icon: "information-circle-outline",
      });
      return;
    }
    setAiEstimating(true);
    try {
      const result = await api.estimateRecipeCalories<{
        calories_per_serving: number;
        total_calories: number;
        confidence: "low" | "medium" | "high";
        assumptions: string[];
      }>({
        ingredients: usable.map((item) => ({
          name: item.name,
          quantity: `${item.amount} ${item.unit === "Custom" ? item.customUnit : item.unit}`,
        })),
        servings: Number(servings),
      });
      setCalories(String(result.calories_per_serving));
      setCaloriesEdited(true);
      setEstimateCoverage(`Gemini estimate · ${result.confidence} confidence`);
      setAiEstimate({
        caloriesPerServing: result.calories_per_serving,
        totalCalories: result.total_calories,
        confidence: result.confidence,
        assumptions: result.assumptions.slice(0, 6),
      });
    } catch (error) {
      setPageMessage({
        title: "AI estimate unavailable",
        message:
          error instanceof Error
            ? error.message
            : "Gemini could not calculate this recipe right now.",
        icon: "cloud-offline-outline",
      });
    } finally {
      setAiEstimating(false);
    }
  }
  async function publish() {
    if (
      !prepMinutes.trim() ||
      !minutes.trim() ||
      !Number.isInteger(Number(prepMinutes)) ||
      !Number.isInteger(Number(minutes)) ||
      Number(prepMinutes) < 0 ||
      Number(minutes) < 0 ||
      Number(prepMinutes) > 1440 ||
      Number(minutes) > 1440 ||
      Number(prepMinutes) + Number(minutes) <= 0
    ) {
      setPageMessage({
        title: "Add preparation and cooking time",
        message:
          "Enter both times as whole minutes, from 0 to 1,440 each. Use 0 if no preparation or cooking is needed. Total time must be at least 1 minute.",
        icon: "alert-circle-outline",
      });
      return;
    }
    if (
      !photo ||
      title.trim().length < 2 ||
      Number(servings) <= 0 ||
      ingredients.some(
        (item) =>
          !item.name.trim() ||
          !item.amount.trim() ||
          (item.unit === "Custom" && !item.customUnit.trim()),
      ) ||
      steps.some((step) => !step.trim())
    ) {
      setPageMessage({
        title: "Complete required fields",
        message:
          "Add a photo, title, positive servings, ingredient amounts and units, and cooking steps.",
        icon: "alert-circle-outline",
      });
      return;
    }
    const dietaryIssues = dietaryIngredientIssues(
      tags,
      ingredients.map((item) => item.name),
    );
    if (dietaryIssues.length) {
      setPageMessage({
        title: "Check dietary tags",
        message: `The ingredients do not match the selected dietary filters:\n\n• ${dietaryIssues.join("\n• ")}`,
        icon: "warning-outline",
      });
      return;
    }
    const recipeIngredients = ingredients.map((item) => ({
      name: item.name,
      quantity: `${item.amount} ${item.unit === "Custom" ? item.customUnit : item.unit}`,
    }));
    setSaving(true);
    try {
      const validation = await api.validateRecipeIngredients<{ issues: string[] }>(
        recipeIngredients,
        Number(servings),
      );
      if (validation.issues.length) {
        setPageMessage({
          title: "Check ingredient amounts",
          message: validation.issues.join("\n\n"),
          icon: "alert-circle-outline",
        });
        return;
      }
      let imageUrl = photo;
      if (!/^https?:\/\//i.test(photo)) {
        const data = await FileSystem.readAsStringAsync(photo, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const extension = photo.split("?")[0].split(".").pop()?.toLowerCase();
        const contentType =
          extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
        const uploaded = await api.uploadRecipeImage<{ image_url: string }>({
          data,
          content_type: contentType,
        });
        imageUrl = uploaded.image_url;
      }
      const payload = {
        title,
        summary: summary || undefined,
        image_url: imageUrl,
        instructions: steps,
        ingredients: recipeIngredients,
        prep_time: Number(prepMinutes),
        cook_time: Number(minutes),
        servings: Number(servings),
        dietary_tags: tags,
        allergen_tags: allergenTags,
        nutrition: { calories_kcal: Number(calories) || undefined },
        is_published: published,
      };
      if (editing && recipeId) await api.updateRecipe(recipeId, payload);
      else await api.createRecipe(payload);
      goBackOrReplace("/(tabs)/recipes");
    } catch (error) {
      setPageMessage({
        title: editing ? "Could not save changes" : "Could not publish recipe",
        message: error instanceof Error ? error.message : "Please try again.",
        icon: "cloud-offline-outline",
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + PAGE_TOP_GAP }]}>
        <Pressable style={styles.back} onPress={() => goBackOrReplace("/(tabs)/recipes")}>
          <Ionicons name="chevron-back" size={22} color={palette.c647084} />
        </Pressable>
        <Text style={styles.headerTitle}>{editing ? "Edit Recipe" : "New Recipe"}</Text>
        <Pressable disabled={saving} style={styles.publish} onPress={() => void publish()}>
          <Text style={styles.publishText}>
            {saving ? "Saving…" : editing ? "Save" : "Publish"}
          </Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable style={styles.photo} onPress={() => void pickPhoto()}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.photoImage} />
          ) : (
            <>
              <Ionicons name="camera-outline" size={30} color={palette.c94a0b2} />
              <Text style={styles.photoTitle}>Add Photo*</Text>
              <Text style={styles.photoCopy}>Required</Text>
            </>
          )}
        </Pressable>
        <View style={styles.settings}>
          <Setting
            icon={published ? "globe-outline" : "lock-closed-outline"}
            title={published ? "Public Recipe" : "Private Recipe"}
            copy={published ? "Anyone can discover this recipe" : "Only visible to you"}
            value={published}
            onChange={setPublished}
          />
          <View style={styles.divider} />
          <Setting
            icon="people-outline"
            title="Allow User Reviews"
            copy="Let others rate and comment"
            value={reviews}
            onChange={setReviews}
          />
        </View>
        <Label text="BASIC INFO" />
        <Field value={title} onChangeText={setTitle} placeholder="Recipe Title*" />
        <TextInput
          value={summary}
          onChangeText={setSummary}
          placeholder="Description (optional)"
          placeholderTextColor={palette.c949caa}
          multiline
          style={[styles.field, styles.description]}
        />
        <Label text="PREPARATION & COOKING" />
        <View style={styles.metrics}>
          <Metric
            label="Preparation time *"
            value={prepMinutes}
            onChange={(value) => {
              if (/^\d*$/.test(value)) setPrepMinutes(value);
            }}
            placeholder="0"
            suffix="min"
          />
          <Metric
            label="Cooking time *"
            value={minutes}
            onChange={(value) => {
              if (/^\d*$/.test(value)) setMinutes(value);
            }}
            placeholder="0"
            suffix="min"
          />
        </View>
        <View style={styles.totalTimeRow}>
          <Ionicons name="time-outline" size={20} color={colors.primaryStrong} />
          <Text style={styles.totalTimeText}>
            Total time:{" "}
            {prepMinutes.trim() && minutes.trim()
              ? `${Number(prepMinutes) + Number(minutes)} min`
              : "Enter both times"}
          </Text>
        </View>
        <Text style={styles.timeHint}>
          Include chopping and mixing in preparation. Enter 0 for cooking time if the recipe needs
          no cooking.
        </Text>
        <View style={styles.tagRow}>
          <TextInput
            value={tag}
            onChangeText={setTag}
            onSubmitEditing={addTag}
            placeholder="Add custom tag…"
            placeholderTextColor={palette.c949caa}
            style={[styles.field, styles.tagInput]}
          />
          <Pressable style={styles.plus} onPress={addTag}>
            <Ionicons name="add" size={24} color={palette.cfff} />
          </Pressable>
        </View>
        {tags.some((item) => recipeTagKind(item) === "custom") && (
          <View style={styles.tags}>
            {tags
              .filter((item) => recipeTagKind(item) === "custom")
              .map((item) => (
                <Pressable
                  key={item}
                  onPress={() => setTags((current) => current.filter((value) => value !== item))}
                  style={[tagChoiceStyles.selected, tagChoiceStyles.customSelected]}
                >
                  <Text style={[tagChoiceStyles.selectedText, tagChoiceStyles.customSelectedText]}>
                    {item}
                  </Text>
                  <Ionicons name="close" size={12} color={palette.c6b58a5} />
                </Pressable>
              ))}
          </View>
        )}
        <Text style={tagChoiceStyles.label}>MEAL TYPE · CHOOSE ONE</Text>
        <View style={tagChoiceStyles.options}>
          {recipeMealTypes.map(([emoji, label]) => {
            const active = tags.includes(label.toLowerCase());
            return (
              <Pressable
                key={label}
                onPress={() => toggleMealTag(label)}
                style={[
                  tagChoiceStyles.option,
                  tagChoiceStyles.mealOption,
                  active && tagChoiceStyles.mealOptionActive,
                ]}
              >
                <Text
                  style={[tagChoiceStyles.optionText, active && tagChoiceStyles.optionTextActive]}
                >
                  {emoji} {label}
                </Text>
                {active && <Ionicons name="checkmark" size={13} color={palette.cfff} />}
              </Pressable>
            );
          })}
        </View>
        <Text style={tagChoiceStyles.label}>DIETARY · CHOOSE MULTIPLE</Text>
        <View style={tagChoiceStyles.options}>
          {recipeDietaryTags.map(([emoji, label]) => {
            const active = tags.includes(label.toLowerCase());
            return (
              <Pressable
                key={label}
                onPress={() => toggleDietaryTag(label)}
                style={[
                  tagChoiceStyles.option,
                  tagChoiceStyles.dietaryOption,
                  active && tagChoiceStyles.dietaryOptionActive,
                ]}
              >
                <Text
                  style={[tagChoiceStyles.optionText, active && tagChoiceStyles.optionTextActive]}
                >
                  {emoji} {label}
                </Text>
                {active && <Ionicons name="checkmark" size={13} color={palette.cfff} />}
              </Pressable>
            );
          })}
        </View>
        <Label text="INGREDIENTS*" />
        <View style={styles.columns}>
          <Text style={styles.column}>INGREDIENT</Text>
          <Text style={styles.amountColumn}>AMOUNT & UNIT*</Text>
        </View>
        {ingredients.map((item, index) => (
          <View key={index}>
            <View style={styles.ingredientRow}>
              <TextInput
                value={item.name}
                onChangeText={(value) =>
                  setIngredients(
                    ingredients.map((row, i) => (i === index ? { ...row, name: value } : row)),
                  )
                }
                placeholder={`Ingredient ${index + 1}`}
                style={[styles.field, styles.ingredientName]}
              />
              <TextInput
                value={item.amount}
                onChangeText={(value) =>
                  setIngredients(
                    ingredients.map((row, i) => (i === index ? { ...row, amount: value } : row)),
                  )
                }
                placeholder="200"
                keyboardType="decimal-pad"
                style={[styles.field, styles.amount]}
              />
              <Pressable style={styles.unitButton} onPress={() => setUnitPicker(index)}>
                <Text style={styles.unitText}>
                  {item.unit === "Custom" ? item.customUnit || "Custom" : item.unit}
                </Text>
                <Ionicons name="chevron-down" size={14} color={palette.c697588} />
              </Pressable>
            </View>
            {item.unit === "Custom" && (
              <TextInput
                value={item.customUnit}
                onChangeText={(value) =>
                  setIngredients(
                    ingredients.map((row, i) =>
                      i === index ? { ...row, customUnit: value } : row,
                    ),
                  )
                }
                placeholder="Enter custom unit"
                style={[styles.field, styles.customUnit]}
              />
            )}
          </View>
        ))}
        <Pressable
          style={styles.addLine}
          onPress={() =>
            setIngredients([...ingredients, { name: "", amount: "", unit: "g", customUnit: "" }])
          }
        >
          <Ionicons name="add" size={18} color={GREEN} />
          <Text style={styles.addLineText}>Add Ingredient</Text>
        </Pressable>
        <View style={allergenStyles.card}>
          <View style={allergenStyles.heading}>
            <View style={allergenStyles.icon}>
              <Ionicons name="warning-outline" size={19} color={palette.cb66a22} />
            </View>
            <View style={styles.flex}>
              <Text style={allergenStyles.title}>Review allergens</Text>
              <Text style={allergenStyles.copy}>
                Confirm the system suggestions, then review the complete allergen list.
              </Text>
            </View>
          </View>
          <Text style={allergenStyles.sectionLabel}>POSSIBLE ALLERGENS</Text>
          {detectedAllergens.length > 0 ? (
            <>
              <Text style={allergenStyles.sectionCopy}>
                Automatically suggested from the recipe ingredients.
              </Text>
              <View style={allergenStyles.options}>
                {detectedAllergens.map((item) => {
                  const active = allergenTags.includes(item);
                  return (
                    <Pressable
                      key={`possible-${item}`}
                      onPress={() => toggleAllergen(item)}
                      style={[
                        allergenStyles.option,
                        allergenStyles.optionDetected,
                        active && allergenStyles.optionActive,
                      ]}
                    >
                      <Text
                        style={[
                          allergenStyles.optionText,
                          active && allergenStyles.optionTextActive,
                        ]}
                      >
                        {item}
                      </Text>
                      {active && <Ionicons name="checkmark" size={13} color={palette.cfff} />}
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : (
            <Text style={allergenStyles.none}>
              No common allergens were detected from the ingredients.
            </Text>
          )}
          <View style={allergenStyles.sectionDivider} />
          <Text style={allergenStyles.sectionLabel}>ALL ALLERGENS</Text>
          <Text style={allergenStyles.sectionCopy}>
            The selections below stay synchronized with the possible allergens above.
          </Text>
          <View style={allergenStyles.options}>
            {allergenChoices.map((item) => {
              const active = allergenTags.includes(item);
              return (
                <Pressable
                  key={item}
                  onPress={() => toggleAllergen(item)}
                  style={[allergenStyles.option, active && allergenStyles.optionActive]}
                >
                  <Text
                    style={[allergenStyles.optionText, active && allergenStyles.optionTextActive]}
                  >
                    {item}
                  </Text>
                  {active && <Ionicons name="checkmark" size={13} color={palette.cfff} />}
                </Pressable>
              );
            })}
          </View>
        </View>
        <Label text="RECIPE DETAILS" />
        <View style={styles.metrics}>
          <Metric
            label="Calories (approx.)"
            value={calories}
            onChange={(value) => {
              setCalories(value);
              setCaloriesEdited(true);
              setEstimateCoverage(undefined);
            }}
            onFocus={() => {
              if (!caloriesEdited) setCalories("");
            }}
            placeholder="0"
            suffix="kcal"
          />
          <Metric
            label="Servings"
            value={servings}
            onChange={(value) => {
              if (value === "" || (/^\d+$/.test(value) && Number(value) > 0)) setServings(value);
            }}
            placeholder="2"
            suffix="pax"
          />
        </View>
        <View style={estimateActionStyles.actions}>
          <Pressable
            style={[styles.estimateButton, estimateActionStyles.manualButton]}
            onPress={estimateCalories}
          >
            <Ionicons name="calculator-outline" size={17} color={GREEN} />
            <Text style={styles.estimateText}>Calculate the calories one-by-one</Text>
          </Pressable>
          <Pressable
            disabled={aiEstimating}
            style={[estimateActionStyles.aiButton, aiEstimating && estimateActionStyles.disabled]}
            onPress={() => void estimateCaloriesWithAI()}
          >
            <Ionicons name="sparkles" size={17} color={palette.cfff} />
            <Text style={estimateActionStyles.aiText}>
              {aiEstimating ? "Gemini is estimating…" : "Use AI to perform Calories Estimation"}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.estimateNote}>
          Calories are approximate and may vary by ingredient brand, preparation method, and portion
          size.
        </Text>
        {estimateCoverage && <Text style={styles.coverageText}>{estimateCoverage}</Text>}
        <Label text="COOKING STEPS*" />
        {steps.map((step, index) => (
          <View key={index} style={styles.stepRow}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>{index + 1}</Text>
            </View>
            <TextInput
              value={step}
              onChangeText={(value) => setSteps(steps.map((row, i) => (i === index ? value : row)))}
              placeholder={`Step ${index + 1}…`}
              multiline
              style={[styles.field, styles.stepInput]}
            />
          </View>
        ))}
        <Pressable style={styles.addLine} onPress={() => setSteps([...steps, ""])}>
          <Ionicons name="add" size={18} color={GREEN} />
          <Text style={styles.addLineText}>Add Step</Text>
        </Pressable>
      </ScrollView>
      <Modal
        visible={unitPicker !== undefined}
        transparent
        animationType="fade"
        onRequestClose={() => setUnitPicker(undefined)}
      >
        <Pressable style={styles.unitOverlay} onPress={() => setUnitPicker(undefined)}>
          <Animated.View style={[styles.unitSheet, unitSheetMotion]}>
            <Text style={styles.unitTitle}>Choose quantity unit</Text>
            <View style={styles.unitGrid}>
              {quantityUnits.map((unit) => (
                <Pressable
                  key={unit}
                  style={[
                    styles.unitOption,
                    unitPicker !== undefined &&
                      ingredients[unitPicker]?.unit === unit &&
                      styles.unitOptionActive,
                  ]}
                  onPress={() => {
                    if (unitPicker !== undefined)
                      setIngredients(
                        ingredients.map((row, i) => (i === unitPicker ? { ...row, unit } : row)),
                      );
                    setUnitPicker(undefined);
                  }}
                >
                  <Text
                    style={[
                      styles.unitOptionText,
                      unitPicker !== undefined &&
                        ingredients[unitPicker]?.unit === unit &&
                        styles.unitOptionTextActive,
                    ]}
                  >
                    {unit}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Animated.View>
        </Pressable>
      </Modal>
      <Modal
        visible={estimateSession !== undefined}
        transparent
        animationType="fade"
        onRequestClose={() => setEstimateSession(undefined)}
      >
        <View style={dialogStyles.overlay}>
          <View style={[dialogStyles.card, calorieDialogStyles.card]}>
            <View style={dialogStyles.icon}>
              <Ionicons name="calculator-outline" size={27} color={GREEN} />
            </View>
            <Text style={dialogStyles.title}>Review ingredient calories</Text>
            <Text style={dialogStyles.message}>
              Every ingredient is listed below. Review the suggested values, add missing ones, or
              leave a field empty to skip it.
            </Text>
            <ScrollView
              style={calorieDialogStyles.list}
              contentContainerStyle={calorieDialogStyles.listContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {estimateSession?.remaining.map((item, index) => (
                <View key={`${item.name}-${index}`} style={calorieDialogStyles.row}>
                  <View style={calorieDialogStyles.rowCopy}>
                    <Text style={calorieDialogStyles.ingredientName}>{item.name}</Text>
                    <Text style={calorieDialogStyles.quantity}>
                      {item.amount} {item.unit === "Custom" ? item.customUnit : item.unit}
                    </Text>
                  </View>
                  <View style={calorieDialogStyles.inputWrap}>
                    <TextInput
                      value={manualCalories[index] ?? ""}
                      onChangeText={(value) => {
                        if (value === "" || /^\d*\.?\d*$/.test(value))
                          setManualCalories((current) =>
                            current.map((entry, i) => (i === index ? value : entry)),
                          );
                      }}
                      keyboardType="decimal-pad"
                      placeholder="—"
                      placeholderTextColor={palette.ca3aba6}
                      style={calorieDialogStyles.input}
                    />
                    <Text style={calorieDialogStyles.suffix}>kcal</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={calorieDialogStyles.total}>
              <View>
                <Text style={calorieDialogStyles.totalLabel}>CURRENT RECIPE TOTAL</Text>
                <Text style={calorieDialogStyles.totalHint}>
                  {estimateSession?.autoFilled ?? 0} of {estimateSession?.measurable ?? 0} values
                  prefilled automatically
                </Text>
              </View>
              <Text style={calorieDialogStyles.totalValue}>
                {Math.round(
                  manualCalories.reduce(
                    (sum, value) => sum + (Number(value) > 0 ? Number(value) : 0),
                    0,
                  ),
                )}{" "}
                kcal
              </Text>
            </View>
            <Pressable style={dialogStyles.button} onPress={completeManualEstimate}>
              <Text style={dialogStyles.buttonText}>Use this estimate</Text>
            </Pressable>
            <Pressable
              style={calorieDialogStyles.cancelButton}
              onPress={() => {
                setEstimateSession(undefined);
                setManualCalories([]);
              }}
            >
              <Text style={calorieDialogStyles.cancelText}>Cancel estimate</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        visible={aiEstimate !== undefined}
        transparent
        animationType="fade"
        onRequestClose={() => setAiEstimate(undefined)}
      >
        <View style={dialogStyles.overlay}>
          <View style={aiResultStyles.card}>
            <View style={aiResultStyles.header}>
              <View style={aiResultStyles.icon}>
                <Ionicons name="sparkles" size={23} color={palette.cfff} />
              </View>
              <View style={aiResultStyles.headerCopy}>
                <Text style={aiResultStyles.eyebrow}>GEMINI ESTIMATE</Text>
                <Text style={aiResultStyles.title}>Calories calculated</Text>
              </View>
              <Pressable style={aiResultStyles.close} onPress={() => setAiEstimate(undefined)}>
                <Ionicons name="close" size={19} color={palette.c657267} />
              </Pressable>
            </View>
            <View style={aiResultStyles.hero}>
              <Text style={aiResultStyles.heroValue}>{aiEstimate?.caloriesPerServing}</Text>
              <Text style={aiResultStyles.heroUnit}>kcal per serving</Text>
            </View>
            <View style={aiResultStyles.summary}>
              <View style={aiResultStyles.summaryItem}>
                <Text style={aiResultStyles.summaryLabel}>RECIPE TOTAL</Text>
                <Text style={aiResultStyles.summaryValue}>{aiEstimate?.totalCalories} kcal</Text>
              </View>
              <View style={aiResultStyles.divider} />
              <View style={aiResultStyles.summaryItem}>
                <Text style={aiResultStyles.summaryLabel}>CONFIDENCE</Text>
                <Text style={aiResultStyles.confidence}>
                  {aiEstimate?.confidence.toUpperCase()}
                </Text>
              </View>
            </View>
            {Boolean(aiEstimate?.assumptions.length) && (
              <View style={aiResultStyles.assumptions}>
                <Text style={aiResultStyles.assumptionTitle}>What Gemini assumed</Text>
                <ScrollView
                  style={aiResultStyles.assumptionList}
                  showsVerticalScrollIndicator={false}
                >
                  {aiEstimate?.assumptions.map((assumption, index) => (
                    <View key={`${index}-${assumption}`} style={aiResultStyles.assumptionRow}>
                      <View style={aiResultStyles.bullet} />
                      <Text style={aiResultStyles.assumptionText}>{assumption}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}
            <Text style={aiResultStyles.disclaimer}>
              This is an approximation and may vary by brand and preparation.
            </Text>
            <Pressable style={aiResultStyles.done} onPress={() => setAiEstimate(undefined)}>
              <Text style={aiResultStyles.doneText}>Use this estimate</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        visible={pageMessage !== undefined}
        transparent
        animationType="fade"
        onRequestClose={() => setPageMessage(undefined)}
      >
        <View style={dialogStyles.overlay}>
          <View style={dialogStyles.card}>
            <View style={dialogStyles.icon}>
              <Ionicons
                name={pageMessage?.icon ?? "information-circle-outline"}
                size={27}
                color={GREEN}
              />
            </View>
            <Text style={dialogStyles.title}>{pageMessage?.title}</Text>
            <Text style={dialogStyles.message}>{pageMessage?.message}</Text>
            <Pressable style={dialogStyles.button} onPress={() => setPageMessage(undefined)}>
              <Text style={dialogStyles.buttonText}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
function Setting({
  icon,
  title,
  copy,
  value,
  onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  copy: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.setting}>
      <View style={styles.settingIcon}>
        <Ionicons name={icon} size={18} color={value ? GREEN : palette.c99a4b3} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingCopy}>{copy}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: palette.cdde1e7, true: GREEN }}
        thumbColor={palette.cfff}
      />
    </View>
  );
}
function Label({ text }: { text: string }) {
  return <Text style={[styles.label, { marginTop: 34, marginBottom: 12 }]}>{text}</Text>;
}
function Field(props: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  return <TextInput {...props} placeholderTextColor={palette.c949caa} style={styles.field} />;
}
function Metric({
  label,
  value,
  onChange,
  onFocus,
  placeholder,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  placeholder: string;
  suffix: string;
}) {
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const invalid = touched && !value.trim();
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={[styles.metricField, invalid && styles.metricFieldInvalid]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            setTouched(true);
          }}
          caretHidden={focused && !value}
          placeholder={focused || touched ? "" : placeholder}
          keyboardType="number-pad"
          placeholderTextColor={palette.c949caa}
          selectionColor={GREEN}
          style={styles.metricInput}
        />
        {focused && !value && <View pointerEvents="none" style={styles.centeredCaret} />}
        <Text style={styles.metricSuffix}>{suffix}</Text>
      </View>
      {invalid && <Text style={styles.metricError}>Required</Text>}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  header: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderColor: palette.ce5e6e3,
    backgroundColor: palette.cfff,
  },
  back: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: palette.cf2f4f5,
  },
  headerTitle: {
    color: palette.c14233a,
    fontSize: typography.mobile.rawSize.s20,
    fontWeight: typography.weight.extrabold,
  },
  publish: {
    paddingHorizontal: 17,
    paddingVertical: 10,
    borderRadius: 13,
    backgroundColor: GREEN,
  },
  publishText: {
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.extrabold,
  },
  content: { padding: 20, paddingBottom: 50 },
  photo: {
    height: 275,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: palette.ccfd5dc,
    borderRadius: 17,
    backgroundColor: palette.ce9ecf0,
  },
  photoImage: { width: "100%", height: "100%", borderRadius: 17 },
  photoTitle: {
    marginTop: 10,
    color: palette.c8b97a9,
    fontWeight: typography.weight.bold,
  },
  photoCopy: {
    marginTop: 5,
    color: palette.ca5aebc,
    fontSize: typography.mobile.rawSize.s11,
  },
  settings: {
    marginTop: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: palette.ce1e3e1,
    borderRadius: 17,
    backgroundColor: palette.cfff,
  },
  setting: { flexDirection: "row", alignItems: "center", gap: 10 },
  settingIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: palette.ceef8f1,
  },
  flex: { flex: 1 },
  settingTitle: {
    color: palette.c344154,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.extrabold,
  },
  settingCopy: {
    marginTop: 2,
    color: palette.c97a1af,
    fontSize: typography.mobile.rawSize.s10,
  },
  divider: { height: 1, marginVertical: 12, backgroundColor: palette.ceceeec },
  label: {
    marginTop: 22,
    marginBottom: 9,
    color: palette.c68758a,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.extrabold,
    letterSpacing: 0.7,
  },
  field: {
    height: 45,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: palette.ce1e4e8,
    borderRadius: 14,
    backgroundColor: palette.cf5f6f7,
    color: palette.c344154,
    fontSize: typography.mobile.rawSize.s13,
  },
  description: {
    height: 78,
    marginTop: 10,
    paddingTop: 13,
    textAlignVertical: "top",
  },
  metrics: { flexDirection: "row", gap: 8, marginTop: 11 },
  totalTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
  },
  totalTimeText: {
    color: colors.primaryStrong,
    fontSize: typography.mobile.size.bodyInteraction,
    fontWeight: typography.weight.semibold,
  },
  timeHint: {
    marginTop: 8,
    color: colors.textMuted,
    fontSize: typography.mobile.size.secondaryInteraction,
    lineHeight: 20,
  },
  metric: { flex: 1 },
  metricLabel: {
    minHeight: 24,
    marginBottom: 5,
    color: colors.textMuted,
    fontSize: typography.mobile.size.secondaryInteraction,
    fontWeight: typography.weight.bold,
    textAlign: "center",
  },
  metricField: {
    height: 45,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.ce1e4e8,
    borderRadius: 14,
    backgroundColor: palette.cf5f6f7,
  },
  metricFieldInvalid: {
    borderColor: palette.ce05252,
    backgroundColor: palette.cfff7f7,
  },
  metricInput: {
    height: 43,
    paddingHorizontal: 22,
    color: palette.c344154,
    fontSize: typography.mobile.rawSize.s13,
    textAlign: "center",
    textAlignVertical: "center",
  },
  metricError: {
    marginTop: 4,
    color: palette.cd43f3f,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.bold,
    textAlign: "center",
  },
  centeredCaret: {
    position: "absolute",
    left: "50%",
    width: 1.5,
    height: 18,
    marginLeft: -0.75,
    backgroundColor: GREEN,
  },
  metricSuffix: {
    position: "absolute",
    right: 8,
    color: palette.c929caa,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.semibold,
  },
  estimateButton: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 11,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: palette.ce8f7ed,
  },
  estimateText: {
    color: GREEN,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.extrabold,
  },
  estimateNote: {
    marginTop: 7,
    color: palette.c8a95a5,
    fontSize: typography.mobile.rawSize.s9,
    lineHeight: 13,
    textAlign: "center",
  },
  coverageText: {
    marginTop: 5,
    color: GREEN,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.bold,
    textAlign: "center",
  },
  tagRow: { flexDirection: "row", gap: 8, marginTop: 11 },
  tagInput: { flex: 1 },
  plus: {
    width: 45,
    height: 45,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: GREEN,
  },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  tag: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
    color: palette.c0e9e4f,
    backgroundColor: palette.ce5f6eb,
    fontSize: typography.mobile.rawSize.s10,
  },
  columns: { flexDirection: "row", paddingHorizontal: 4 },
  column: {
    flex: 1,
    color: palette.c8b96a7,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.extrabold,
  },
  amountColumn: {
    width: 151,
    color: palette.c8b96a7,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.extrabold,
  },
  ingredientRow: { flexDirection: "row", gap: 7, marginTop: 8 },
  ingredientName: { flex: 1 },
  amount: { width: 62, paddingHorizontal: 5, textAlign: "center" },
  unitButton: {
    width: 82,
    height: 45,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: palette.ce1e4e8,
    borderRadius: 14,
    backgroundColor: palette.cf5f6f7,
  },
  unitText: {
    flex: 1,
    color: palette.c475467,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.bold,
  },
  customUnit: { alignSelf: "flex-end", width: 151, marginTop: 7 },
  addLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 12,
  },
  addLineText: {
    color: GREEN,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.extrabold,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 10,
  },
  stepNumber: {
    width: 25,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    borderRadius: 13,
    backgroundColor: palette.cd8f2e1,
  },
  stepNumberText: {
    color: GREEN,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.extrabold,
  },
  stepInput: { flex: 1, height: 60, paddingTop: 12, textAlignVertical: "top" },
  unitOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: palette.crgba_24_28_26_38,
  },
  unitSheet: {
    padding: 20,
    paddingBottom: 34,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: palette.cfff,
  },
  unitTitle: {
    color: palette.c14233a,
    fontSize: typography.mobile.rawSize.s18,
    fontWeight: typography.weight.extrabold,
  },
  unitGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 16 },
  unitOption: {
    width: "30%",
    alignItems: "center",
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: palette.cdfe3e7,
    borderRadius: 13,
    backgroundColor: palette.cf7f8f9,
  },
  unitOptionActive: { borderColor: GREEN, backgroundColor: palette.ce5f6eb },
  unitOptionText: {
    color: palette.c566275,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.bold,
  },
  unitOptionTextActive: { color: GREEN },
});
const dialogStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    backgroundColor: palette.crgba_20_35_58_42,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    padding: 24,
    borderRadius: 24,
    backgroundColor: palette.cfff,
    shadowColor: palette.c14233a,
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
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
  title: {
    marginTop: 15,
    color: palette.c14233a,
    fontSize: typography.mobile.rawSize.s19,
    fontWeight: typography.weight.extrabold,
    textAlign: "center",
  },
  message: {
    marginTop: 8,
    color: palette.c68758a,
    fontSize: typography.mobile.rawSize.s13,
    lineHeight: 19,
    textAlign: "center",
  },
  button: {
    width: "100%",
    alignItems: "center",
    marginTop: 21,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: GREEN,
  },
  buttonText: {
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s14,
    fontWeight: typography.weight.extrabold,
  },
});
const calorieDialogStyles = StyleSheet.create({
  card: { maxHeight: "86%" },
  list: { width: "100%", maxHeight: 300, marginTop: 15 },
  listContent: { gap: 8, paddingBottom: 3 },
  row: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 9,
    borderWidth: 1,
    borderColor: palette.ce2e7e3,
    borderRadius: 14,
    backgroundColor: palette.cf8faf8,
  },
  rowCopy: { flex: 1 },
  ingredientName: {
    color: palette.c20392f,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.extrabold,
  },
  quantity: {
    marginTop: 3,
    color: GREEN,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.bold,
  },
  inputWrap: {
    width: 108,
    height: 40,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.cdde3df,
    borderRadius: 11,
    backgroundColor: palette.cfff,
  },
  input: {
    height: 38,
    paddingLeft: 9,
    paddingRight: 34,
    color: palette.c253348,
    fontSize: typography.mobile.rawSize.s13,
    textAlign: "center",
  },
  suffix: {
    position: "absolute",
    right: 8,
    color: palette.c849087,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.bold,
  },
  total: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 14,
    padding: 13,
    borderRadius: 14,
    backgroundColor: palette.ceaf7ee,
  },
  totalLabel: {
    color: palette.c277549,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.black,
    letterSpacing: 0.5,
  },
  totalHint: {
    maxWidth: 185,
    marginTop: 3,
    color: palette.c6d8477,
    fontSize: typography.mobile.rawSize.s9,
  },
  totalValue: {
    color: GREEN,
    fontSize: typography.mobile.rawSize.s17,
    fontWeight: typography.weight.black,
  },
  cancelButton: { marginTop: 12, paddingVertical: 5 },
  cancelText: {
    color: palette.c7f8997,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.bold,
  },
});
const estimateActionStyles = StyleSheet.create({
  actions: { alignItems: "stretch", gap: 8, marginTop: 11 },
  manualButton: {
    alignSelf: "stretch",
    justifyContent: "center",
    marginTop: 0,
    minHeight: 39,
  },
  aiButton: {
    minHeight: 39,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 13,
    backgroundColor: GREEN,
    shadowColor: GREEN,
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  disabled: { opacity: 0.62 },
  aiText: {
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.extrabold,
    textAlign: "center",
  },
});
const allergenStyles = StyleSheet.create({
  card: {
    marginTop: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: palette.ce7d9c8,
    borderRadius: 17,
    backgroundColor: palette.cfff9f0,
  },
  heading: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: palette.cffebcf,
  },
  title: {
    color: palette.c5c4024,
    fontSize: typography.mobile.rawSize.s14,
    fontWeight: typography.weight.black,
  },
  copy: {
    marginTop: 3,
    color: palette.c89735d,
    fontSize: typography.mobile.rawSize.s10,
    lineHeight: 14,
  },
  sectionLabel: {
    marginTop: 17,
    color: palette.c8a5928,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.black,
    letterSpacing: 0.7,
  },
  sectionCopy: {
    marginTop: 4,
    color: palette.c918173,
    fontSize: typography.mobile.rawSize.s9,
    lineHeight: 13,
  },
  sectionDivider: {
    height: 1,
    marginTop: 18,
    backgroundColor: palette.ceadfd2,
  },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 11 },
  option: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: palette.cdccfc0,
    borderRadius: 14,
    backgroundColor: palette.cfff,
  },
  optionDetected: {
    borderColor: palette.cd69a5a,
    backgroundColor: palette.cfff8ee,
  },
  optionActive: {
    borderColor: palette.cc87a2a,
    backgroundColor: palette.cc87a2a,
  },
  optionText: {
    color: palette.c6e6257,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.extrabold,
    textTransform: "capitalize",
  },
  optionTextActive: { color: palette.cfff },
  none: {
    marginTop: 9,
    color: palette.c8e8175,
    fontSize: typography.mobile.rawSize.s9,
    lineHeight: 14,
  },
});
const tagChoiceStyles = StyleSheet.create({
  label: {
    marginTop: 13,
    marginBottom: 8,
    color: palette.c7a8697,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.extrabold,
    letterSpacing: 0.6,
  },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  option: {
    minHeight: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 14,
  },
  mealOption: {
    borderColor: palette.ce9d7b7,
    backgroundColor: palette.cfff9ec,
  },
  mealOptionActive: {
    borderColor: palette.cd99a37,
    backgroundColor: palette.cd99a37,
  },
  dietaryOption: {
    borderColor: palette.ccfe7d7,
    backgroundColor: palette.cf2faf4,
  },
  dietaryOptionActive: { borderColor: GREEN, backgroundColor: GREEN },
  optionText: {
    color: palette.c536173,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.bold,
  },
  optionTextActive: { color: palette.cfff },
  selected: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 11,
  },
  selectedText: {
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.bold,
    textTransform: "capitalize",
  },
  mealSelected: { backgroundColor: palette.cfff0cf },
  mealSelectedText: { color: palette.c9a651c },
  dietarySelected: { backgroundColor: palette.ce5f6eb },
  dietarySelectedText: { color: palette.c0e8b4a },
  customSelected: { backgroundColor: palette.cf0ebfa },
  customSelectedText: { color: palette.c6b58a5 },
});
const aiResultStyles = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 370,
    maxHeight: "84%",
    padding: 21,
    borderRadius: 24,
    backgroundColor: palette.cfff,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 11 },
  icon: {
    width: 43,
    height: 43,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: GREEN,
  },
  headerCopy: { flex: 1 },
  eyebrow: {
    color: GREEN,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.black,
    letterSpacing: 0.9,
  },
  title: {
    marginTop: 2,
    color: palette.c173429,
    fontSize: typography.mobile.rawSize.s18,
    fontWeight: typography.weight.black,
  },
  close: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: palette.cf0f3f1,
  },
  hero: {
    alignItems: "center",
    marginTop: 19,
    paddingVertical: 17,
    borderRadius: 18,
    backgroundColor: palette.ceaf8ef,
  },
  heroValue: {
    color: GREEN,
    fontSize: typography.mobile.rawSize.s40,
    lineHeight: 44,
    fontWeight: typography.weight.black,
  },
  heroUnit: {
    marginTop: 2,
    color: palette.c537263,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.bold,
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 11,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: palette.ce4e9e5,
    borderRadius: 15,
  },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryLabel: {
    color: palette.c8a958f,
    fontSize: typography.mobile.rawSize.s8,
    fontWeight: typography.weight.black,
    letterSpacing: 0.7,
  },
  summaryValue: {
    marginTop: 4,
    color: palette.c31473d,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.extrabold,
  },
  confidence: {
    marginTop: 4,
    color: GREEN,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.black,
  },
  divider: { width: 1, height: 30, backgroundColor: palette.ce1e6e2 },
  assumptions: { marginTop: 15 },
  assumptionTitle: {
    color: palette.c33483f,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.black,
  },
  assumptionList: { maxHeight: 128, marginTop: 7 },
  assumptionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 7,
  },
  bullet: {
    width: 6,
    height: 6,
    marginTop: 6,
    borderRadius: 3,
    backgroundColor: GREEN,
  },
  assumptionText: {
    flex: 1,
    color: palette.c68776f,
    fontSize: typography.mobile.rawSize.s11,
    lineHeight: 16,
  },
  disclaimer: {
    marginTop: 9,
    color: palette.c929b96,
    fontSize: typography.mobile.rawSize.s9,
    lineHeight: 13,
    textAlign: "center",
  },
  done: {
    alignItems: "center",
    marginTop: 15,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: GREEN,
  },
  doneText: {
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.black,
  },
});
