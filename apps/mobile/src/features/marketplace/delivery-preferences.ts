import type { Address } from "@ecochef/contracts";

let selectedAddressId: string | undefined;
let arrivalAt: string | undefined;
let temporaryLocation: MarketplaceTemporaryLocation | undefined;
let editingAddressId: string | undefined;

export const MARKETPLACE_RECENT_LOCATIONS_KEY = "ecochef.marketplace.recent-locations";
export type MarketplaceTemporaryLocation = {
  name?: string;
  address_line_1: string;
  city: string;
  state: string;
  postal_code: string;
  latitude: number;
  longitude: number;
};

export type MarketplaceLocationDraft = {
  label: string;
  addressType: "saved" | "home" | "work" | "school";
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  latitude?: number;
  longitude?: number;
  details: string;
  driverNote: string;
};

const emptyDraft = (): MarketplaceLocationDraft => ({
  label: "",
  addressType: "saved",
  addressLine1: "",
  city: "",
  state: "",
  postalCode: "",
  details: "",
  driverNote: "",
});
let locationDraft = emptyDraft();

export function chooseMarketplaceAddress(addressId: string) {
  selectedAddressId = addressId;
  temporaryLocation = undefined;
}

export function consumeMarketplaceAddress() {
  return selectedAddressId;
}

export function setMarketplaceArrival(value?: string) {
  arrivalAt = value;
}

export function getMarketplaceArrival() {
  return arrivalAt;
}

export function chooseMarketplaceTemporaryLocation(location: MarketplaceTemporaryLocation) {
  temporaryLocation = location;
  selectedAddressId = undefined;
}

export function getMarketplaceTemporaryLocation() {
  return temporaryLocation;
}

export function getMarketplaceLocationDraft() {
  return locationDraft;
}
export function updateMarketplaceLocationDraft(update: Partial<MarketplaceLocationDraft>) {
  locationDraft = { ...locationDraft, ...update };
}
export function startMarketplaceLocationEdit(address: Address) {
  editingAddressId = address.id;
  locationDraft = {
    label: address.label ?? "",
    addressType: address.address_type ?? "saved",
    addressLine1: address.address_line_1,
    city: address.city,
    state: address.state,
    postalCode: address.postal_code,
    latitude: address.latitude,
    longitude: address.longitude,
    details: address.address_line_2 ?? "",
    driverNote: address.delivery_note ?? "",
  };
}
export function getMarketplaceEditingAddressId() {
  return editingAddressId;
}
export function clearMarketplaceLocationDraft() {
  locationDraft = emptyDraft();
  editingAddressId = undefined;
}

let fulfillmentMethod: "delivery" | "pickup" = "delivery";
export const getMarketplaceFulfillment = () => fulfillmentMethod;
export function setMarketplaceFulfillment(value: "delivery" | "pickup") {
  fulfillmentMethod = value;
}
