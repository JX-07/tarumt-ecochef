import { useCallback, useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";

import { apiBaseUrl } from "../../../lib/api-url";
import { createMobileApi } from "../../../lib/api";
import { AppMessageModal } from "../../../shared/components/app-message-modal";
import { ingredientEmojiFor } from "../../../shared/ingredient-icons";
import { useAuth } from "../../auth/auth-provider";
import { ShoppingListPage, type ShoppingCompletionItem } from "../components/shopping-list-sheet";
import type { PlannedShoppingList } from "../types";

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
};

export function ShoppingListScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const selectedDate =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today();
  const [message, setMessage] = useState<{
    title: string;
    message: string;
    tone: "success" | "error" | "info";
  }>();
  const load = useCallback(
    (from: string, to: string) => api.getMyShoppingList<PlannedShoppingList>(from, to),
    [api],
  );
  const complete = useCallback(
    async (items: ShoppingCompletionItem[]) => {
      await api.addInventoryItems(
        items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          expiry_date: item.expiry_date,
          category: "Shopping list",
          source: "shopping",
          icon: ingredientEmojiFor(item.name),
        })),
      );
    },
    [api],
  );

  return (
    <>
      <ShoppingListPage
        selectedDate={selectedDate}
        load={load}
        onComplete={complete}
        onMessage={(copy, tone = "info") =>
          setMessage({ title: "Shopping List", message: copy, tone })
        }
      />
      <AppMessageModal
        visible={Boolean(message)}
        title={message?.title ?? "Shopping List"}
        message={message?.message ?? ""}
        tone={message?.tone}
        onClose={() => setMessage(undefined)}
      />
    </>
  );
}
