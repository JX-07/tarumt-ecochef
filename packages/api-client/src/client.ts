import type { AccountDeletionRequest, Address, AddressInput, ApiMetaResponse, AuthenticatedUser, ConsumerProfile, ConsumerProfileUpdate, CreateBusinessOwnerProfileRequest, ErrorResponse, InventoryBulkCreateResult, InventoryItem, InventoryItemInput, InventoryList, MarketplaceCart, MarketplaceCheckoutResult, MarketplaceCheckoutStatus, MarketplaceReviewList, MarketplaceStoreDetail, MarketplaceStoreList, MarketplaceSummary, RecipeDetail, RecipeFilters, RecipeList, RegisterBusinessOwnerRequest, RegisterConsumerRequest, VendorProduct, VendorProductInput, VendorStore, VendorStoreInput, VendorStoreList } from "@ecochef/contracts";

export interface ApiClientOptions {
  baseUrl: string;
  accessToken?: () => string | undefined | Promise<string | undefined>;
  fetchImplementation?: typeof fetch;
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly response: ErrorResponse | undefined,
  ) {
    super(response?.message ?? `API request failed with status ${status}.`);
    this.name = "ApiClientError";
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly accessToken?: () => string | undefined | Promise<string | undefined>;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.accessToken = options.accessToken;
    // Browser fetch requires the global object as its receiver. Storing it unbound
    // and calling it as an ApiClient member causes an "Illegal invocation" error.
    this.fetchImplementation = options.fetchImplementation ?? fetch.bind(globalThis);
  }

  async getMeta(): Promise<ApiMetaResponse> {
    return this.get<ApiMetaResponse>("/meta");
  }

  async getLiveness(): Promise<{ status: string; timestamp: string }> {
    return this.get("/health/live");
  }

  async getCurrentUser(): Promise<AuthenticatedUser> {
    return this.get("/auth/me");
  }

  async updateBusinessProfile(request: { name: string }): Promise<AuthenticatedUser> {
    return this.request("/auth/me", { method: "PUT", body: JSON.stringify(request) });
  }

  async createBusinessOwnerProfile(request: CreateBusinessOwnerProfileRequest): Promise<AuthenticatedUser> {
    return this.request("/auth/business-owner-profiles", { method: "POST", body: JSON.stringify(request) });
  }

  async registerBusinessOwner(request: RegisterBusinessOwnerRequest): Promise<AuthenticatedUser> {
    return this.request("/auth/business-owner-registrations", { method: "POST", body: JSON.stringify(request) });
  }

  async checkBusinessEmailAvailability(request: { email: string }): Promise<{ available: boolean }> {
    return this.request("/auth/business-email-availability", { method: "POST", body: JSON.stringify(request) });
  }

  async registerConsumer(request: RegisterConsumerRequest): Promise<AuthenticatedUser> {
    return this.request("/auth/consumer-registrations", { method: "POST", body: JSON.stringify(request) });
  }

  async getMyConsumerProfile(): Promise<ConsumerProfile> {
    return this.get<ConsumerProfile>("/profile/me");
  }

  async updateMyConsumerProfile(request: ConsumerProfileUpdate): Promise<ConsumerProfile> {
    return this.request("/profile/me", { method: "PUT", body: JSON.stringify(request) });
  }

  async addMyAddress(request: AddressInput): Promise<Address> {
    return this.request("/profile/me/addresses", { method: "POST", body: JSON.stringify(request) });
  }

  async removeMyAddress(addressId: string): Promise<void> {
    await this.request<void>(`/profile/me/addresses/${encodeURIComponent(addressId)}`, { method: "DELETE" });
  }

  async requestMyAccountDeletion(): Promise<AccountDeletionRequest> {
    return this.request("/profile/me/deletion-request", { method: "POST" });
  }

  async getMyInventory(): Promise<InventoryList> {
    return this.get<InventoryList>("/inventory/me");
  }

  async addInventoryItem(request: InventoryItemInput): Promise<InventoryItem> {
    return this.request("/inventory/me/items", { method: "POST", body: JSON.stringify(request) });
  }

  async addInventoryItems(items: InventoryItemInput[]): Promise<InventoryBulkCreateResult> {
    return this.request("/inventory/me/items/bulk", { method: "POST", body: JSON.stringify({ items }) });
  }

  async updateInventoryItem(itemId: string, request: InventoryItemInput): Promise<InventoryItem> {
    return this.request(`/inventory/me/items/${encodeURIComponent(itemId)}`, { method: "PUT", body: JSON.stringify(request) });
  }

  async removeInventoryItem(itemId: string): Promise<void> {
    await this.request<void>(`/inventory/me/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
  }

  async getMarketplaceSummary(): Promise<MarketplaceSummary> { return this.get("/marketplace/summary"); }
  async getMarketplaceStores(search = "", addressId?: string): Promise<MarketplaceStoreList> { const params = new URLSearchParams(); if (search) params.set("search", search); if (addressId) params.set("address_id", addressId); return this.get(`/marketplace/stores${params.size ? `?${params}` : ""}`); }
  async getMarketplaceStore(storeId: string, addressId?: string): Promise<MarketplaceStoreDetail> { return this.get(`/marketplace/stores/${encodeURIComponent(storeId)}${addressId ? `?address_id=${encodeURIComponent(addressId)}` : ""}`); }
  async getMarketplaceReviews(storeId: string): Promise<MarketplaceReviewList> { return this.get(`/marketplace/stores/${encodeURIComponent(storeId)}/reviews`); }
  async getMarketplaceCart(addressId?: string): Promise<MarketplaceCart> { return this.get(`/marketplace/cart${addressId ? `?address_id=${encodeURIComponent(addressId)}` : ""}`); }
  async setMarketplaceCartQuantity(productId: string, quantity: number, cartId?: string): Promise<MarketplaceCart> { return this.request(`/marketplace/cart/items/${encodeURIComponent(productId)}`, { method: "PUT", body: JSON.stringify({ quantity, cart_id: cartId }) }); }
  async removeMarketplaceCartItem(productId: string): Promise<MarketplaceCart> { return this.request(`/marketplace/cart/items/${encodeURIComponent(productId)}`, { method: "DELETE" }); }
  async applyMarketplacePromo(code: string): Promise<MarketplaceCart> { return this.request("/marketplace/cart/promo", { method: "POST", body: JSON.stringify({ code }) }); }
  async removeMarketplacePromo(): Promise<MarketplaceCart> { return this.request("/marketplace/cart/promo", { method: "DELETE" }); }
  async checkoutMarketplace(addressId: string, fulfillmentMethod: "delivery" | "pickup" = "delivery"): Promise<MarketplaceCheckoutResult> { return this.request("/marketplace/checkout", { method: "POST", body: JSON.stringify(fulfillmentMethod === "pickup" ? { fulfillment_method: "pickup", payment_method: "stripe" } : { fulfillment_method: "delivery", address_id: addressId, payment_method: "stripe" }) }); }
  async getMarketplaceCheckoutStatus(orderId: string): Promise<MarketplaceCheckoutStatus> { return this.get(`/marketplace/checkout/${encodeURIComponent(orderId)}`); }
  async simulateMarketplacePayment(orderId: string): Promise<MarketplaceCheckoutStatus> { return this.request(`/marketplace/checkout/${encodeURIComponent(orderId)}/simulate-payment`, { method: "POST" }); }
  async getVendorStores(): Promise<VendorStoreList> { return this.request("/vendor/stores", { cache: "no-store" }); }
  async createVendorStore(request: VendorStoreInput): Promise<VendorStore> { return this.request("/vendor/stores", { method: "POST", body: JSON.stringify(request) }); }
  async updateVendorStore(storeId: string, request: VendorStoreInput): Promise<VendorStore> { return this.request(`/vendor/stores/${encodeURIComponent(storeId)}`, { method: "PUT", body: JSON.stringify(request) }); }
  async createVendorProduct(storeId: string, request: VendorProductInput): Promise<VendorProduct> { return this.request(`/vendor/stores/${encodeURIComponent(storeId)}/products`, { method: "POST", body: JSON.stringify(request) }); }
  async updateVendorProduct(storeId: string, productId: string, request: VendorProductInput): Promise<VendorProduct> { return this.request(`/vendor/stores/${encodeURIComponent(storeId)}/products/${encodeURIComponent(productId)}`, { method: "PUT", body: JSON.stringify(request) }); }
  async deleteVendorProduct(storeId: string, productId: string): Promise<void> { await this.request(`/vendor/stores/${encodeURIComponent(storeId)}/products/${encodeURIComponent(productId)}`, { method: "DELETE" }); }
  async uploadVendorProductImage(request: { data: string; content_type: "image/jpeg" | "image/png" | "image/webp" }): Promise<{ image_url: string }> { return this.request("/vendor/product-images", { method: "POST", body: JSON.stringify(request) }); }
  async getVendorFeedback<Response>(search = "", offset = 0, sort: "product" | "rating" | "feedback" | "submitted" | "moderator" = "submitted", direction: "asc" | "desc" = "desc"): Promise<Response> { return this.get(`/vendor/feedback?search=${encodeURIComponent(search)}&offset=${offset}&limit=25&sort=${sort}&direction=${direction}`); }
  async flagVendorFeedback<Response>(id: string, description: string): Promise<Response> { return this.request(`/vendor/feedback/${encodeURIComponent(id)}/flag`,{method:"POST",body:JSON.stringify({description})}); }
  async decideProductFeedbackFlag<Response>(id: string, body: {decision:"removed"|"dismissed";note:string}): Promise<Response> { return this.request(`/reports/moderation/product-feedback-flags/${encodeURIComponent(id)}/decision`,{method:"POST",body:JSON.stringify(body)}); }
  async getVendorDashboard<Response>(period: "today" | "week" | "month" | "year" = "week", year?: number, month?: number): Promise<Response> {
    const query = new URLSearchParams({period});
    if (year !== undefined) query.set("year", String(year));
    if (month !== undefined) query.set("month", String(month));
    return this.get(`/vendor/dashboard?${query.toString()}`);
  }
  async getVendorOrders<Response>(): Promise<Response> { return this.get("/vendor/orders"); }
  async updateVendorOrderStatus<Response>(orderId: string, status: string, cancellationReason?: string): Promise<Response> { return this.request(`/vendor/orders/${encodeURIComponent(orderId)}/status`, { method: "PUT", body: JSON.stringify({ status, cancellation_reason: cancellationReason }) }); }
  async getOrderChat<Response>(orderId: string, storeId: string): Promise<Response> { return this.get(`/chats/orders/${encodeURIComponent(orderId)}/stores/${encodeURIComponent(storeId)}`); }
  async sendOrderChatMessage<Response>(orderId: string, storeId: string, message: unknown): Promise<Response> { return this.request(`/chats/orders/${encodeURIComponent(orderId)}/stores/${encodeURIComponent(storeId)}/messages`, { method: "POST", body: JSON.stringify(message) }); }
  async setOrderChatTyping(orderId: string, storeId: string, typing: boolean): Promise<void> { await this.request(`/chats/orders/${encodeURIComponent(orderId)}/stores/${encodeURIComponent(storeId)}/typing`, { method: "PUT", body: JSON.stringify({ typing }) }); }
  async sendOrderDeliveryAlert<Response>(orderId: string, storeId: string, alert: string, note?: string): Promise<Response> { return this.request(`/chats/orders/${encodeURIComponent(orderId)}/stores/${encodeURIComponent(storeId)}/delivery-alert`, { method: "POST", body: JSON.stringify({ alert, note }) }); }
  async getVendorCustomers<Response>(): Promise<Response> { return this.get("/vendor/customers"); }
  async getVendorPromotions<Response>(): Promise<Response> { return this.get("/vendor/promotions"); }
  async shareVendorPromotion<Response>(promotionId: string, customerId: string, rewardMessage: string): Promise<Response> { return this.request(`/vendor/promotions/${encodeURIComponent(promotionId)}/share`, { method: "POST", body: JSON.stringify({ customer_id: customerId, reward_message: rewardMessage }) }); }
  async broadcastVendorPromotion<Response>(promotionId: string, rewardMessage: string): Promise<Response> { return this.request(`/vendor/promotions/${encodeURIComponent(promotionId)}/broadcast`, { method: "POST", body: JSON.stringify({ reward_message: rewardMessage }) }); }
  async getVendorHolidays<Response>(storeId: string): Promise<Response> { return this.get(`/vendor/stores/${encodeURIComponent(storeId)}/holidays`); }
  async createVendorHoliday<Response>(storeId: string, request: unknown): Promise<Response> { return this.request(`/vendor/stores/${encodeURIComponent(storeId)}/holidays`, { method: "POST", body: JSON.stringify(request) }); }
  async deleteVendorHoliday(storeId: string, holidayId: string): Promise<void> { await this.request(`/vendor/stores/${encodeURIComponent(storeId)}/holidays/${encodeURIComponent(holidayId)}`, { method: "DELETE" }); }
  async createVendorPromotion<Response>(request: unknown): Promise<Response> { return this.request("/vendor/promotions", { method: "POST", body: JSON.stringify(request) }); }
  async getVendorPostcode<Response>(postcode: string): Promise<Response> { return this.get(`/vendor/postcodes/${encodeURIComponent(postcode)}`); }
  async getVendorLocations<Response>(): Promise<Response> { return this.get("/vendor/locations"); }
  async getVendorReportOutcomes<Response>(): Promise<Response> { return this.get("/vendor/report-outcomes"); }
  async getVendorInvitations<Response>(): Promise<Response> { return this.get("/vendor/invitations"); }
  async acceptVendorInvitation<Response>(invitationId: string): Promise<Response> { return this.request(`/vendor/invitations/${encodeURIComponent(invitationId)}/accept`, { method: "POST" }); }
  async getVendorStoreTeam<Response>(storeId: string): Promise<Response> { return this.get(`/vendor/stores/${encodeURIComponent(storeId)}/team`); }
  async inviteVendorStoreStaff<Response>(storeId: string, request: { email: string; assigned_role: string }): Promise<Response> { return this.request(`/vendor/stores/${encodeURIComponent(storeId)}/invitations`, { method: "POST", body: JSON.stringify(request) }); }
  async updateVendorStoreStaffPermission<Response>(storeId: string, accountId: string, canEditStore: boolean): Promise<Response> { return this.request(`/vendor/stores/${encodeURIComponent(storeId)}/staff/${encodeURIComponent(accountId)}/permission`, { method: "PUT", body: JSON.stringify({ can_edit_store: canEditStore }) }); }
  async createVendorStripeAccountSession<Response>(storeId: string): Promise<Response> { return this.request(`/vendor/stores/${encodeURIComponent(storeId)}/stripe/account-session`, { method: "POST" }); }
  async getVendorStripeStatus<Response>(storeId: string): Promise<Response> { return this.get(`/vendor/stores/${encodeURIComponent(storeId)}/stripe/status`); }
  async createVendorStripeDashboardLink<Response>(storeId: string): Promise<Response> { return this.request(`/vendor/stores/${encodeURIComponent(storeId)}/stripe/dashboard-link`, { method: "POST" }); }
  async getAdminWorkspace<Response>(): Promise<Response> { return this.get("/admin/workspace"); }
  async getAdminAccount<Response>(): Promise<Response> { return this.get("/admin/me"); }
  async updateAdminProfile<Response>(request: { name: string }): Promise<Response> { return this.request("/admin/me", { method: "PUT", body: JSON.stringify(request) }); }
  async approveAdminStore<Response>(storeId: string): Promise<Response> { return this.request(`/admin/stores/${encodeURIComponent(storeId)}/approve`, { method: "POST" }); }
  async issueAdminStoreStrike<Response>(storeId: string, reason: string): Promise<Response> { return this.request(`/admin/stores/${encodeURIComponent(storeId)}/strikes`, { method: "POST", body: JSON.stringify({ reason }) }); }
  async revokeAdminStore<Response>(storeId: string): Promise<Response> { return this.request(`/admin/stores/${encodeURIComponent(storeId)}/revoke`, { method: "POST" }); }
  async inviteAdministrator<Response>(request: { email: string }): Promise<Response> { return this.request("/admin/administrators/invitations", { method: "POST", body: JSON.stringify(request) }); }
  async getAdminActionLogs<Response>(filters: { area: string; query?: string; actionType?: string; actor?: string; dateFrom?: string; dateTo?: string; limit?: number; offset?: number }): Promise<Response> { const parameters = new URLSearchParams({ area: filters.area }); if (filters.query) parameters.set("query", filters.query); if (filters.actionType) parameters.set("action_type", filters.actionType); if (filters.actor) parameters.set("actor", filters.actor); if (filters.dateFrom) parameters.set("date_from", filters.dateFrom); if (filters.dateTo) parameters.set("date_to", filters.dateTo); if (filters.limit !== undefined) parameters.set("limit", String(filters.limit)); if (filters.offset !== undefined) parameters.set("offset", String(filters.offset)); return this.get(`/admin/action-logs?${parameters}`); }
  async previewAdminActionUndo<Response>(actionId: string): Promise<Response> { return this.get(`/admin/action-logs/${encodeURIComponent(actionId)}/undo-preview`); }
  async undoAdminAction<Response>(actionId: string, strategy: "preserve_newer" | "cascade"): Promise<Response> { return this.request(`/admin/action-logs/${encodeURIComponent(actionId)}/undo`, { method: "POST", body: JSON.stringify({ strategy }) }); }

  async getRecipes(filters: RecipeFilters = {}): Promise<RecipeList> {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") parameters.set(key, String(value));
    return this.get<RecipeList>(`/recipes${parameters.size ? `?${parameters}` : ""}`);
  }

  async getRecipe(recipeId: string): Promise<RecipeDetail> {
    return this.get<RecipeDetail>(`/recipes/${encodeURIComponent(recipeId)}`);
  }

  async setRecipeFavourite(recipeId: string, favourite: boolean): Promise<void> {
    await this.request<void>(`/recipes/${encodeURIComponent(recipeId)}/favourite`, { method: favourite ? "PUT" : "DELETE" });
  }

  private async get<Response>(path: string): Promise<Response> {
    return this.request<Response>(path);
  }

  async getModerationQueue<Response>(state: "pending" | "resolved" | "all" = "pending", offset = 0, search = ""): Promise<Response> { return this.get(`/reports/moderation?state=${state}&offset=${offset}&limit=25&search=${encodeURIComponent(search)}`); }
  async decideContentReport<Response>(issueId: string, body: { decision: "upheld" | "dismissed"; note: string; expected_pending_count: number }): Promise<Response> { return this.request(`/reports/moderation/issues/${encodeURIComponent(issueId)}/decision`, { method: "POST", body: JSON.stringify(body) }); }
  async decideRecipeFeedbackFlag<Response>(flagId: string, body: { decision: "removed" | "dismissed"; note: string }): Promise<Response> { return this.request(`/reports/moderation/feedback-flags/${encodeURIComponent(flagId)}/decision`, { method: "POST", body: JSON.stringify(body) }); }

  private async request<Response>(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.accessToken?.();
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => undefined) as { error?: string; message?: string; details?: ErrorResponse["details"]; timestamp?: string; detail?: string | Array<{ loc?: Array<string | number>; msg?: string }> } | undefined;
      const validationDetails = Array.isArray(body?.detail)
        ? body.detail.map((issue) => ({ field: String(issue.loc?.at(-1) ?? "request"), message: issue.msg ?? "This value is invalid." }))
        : null;
      const error: ErrorResponse | undefined = body ? {
        error: body.error ?? (validationDetails ? "validation_error" : "request_error"),
        message: body.message ?? (typeof body.detail === "string" ? body.detail : validationDetails ? "Request validation failed." : `API request failed with status ${response.status}.`),
        details: body.details ?? validationDetails,
        timestamp: body.timestamp ?? new Date().toISOString(),
      } : undefined;
      throw new ApiClientError(response.status, error);
    }

    if (response.status === 204) {
      return undefined as Response;
    }

    return response.json() as Promise<Response>;
  }
}
