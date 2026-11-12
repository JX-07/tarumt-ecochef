export type FreshnessStatus = "fresh" | "use_soon" | "spoiled" | "unknown";

export type FreshnessItem = {
  name: string;
  status: FreshnessStatus;
  confidence: number;
  finding: string;
  spoilage_reasons: string[];
  prevention: string[];
  safe_to_consume: boolean | null;
  safety_note: string;
};

export type FreshnessResult = {
  items: FreshnessItem[];
  provider: "freshness_model_api" | "gemini";
  disclaimer: string;
};

export type DetectedIngredient = {
  name: string;
  confidence: number;
  suggested_amount: number;
  suggested_unit: string;
  suggested_expiry_days: number;
  category?: string | null;
};

export type IngredientDetectionResult = {
  items: DetectedIngredient[];
  provider: "food_detection_api" | "gemini";
};

export type EditableIngredient = {
  id: string;
  name: string;
  amount: string;
  unit: string;
  expiryDate: string;
  category: string;
  confidence?: number;
};

export type ScanHistoryEntry = {
  id: string;
  mode: "freshness" | "ingredients";
  createdAt: string;
  imageUri: string;
  freshnessItems?: FreshnessItem[];
  ingredientNames?: string[];
};
