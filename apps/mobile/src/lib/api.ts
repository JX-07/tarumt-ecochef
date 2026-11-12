type TokenProvider = () => string | undefined | Promise<string | undefined>;

const queryString = (values: Record<string, string | number | undefined>) => Object.entries(values)
  .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "")
  .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  .join("&");

/** Expo-safe API adapter that uses the platform fetch implementation. */
class MobileApi {
  private pendingToken?: Promise<string | undefined>;

  constructor(private readonly baseUrl: string, private readonly getToken?: TokenProvider) {}

  async getMyConsumerProfile<Response>(): Promise<Response> { return this.request<Response>("/profile/me"); }
  async updateMyConsumerProfile<Response>(body: unknown): Promise<Response> { return this.request<Response>("/profile/me", { method: "PUT", body: JSON.stringify(body) }); }
  async addMyAddress<Response>(body: unknown): Promise<Response> { return this.request<Response>("/profile/me/addresses", { method: "POST", body: JSON.stringify(body) }); }
  async updateMyAddress<Response>(addressId: string, body: unknown): Promise<Response> { return this.request<Response>(`/profile/me/addresses/${encodeURIComponent(addressId)}`, { method: "PUT", body: JSON.stringify(body) }); }
  async removeMyAddress(addressId: string): Promise<void> { await this.request<void>(`/profile/me/addresses/${encodeURIComponent(addressId)}`, { method: "DELETE" }); }
  async requestMyAccountDeletion<Response>(): Promise<Response> { return this.request<Response>("/profile/me/deletion-request", { method: "POST" }); }
  async getMyCookingGroups<Response>(): Promise<Response> { return this.request<Response>("/social/groups/me"); }
  async renameCookingGroup(id: string, name: string): Promise<void> { await this.request<void>(`/social/groups/${encodeURIComponent(id)}/name`, { method: "PUT", body: JSON.stringify({ name }) }); }
  async inviteCookingMember(id: string): Promise<void> { await this.request<void>(`/social/groups/members/${encodeURIComponent(id)}`, {method:"POST"}); }
  async inviteMemberToCookingGroup(groupId: string, userId: string): Promise<void> { await this.request<void>(`/social/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`, { method: "POST" }); }
  async removeCookingMember(id: string): Promise<void> { await this.request<void>(`/social/groups/members/${encodeURIComponent(id)}`, {method:"DELETE"}); }
  async joinCookingGroup(id: string): Promise<void> { await this.request<void>(`/social/groups/${encodeURIComponent(id)}/join`, {method:"POST"}); }
  async leaveCookingGroup(id: string): Promise<void> { await this.request<void>(`/social/groups/${encodeURIComponent(id)}/membership`, {method:"DELETE"}); }
  async getMySocial<Response>(): Promise<Response> { return this.request<Response>("/social/me"); }
  async getSocialProfile<Response>(userId: string): Promise<Response> { return this.request<Response>(`/social/users/${encodeURIComponent(userId)}/profile`); }
  async socialAction(userId: string, action: "request" | "accept" | "block"): Promise<void> { await this.request<void>(`/social/users/${encodeURIComponent(userId)}/${action}`, { method: "POST" }); }
  async removeSocialRelationship(userId: string): Promise<void> { await this.request<void>(`/social/users/${encodeURIComponent(userId)}/relationship`, { method: "DELETE" }); }
  async unblockSocialUser(userId: string): Promise<void> { await this.request<void>(`/social/users/${encodeURIComponent(userId)}/block`, { method: "DELETE" }); }
  async getPurchaseHistory<Response>(): Promise<Response> { return this.request<Response>("/orders/history"); }
  async getMyPromos<Response>(): Promise<Response> { return this.request<Response>("/promos/me"); }
  async getNotifications<Response>(): Promise<Response> { return this.request<Response>(`/notifications?fresh=${Date.now()}`, { cache: "no-store" }); }
  async markNotificationRead(notificationId: string): Promise<void> { await this.request<void>(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: "PUT" }); }
  async markAllNotificationsRead(): Promise<void> { await this.request<void>("/notifications/read-all", { method: "PUT" }); }
  async getNotificationPreferences<Response>(): Promise<Response> { return this.request<Response>("/notifications/preferences", { cache: "no-store" }); }
  async updateNotificationPreferences<Response>(body: unknown): Promise<Response> { return this.request<Response>("/notifications/preferences", { method: "PUT", body: JSON.stringify(body) }); }
  async registerPushToken(body: { device_id: string; expo_push_token: string; platform: "android" | "ios" }): Promise<void> { await this.request<void>("/notifications/push-token", { method: "POST", body: JSON.stringify(body) }); }
  async getFridgeSensors<Response>(): Promise<Response> { return this.request<Response>(`/fridge-sensors?fresh=${Date.now()}`, { cache: "no-store" }); }
  async pairFridgeSensor<Response>(body: { device_code: string; sensor_name: string; fridge_name: string }): Promise<Response> { return this.request<Response>("/fridge-sensors", { method: "POST", body: JSON.stringify(body) }); }
  async claimFridgeSensor<Response>(body: { device_code?: string; claim_secret?: string; setup_code?: string; sensor_name: string; fridge_name: string }): Promise<Response> { return this.request<Response>("/fridge-sensors/claim", { method: "POST", body: JSON.stringify(body) }); }
  async resolveFridgeSensorSetup<Response>(setupCode: string): Promise<Response> { return this.request<Response>("/fridge-sensors/resolve", { method: "POST", body: JSON.stringify({ setup_code: setupCode }) }); }
  async getFridgeSensor<Response>(sensorId: string, hours = 24): Promise<Response> { return this.request<Response>(`/fridge-sensors/${encodeURIComponent(sensorId)}?hours=${hours}&fresh=${Date.now()}`, { cache: "no-store" }); }
  async removeFridgeSensor(sensorId: string): Promise<void> { await this.request<void>(`/fridge-sensors/${encodeURIComponent(sensorId)}`, { method: "DELETE" }); }
  async getMarketplaceSummary<Response>(): Promise<Response> { return this.request<Response>("/marketplace/summary"); }
  async getMarketplaceStores<Response>(search = "", addressId?: string, coordinates?: { latitude: number; longitude: number }): Promise<Response> {
    // Avoid URLSearchParams here: some React Native/Hermes client builds expose
    // an incomplete polyfill whose `set` method is undefined at runtime.
    const params: string[] = [];
    if (search) params.push(`search=${encodeURIComponent(search)}`);
    if (addressId) params.push(`address_id=${encodeURIComponent(addressId)}`);
    if (coordinates) {
      params.push(`latitude=${encodeURIComponent(String(coordinates.latitude))}`);
      params.push(`longitude=${encodeURIComponent(String(coordinates.longitude))}`);
    }
    const query = params.join("&");
    return this.request<Response>(`/marketplace/stores${query ? `?${query}` : ""}`);
  }
  async getMarketplaceProductCategory<Response>(category: string, addressId?: string, coordinates?: { latitude: number; longitude: number }): Promise<Response> { const query = queryString({ address_id: addressId, latitude: coordinates?.latitude, longitude: coordinates?.longitude }); return this.request<Response>(`/marketplace/product-categories/${encodeURIComponent(category)}${query ? `?${query}` : ""}`); }
  async getMarketplaceStore<Response>(storeId: string, addressId?: string, coordinates?: { latitude: number; longitude: number }): Promise<Response> { const query = queryString({ address_id: addressId, latitude: coordinates?.latitude, longitude: coordinates?.longitude }); return this.request<Response>(`/marketplace/stores/${encodeURIComponent(storeId)}${query ? `?${query}` : ""}`); }
  async setMarketplaceStoreFavourite(storeId: string, favourite: boolean): Promise<void> { await this.request<void>(`/marketplace/stores/${encodeURIComponent(storeId)}/favourite`, { method: favourite ? "PUT" : "DELETE" }); }
  async getSharedVouchers<Response>(): Promise<Response> { return this.request<Response>(`/marketplace/shared-vouchers?fresh=${Date.now()}`, { cache: "no-store" }); }
  async markSharedVoucherSeen(promotionId: string): Promise<void> { await this.request<void>(`/marketplace/shared-vouchers/${encodeURIComponent(promotionId)}/seen`, { method: "POST" }); }
  async getMarketplaceReviews<Response>(storeId: string): Promise<Response> { return this.request<Response>(`/marketplace/stores/${encodeURIComponent(storeId)}/reviews`); }
  async reportMarketplaceProduct(productId: string, reportRequest: string): Promise<void> { await this.request<void>(`/marketplace/products/${encodeURIComponent(productId)}/report`, { method: "POST", body: JSON.stringify({ report_request: reportRequest }) }); }
  async getMarketplaceCart<Response>(addressId?: string, coordinates?: { latitude: number; longitude: number }, storeId?: string): Promise<Response> { const query = queryString({ store_id: storeId, address_id: addressId, latitude: coordinates?.latitude, longitude: coordinates?.longitude }); return this.request<Response>(`/marketplace/cart${query ? `?${query}` : ""}`); }
  async setMarketplaceCartQuantity<Response>(productId: string, quantity: number, cartId?: string): Promise<Response> { return this.request<Response>(`/marketplace/cart/items/${encodeURIComponent(productId)}`, { method: "PUT", body: JSON.stringify({ quantity, cart_id: cartId }) }); }
  async removeMarketplaceCartItem<Response>(productId: string): Promise<Response> { return this.request<Response>(`/marketplace/cart/items/${encodeURIComponent(productId)}`, { method: "DELETE" }); }
  async applyMarketplacePromo<Response>(code: string, storeId?: string): Promise<Response> { return this.request<Response>("/marketplace/cart/promo", { method: "POST", body: JSON.stringify({ code, store_id: storeId }) }); }
  async removeMarketplaceShopCarts<Response>(storeIds: string[]): Promise<Response> { return this.request<Response>("/marketplace/cart/shops", { method: "DELETE", body: JSON.stringify({ store_ids: storeIds }) }); }
  async removeMarketplacePromo<Response>(): Promise<Response> { return this.request<Response>("/marketplace/cart/promo", { method: "DELETE" }); }
  async getMarketplaceSlotAvailability<Response>(day: string, storeId?: string): Promise<Response> { return this.request<Response>(`/marketplace/cart/availability?${queryString({ day, store_id: storeId })}`, { cache: "no-store" }); }
  async checkoutMarketplace<Response>(request: ({ fulfillment_method: "delivery"; address_id: string } | { fulfillment_method: "delivery"; temporary_location: unknown } | { fulfillment_method: "pickup" }), arrivalAt?: string, storeId?: string): Promise<Response> { return this.request<Response>("/marketplace/checkout", { method: "POST", body: JSON.stringify({ ...request, store_id: storeId, payment_method: "stripe", arrival_at: arrivalAt }) }); }
  async getMarketplaceCheckoutStatus<Response>(orderId: string): Promise<Response> { return this.request<Response>(`/marketplace/checkout/${encodeURIComponent(orderId)}`, { cache: "no-store" }); }
  async getOrderChats<Response>(orderId: string): Promise<Response> { return this.request<Response>(`/chats/orders/${encodeURIComponent(orderId)}`, { cache: "no-store" }); }
  async getOrderChat<Response>(orderId: string, storeId: string): Promise<Response> { return this.request<Response>(`/chats/orders/${encodeURIComponent(orderId)}/stores/${encodeURIComponent(storeId)}`, { cache: "no-store" }); }
  async sendOrderChatMessage<Response>(orderId: string, storeId: string, message: unknown): Promise<Response> { return this.request<Response>(`/chats/orders/${encodeURIComponent(orderId)}/stores/${encodeURIComponent(storeId)}/messages`, { method: "POST", body: JSON.stringify(message) }); }
  async setOrderChatTyping(orderId: string, storeId: string, typing: boolean): Promise<void> { await this.request<void>(`/chats/orders/${encodeURIComponent(orderId)}/stores/${encodeURIComponent(storeId)}/typing`, { method: "PUT", body: JSON.stringify({ typing }) }); }
  async simulateMarketplacePayment<Response>(orderId: string): Promise<Response> { return this.request<Response>(`/marketplace/checkout/${encodeURIComponent(orderId)}/simulate-payment`, { method: "POST" }); }
  async autocompleteMarketplaceLocation<Response>(query: string, latitude?: number, longitude?: number): Promise<Response> { return this.request<Response>(`/marketplace/locations/autocomplete?${queryString({ query, latitude, longitude })}`); }
  async reverseMarketplaceLocation<Response>(latitude: number, longitude: number): Promise<Response> { return this.request<Response>(`/marketplace/locations/reverse?${queryString({ latitude, longitude })}`); }
  async getNearbyMarketplaceLocations<Response>(latitude: number, longitude: number): Promise<Response> { return this.request<Response>(`/marketplace/locations/nearby?${queryString({ latitude, longitude })}`); }
  async getMarketplaceLocationMap<Response>(latitude: number, longitude: number): Promise<Response> { return this.request<Response>(`/marketplace/locations/map?${queryString({ latitude, longitude })}`); }
  async getMyInventory<Response>(): Promise<Response> { return this.request<Response>(`/inventory/me?fresh=${Date.now()}`, { cache: "no-store" }); }
  async addInventoryItem<Response>(body: unknown): Promise<Response> { return this.request<Response>("/inventory/me/items", { method: "POST", body: JSON.stringify(body) }); }
  async addInventoryItems<Response>(items: unknown[]): Promise<Response> { return this.request<Response>("/inventory/me/items/bulk", { method: "POST", body: JSON.stringify({ items }) }); }
  async detectIngredients<Response>(body: { data: string; content_type: string }): Promise<Response> { return this.request<Response>("/scans/ingredients", { method: "POST", body: JSON.stringify(body) }); }
  async analyzeFreshness<Response>(body: { data: string; content_type: string }): Promise<Response> { return this.request<Response>("/scans/freshness", { method: "POST", body: JSON.stringify(body) }); }
  async updateInventoryItem<Response>(itemId: string, body: unknown): Promise<Response> { return this.request<Response>(`/inventory/me/items/${encodeURIComponent(itemId)}`, { method: "PUT", body: JSON.stringify(body) }); }
  async removeInventoryItem(itemId: string): Promise<void> { await this.request<void>(`/inventory/me/items/${encodeURIComponent(itemId)}`, { method: "DELETE" }); }
  async getRecipes<Response>(query = ""): Promise<Response> { return this.request<Response>(`/recipes${query ? `?${query}` : ""}`); }
  async getRecipe<Response>(recipeId: string): Promise<Response> { return this.request<Response>(`/recipes/${encodeURIComponent(recipeId)}`); }
  async uploadRecipeImage<Response>(body: { data: string; content_type: string }): Promise<Response> { return this.request<Response>("/recipes/images", { method: "POST", body: JSON.stringify(body) }); }
  async setRecipeFavourite(recipeId: string, favourite: boolean): Promise<void> { await this.request<void>(`/recipes/${encodeURIComponent(recipeId)}/favourite`, { method: favourite ? "PUT" : "DELETE" }); }
  async createRecipe<Response>(body: unknown): Promise<Response> { return this.request<Response>("/recipes", { method: "POST", body: JSON.stringify(body) }); }
  async validateRecipeIngredients<Response>(ingredients: unknown, servings: number): Promise<Response> { return this.request<Response>("/recipes/validate-ingredients", { method: "POST", body: JSON.stringify({ ingredients, servings }) }); }
  async updateRecipe<Response>(recipeId: string, body: unknown): Promise<Response> { return this.request<Response>(`/recipes/${encodeURIComponent(recipeId)}`, { method: "PUT", body: JSON.stringify(body) }); }
  async estimateRecipeCalories<Response>(body: unknown): Promise<Response> { return this.request<Response>("/recipes/estimate-calories", { method: "POST", body: JSON.stringify(body) }); }
  async scheduleRecipe(recipeId: string, body: unknown): Promise<void> { await this.request<void>(`/recipes/${encodeURIComponent(recipeId)}/schedule`, { method: "POST", body: JSON.stringify(body) }); }
  async getMyMealPlan<Response>(startDate: string, days = 7): Promise<Response> { return this.request<Response>(`/meal-plans/me?start_date=${encodeURIComponent(startDate)}&days=${days}&fresh=${Date.now()}`, { cache: "no-store" }); }
  async getMyShoppingList<Response>(startDate: string, endDate: string): Promise<Response> { return this.request<Response>(`/meal-plans/me/shopping-list?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`); }
  async updateMealPlanEntry<Response>(entryId: string, body: unknown): Promise<Response> { return this.request<Response>(`/meal-plans/me/entries/${encodeURIComponent(entryId)}`, { method: "PUT", body: JSON.stringify(body) }); }
  async removeMealPlanEntry(entryId: string): Promise<void> { await this.request<void>(`/meal-plans/me/entries/${encodeURIComponent(entryId)}`, { method: "DELETE" }); }
  async reportRecipe(recipeId: string, reason: string): Promise<void> { await this.request<void>(`/recipes/${encodeURIComponent(recipeId)}/report`, { method: "POST", body: JSON.stringify({ reason }) }); }
  async reviewRecipe<Response>(recipeId: string, body: unknown): Promise<Response> { return this.request<Response>(`/recipes/${encodeURIComponent(recipeId)}/review`, { method: "PUT", body: JSON.stringify(body) }); }

  async getMarketplaceProductReviews<Response>(productId: string): Promise<Response> { return this.request<Response>(`/marketplace/products/${encodeURIComponent(productId)}/reviews`); }
  async submitMarketplaceProductReview<Response>(productId: string, body: { rating: number; comment?: string }): Promise<Response> { return this.request<Response>(`/marketplace/products/${encodeURIComponent(productId)}/reviews`, { method: "PUT", body: JSON.stringify(body) }); }
  async getMarketplaceReviewPrompts<Response>(filters: { order_id?: string; store_id?: string } = {}): Promise<Response> { return this.request<Response>(`/marketplace/review-prompts?${queryString(filters)}`); }
  async startRecipeCooking(recipeId: string): Promise<void> { await this.request<void>(`/recipes/${encodeURIComponent(recipeId)}/cook-now`, { method: "POST" }); }
  async flagRecipeReview<Response>(recipeId: string, feedbackId: string, description: string): Promise<Response> { return this.request<Response>(`/recipes/${encodeURIComponent(recipeId)}/reviews/${encodeURIComponent(feedbackId)}/flag`, { method: "POST", body: JSON.stringify({ description }) }); }
  async getReportableProducts<Response>(storeId: string): Promise<Response> { return this.request<Response>(`/reports/stores/${encodeURIComponent(storeId)}/products`); }
  async getReportCategories<Response>(): Promise<Response> { return this.request<Response>("/reports/categories"); }
  async submitContentReport<Response>(body: { subject_type: "recipe" | "store"; subject_id: string; category: string; description: string; product_id?: string }): Promise<Response> { return this.request<Response>("/reports", { method: "POST", body: JSON.stringify(body) }); }
  async getMyReports<Response>(): Promise<Response> { return this.request<Response>("/reports/mine"); }

  private async request<Response>(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.resolveToken();
    const requestFetch = globalThis.fetch;
    if (typeof requestFetch !== "function") throw new Error("Network requests are unavailable in this app build.");
    const baseUrl = typeof this.baseUrl === "string" ? this.baseUrl.replace(/\/$/, "") : "";
    if (!baseUrl) throw new Error("The EcoChef API address is not configured.");
    const response = await requestFetch.call(globalThis, `${baseUrl}${path}`, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
    if (!response.ok) {
      const payload = await this.readResponseJson(response).catch(() => null) as { message?: string; detail?: string | Array<{ loc?: Array<string | number>; msg?: string }>; details?: Array<{ loc?: Array<string | number>; msg?: string }> } | null;
      const detail = typeof payload?.detail === "string" ? payload.detail : Array.isArray(payload?.detail) ? payload.detail.map((item) => item.msg).filter(Boolean).join(" ") : undefined;
      const validationDetails = (Array.isArray(payload?.details) ? payload.details : []).map((item) => { const field = item.loc?.length ? item.loc[item.loc.length - 1] : undefined; return [field && String(field).split("_").join(" "), item.msg].filter(Boolean).join(": "); }).filter(Boolean).join(" ");
      throw new Error(validationDetails || detail || payload?.message || `EcoChef could not complete this request (HTTP ${response.status}).`);
    }
    if (response.status === 204) return undefined as Response;
    return this.readResponseJson(response) as Promise<Response>;
  }

  private async resolveToken(): Promise<string | undefined> {
    if (typeof this.getToken !== "function") return undefined;
    if (this.pendingToken) return this.pendingToken;
    const pending = (async () => this.getToken?.())();
    this.pendingToken = pending;
    try {
      return await pending;
    } finally {
      if (this.pendingToken === pending) this.pendingToken = undefined;
    }
  }

  private async readResponseJson(response: globalThis.Response): Promise<unknown> {
    if (typeof response.json === "function") return response.json();
    if (typeof response.text === "function") {
      const text = await response.text();
      return text ? JSON.parse(text) : undefined;
    }
    throw new Error("The server response could not be read by this app build.");
  }
}

export const createMobileApi = (baseUrl: string, getFirebaseIdToken?: TokenProvider): MobileApi => new MobileApi(baseUrl, getFirebaseIdToken);
