export type RecipeSummary = {
  id: string;
  title: string;
  summary?: string;
  image_url?: string;
  cuisine?: string;
  difficulty: "easy" | "medium" | "hard";
  prep_time?: number;
  cook_time?: number;
  total_time: number;
  servings?: number;
  dietary_tags: string[];
  allergen_tags: string[];
  average_rating?: number;
  is_favourite: boolean;
  safety_warnings: string[];
  is_owner: boolean;
  is_published: boolean;
  edit_log: Array<{ edited_at: string; subjects: string[] }>;
  smart_match_ingredients: string[];
};

export type RecipeDetail = RecipeSummary & {
  shared_group_ids?: string[];
  can_review: boolean;
  review_eligibility_reason?: string;
  my_feedback_status?: "pending" | "dismissed" | "removed" | "unverified";
  my_feedback_rating?: number;
  my_feedback_comment?: string;
  my_feedback_resolution?: string;
  instructions: string[];
  ingredients: Array<{ name: string; quantity: string; icon?: string }>;
  nutrition: {
    calories_kcal?: number;
    protein_g?: number;
    carbohydrates_g?: number;
    fat_g?: number;
    fibre_g?: number;
  };
  author_name: string;
  date_created: string;
  reviews: Array<{
    id: string;
    user_id: string;
    is_mine: boolean;
    can_flag: boolean;
    flag_status?: "pending" | "dismissed" | "removed";
    flag_resolution?: string;
    user_name: string;
    rating: number;
    comment?: string;
    date_submitted: string;
  }>;
};

export type RecipeList = { items: RecipeSummary[]; total: number };
