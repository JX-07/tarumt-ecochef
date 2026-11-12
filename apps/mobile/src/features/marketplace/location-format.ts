export type MarketplaceAddressParts = {
  address_line_1: string;
  city?: string;
  state?: string;
  postal_code?: string;
};

export function formatMarketplaceAddress(address: MarketplaceAddressParts) {
  const locality = [address.postal_code, address.city].filter(Boolean).join(" ");
  return [address.address_line_1, locality, address.state].filter(Boolean).join(", ");
}
