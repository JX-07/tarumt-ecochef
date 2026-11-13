export type MealSlot =
  "breakfast" | "brunch" | "lunch" | "dinner" | "snacks" | "dessert" | "drink" | "teatime";

export type MealPlanEntry = {
  shared_group_id?: string;
  shared_group_name?: string;
  added_by_name?: string;
  can_edit?: boolean;
  id: string;
  recipe_id: string;
  title: string;
  image_url?: string;
  scheduled_date: string;
  meal_slot: MealSlot;
  scheduled_time?: string;
  total_time: number;
  nutrition: Record<string, number>;
};

export type ShoppingListItem = {
  ingredient_id: string;
  name: string;
  quantity: string;
  recipe_title: string;
  in_kitchen: boolean;
};
export type PlannedShoppingList = {
  start_date: string;
  end_date: string;
  items: ShoppingListItem[];
  available_count: number;
  missing_count: number;
};

export type MealPlanCalendar = {
  start_date: string;
  end_date: string;
  items: MealPlanEntry[];
};
