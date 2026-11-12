import { ApiClient } from "@ecochef/api-client";

import { getCurrentFirebaseIdToken } from "./auth";

export const createWebApi = (
  baseUrl: string,
  getFirebaseIdToken?: () => string | undefined | Promise<string | undefined>,
): ApiClient => new ApiClient({ baseUrl, accessToken: getFirebaseIdToken });

export const createAuthenticatedWebApi = (baseUrl: string, forceRefresh = false): ApiClient =>
  createWebApi(baseUrl, () => getCurrentFirebaseIdToken(forceRefresh));
