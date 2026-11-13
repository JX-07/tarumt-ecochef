"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createAuthenticatedWebApi } from "../../../src/lib/api";
export type ProductAddon = {
  name: string;
  required: boolean;
  selection_mode: "single" | "multiple";
  max_selections: number;
  options: Array<{ name: string; price: number }>;
};
export type ProductDiscount = (
  | { type: "percentage" | "fixed_amount"; value: number }
  | { type: "buy_x_get_y"; buy_quantity: number; gift_quantity: number }
) & { starts_at: string; ends_at: string };
export type Product = {
  id: string;
  store_id: string;
  name: string;
  description?: string;
  price: number;
  stock_quantity: number;
  status: "active" | "hidden" | "sold_out";
  category?: string;
  subcategory?: string;
  unit_label?: string;
  brand?: string;
  size?: string;
  image_url?: string;
  original_price?: number;
  expiry_date?: string;
  addons?: ProductAddon[];
  discount?: ProductDiscount;
};
export type Shop = {
  slot_order_limit?: number;
  slot_item_limit?: number;
  id: string;
  name: string;
  address: string;
  status: string;
  products: Product[];
  category?: string;
  description?: string;
  delivery_fee: number;
  phone_number?: string;
  operating_hours?: string;
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
  cover_image_url?: string;
  operating_hours_schedule?: Record<string, { open: string; close: string; closed: boolean }>;
  is_owner: boolean;
  can_edit_store: boolean;
};
type State = {
  stores: Shop[];
  ownerName: string;
  ownerEmail: string;
  loading: boolean;
  error?: string;
  reload: () => Promise<void>;
  refreshProducts: () => Promise<void>;
};
const Context = createContext<State>({
  stores: [],
  ownerName: "Business",
  ownerEmail: "",
  loading: true,
  reload: async () => {},
  refreshProducts: async () => {},
});

export function VendorProvider({ children }: { children: React.ReactNode }) {
  const [stores, setStores] = useState<Shop[]>([]);
  const [ownerName, setOwnerName] = useState("Business");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const storeRequest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++storeRequest.current;
    setLoading(true);
    try {
      const client = createAuthenticatedWebApi("/api/ecochef");
      const [data, owner] = await Promise.all([client.getVendorStores(), client.getCurrentUser()]);
      if (request === storeRequest.current) setStores(data.stores as Shop[]);
      setOwnerName(owner.name);
      setOwnerEmail(owner.email);
      setError(undefined);
    } catch {
      setError("Sign in with a verified Business account to access this workspace.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshProducts = useCallback(async () => {
    const request = ++storeRequest.current;
    const data = await createAuthenticatedWebApi("/api/ecochef").getVendorStores();
    if (request === storeRequest.current) setStores(data.stores as Shop[]);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  return (
    <Context.Provider
      value={{ stores, ownerName, ownerEmail, loading, error, reload, refreshProducts }}
    >
      {children}
    </Context.Provider>
  );
}

export const useVendor = () => useContext(Context);
