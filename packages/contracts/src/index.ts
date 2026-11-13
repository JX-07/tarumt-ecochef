export type AccountRole = "consumer" | "administrator" | "business_owner";

export const MARKETPLACE_PRODUCT_CATEGORIES = [
  "Produce",
  "Bakery",
  "Pantry",
  "Prepared Food",
  "Beverages",
  "Dairy",
  "Snacks & Confectionery",
] as const;

export interface ApiMetaResponse {
  service: string;
  version: string;
  timestamp: string;
}

export interface PaginationMeta {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

export interface PaginatedResponse<Item> {
  data: Item[];
  meta: PaginationMeta;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ErrorResponse {
  error: string;
  message: string;
  details: ValidationIssue[] | Record<string, unknown> | null;
  timestamp: string;
}

export interface CreateProfileRequest {
  name: string;
  requested_role: AccountRole;
  phone_number?: string;
}

export interface FirebaseIdentity {
  firebase_uid: string;
  email: string;
}

export interface CreateBusinessOwnerProfileRequest {
  name: string;
}

export interface RegisterBusinessOwnerRequest extends CreateBusinessOwnerProfileRequest {
  email: string;
  password: string;
  terms_version: "business-v1-2026-10-21";
  terms_accepted: true;
}

export interface RegisterConsumerRequest {
  name: string;
  email: string;
  password: string;
  terms_version: "consumer-v1-2026-10-21";
  terms_accepted: true;
}

export interface AuthenticatedUser {
  id: string;
  firebase_uid: string;
  name: string;
  email: string;
  role: AccountRole;
}

export type UnitPreference = "metric" | "imperial";

export interface AddressInput {
  label?: string;
  address_type?: "saved" | "home" | "work" | "school";
  address_line_1: string;
  address_line_2?: string;
  city: string;
  state: string;
  postal_code: string;
  delivery_note?: string;
  latitude?: number;
  longitude?: number;
  is_default?: boolean;
}

export interface Address extends AddressInput {
  id: string;
  is_default: boolean;
}

export interface ConsumerProfileUpdate {
  name: string;
  phone_number?: string;
  bio?: string;
  cuisine_preferences: string[];
  dietary_restrictions: string[];
  allergies: string[];
  food_dislikes: string[];
  profile_visibility: "public" | "friends_only" | "hidden";
  preferred_units: UnitPreference;
}

export interface ConsumerProfile extends ConsumerProfileUpdate {
  id: string;
  firebase_uid: string;
  email: string;
  addresses: Address[];
}

export interface AccountDeletionRequest {
  scheduled_for: string;
  retention_days: number;
}

export type InventoryItemSource = "manual" | "scanned" | "shopping";

export interface InventoryItemInput {
  name: string;
  quantity: string;
  expiry_date: string;
  category?: string;
  source: InventoryItemSource;
  icon?: string;
}

export interface InventoryItem extends InventoryItemInput {
  id: string;
  date_recorded: string;
}

export interface InventoryList {
  items: InventoryItem[];
  total: number;
  expiring_soon: number;
}

export interface InventoryBulkCreateRequest {
  items: InventoryItemInput[];
}

export interface InventoryBulkCreateResult {
  items: InventoryItem[];
  created_count: number;
}

export interface MarketplacePromotion {
  store_id?: string | null;
  id: string;
  code: string;
  title: string;
  description: string;
  discount_percent?: number;
  discount_amount?: number;
  minimum_order_amount: number;
  free_delivery: boolean;
  start_date: string;
  end_date: string;
}

export interface MarketplaceStoreSummary {
  store_closed_today?: boolean;
  id: string;
  name: string;
  description?: string;
  category?: string;
  cover_image_url?: string;
  icon_url?: string;
  address: string;
  rating: number;
  review_count: number;
  distance_km?: number;
  estimated_delivery_minutes?: number;
  delivery_fee: number;
  best_promotion?: MarketplacePromotion;
}

export interface MarketplaceProduct {
  store_closed_today?: boolean;
  id: string;
  store_id: string;
  name: string;
  description?: string;
  image_url?: string;
  category?: string;
  subcategory?: string;
  unit_label?: string;
  brand?: string;
  size?: string;
  price: number;
  original_price?: number;
  discount_percent: number;
  expiry_date?: string;
  stock_quantity: number;
  cart_quantity: number;
  addons?: VendorProductAddon[];
}

export interface MarketplaceReview {
  id?: string;
  product_id?: string;
  product_name?: string;
  user_id: string;
  user_name: string;
  rating: number;
  comment?: string;
  date_submitted: string;
}

export interface MarketplaceStoreDetail extends MarketplaceStoreSummary {
  estimated_pickup_minutes?: number | null;
  closed_today?: boolean;
  phone_number?: string;
  operating_hours?: string;
  operating_hours_schedule?: Record<string, { open: string; close: string; closed: boolean }>;
  holiday_closure?: {
    starts_on: string;
    ends_on: string;
    whole_day: boolean;
    opens_at?: string | null;
    closes_at?: string | null;
    reason: string;
  };
  is_favourite: boolean;
  latitude?: number;
  longitude?: number;
  promotions: MarketplacePromotion[];
  products: MarketplaceProduct[];
}

export interface MarketplaceCategoryStore extends MarketplaceStoreSummary {
  products: MarketplaceProduct[];
  popularity: number;
  offer_count: number;
}

export interface MarketplaceCategoryStoreList {
  category: string;
  stores: MarketplaceCategoryStore[];
  total: number;
}

export interface MarketplaceSummary {
  deals_active: number;
  average_savings_percent: number;
  cart_item_count: number;
}

export interface MarketplaceStoreList {
  stores: MarketplaceStoreSummary[];
  total: number;
}
export interface MarketplaceReviewList {
  reviews: MarketplaceReview[];
  total: number;
}

export interface MarketplaceCartItem {
  product: MarketplaceProduct;
  store_name: string;
  line_total: number;
}

export interface MarketplaceCartStockAdjustment {
  product_id: string;
  product_name: string;
  previous_quantity: number;
  adjusted_quantity: number;
}

export interface MarketplaceCart {
  checkout_blocked_reason?: string | null;
  id: string;
  items: MarketplaceCartItem[];
  item_count: number;
  subtotal: number;
  delivery_fee: number;
  discount: number;
  total: number;
  applied_promo?: MarketplacePromotion;
  stock_adjustments: MarketplaceCartStockAdjustment[];
  estimated_delivery_minutes?: number;
  estimated_delivery_distance_km?: number;
}

export interface MarketplaceCheckoutResult {
  order_id: string;
  payment_status: string;
  total: number;
  message: string;
  checkout_client_secret: string;
  checkout_session_id: string;
  simulation_available: boolean;
}

export interface MarketplaceCheckoutStatus {
  order_id: string;
  payment_status: string;
  order_status: string;
  total: number;
  invoice_url?: string;
  invoice_pdf_url?: string;
}

export interface VendorProductInput {
  name: string;
  description?: string;
  price: number;
  stock_quantity: number;
  category?: string;
  subcategory?: string;
  unit_label?: string;
  brand?: string;
  size?: string;
  image_url?: string;
  original_price?: number;
  expiry_date?: string;
  status: "active" | "hidden" | "sold_out";
  addons?: VendorProductAddon[];
  discount?: VendorProductDiscount;
}
export interface VendorProductAddonOption {
  name: string;
  price: number;
}
export interface VendorProductAddon {
  name: string;
  required: boolean;
  selection_mode: "single" | "multiple";
  max_selections: number;
  options: VendorProductAddonOption[];
}
export type VendorProductDiscount =
  | { type: "percentage" | "fixed_amount"; value: number; starts_at: string; ends_at: string }
  | {
      type: "buy_x_get_y";
      buy_quantity: number;
      gift_quantity: number;
      starts_at: string;
      ends_at: string;
    };
export interface VendorProduct extends VendorProductInput {
  id: string;
  store_id: string;
}
export interface VendorStoreInput {
  name: string;
  address: string;
  phone_number?: string;
  operating_hours?: string;
  description?: string;
  category?: string;
  delivery_fee: number;
  estimated_delivery_minutes?: number;
  street_address?: string;
  postal_code?: string;
  city?: string;
  state?: string;
  country?: string;
  additional_location_details?: string;
  contact_email?: string;
  helpline_phones?: string[];
  icon_url?: string;
  operating_hours_schedule?: Record<string, { open: string; close: string; closed: boolean }>;
}
export interface VendorStore extends VendorStoreInput {
  id: string;
  status: string;
  products: VendorProduct[];
}
export interface VendorStoreList {
  stores: VendorStore[];
}

export type RecipeDifficulty = "easy" | "medium" | "hard";

export interface RecipeNutrition {
  calories_kcal?: number;
  protein_g?: number;
  carbohydrates_g?: number;
  fat_g?: number;
  fibre_g?: number;
}

export interface RecipeIngredient {
  name: string;
  quantity: string;
}

export interface RecipeSummary {
  id: string;
  title: string;
  summary?: string;
  image_url?: string;
  cuisine?: string;
  difficulty: RecipeDifficulty;
  prep_time?: number;
  cook_time?: number;
  total_time: number;
  servings?: number;
  dietary_tags: string[];
  allergen_tags: string[];
  average_rating?: number;
  is_favourite: boolean;
  safety_warnings: string[];
}

export interface RecipeDetail extends RecipeSummary {
  instructions: string[];
  ingredients: RecipeIngredient[];
  nutrition: RecipeNutrition;
  author_name: string;
  date_created: string;
}

export interface RecipeList {
  items: RecipeSummary[];
  total: number;
}

export interface RecipeFilters {
  search?: string;
  cuisine?: string;
  dietary_tag?: string;
  max_total_time?: number;
  favourites_only?: boolean;
  mine_only?: boolean;
  community_only?: boolean;
}

export interface MarketplaceSlotAvailability {
  slots: { start: string; end: string; available: boolean; reason?: string | null }[];
  cart_checked: boolean;
  timezone: string;
}

/** Marketplace feedback is attached to a verified purchased product. */
export interface MarketplaceProductReview extends MarketplaceReview {
  id: string;
  product_id: string;
  product_name: string;
  store_id: string;
}
export interface MarketplaceProductReviewList {
  review_eligibility_reason?: string | null;
  reviews: MarketplaceProductReview[];
  total: number;
  rating: number;
  can_review: boolean;
  my_review?: MarketplaceProductReview | null;
}
export interface MarketplaceReviewPrompt {
  product_id: string;
  product_name: string;
  store_id: string;
  store_name: string;
  order_id: string;
  reviewed: boolean;
  rating?: number | null;
  comment?: string | null;
}
export interface MarketplaceReviewPromptList {
  items: MarketplaceReviewPrompt[];
}
