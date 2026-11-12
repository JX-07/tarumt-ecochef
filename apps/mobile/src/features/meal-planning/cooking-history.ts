import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@ecochef/cooked-meals";
const cookedKey = (recipeId: string, date: string) => `${date}:${recipeId}`;

export async function markMealCooked(recipeId: string, date: string) {
  const current = await getCookedMeals();
  current.add(cookedKey(recipeId, date));
  await AsyncStorage.setItem(KEY, JSON.stringify([...current]));
}

export async function getCookedMeals() {
  try {
    return new Set<string>(
      JSON.parse((await AsyncStorage.getItem(KEY)) ?? "[]"),
    );
  } catch {
    return new Set<string>();
  }
}

export function wasMealCooked(
  history: Set<string>,
  recipeId: string,
  date: string,
) {
  return history.has(cookedKey(recipeId, date));
}
