import { colors } from "@ecochef/design-tokens";
import type { AddressInput } from "@ecochef/contracts";
import type { Ionicons } from "@expo/vector-icons";

export type LocationType = NonNullable<AddressInput["address_type"]>;
export const locationTypes: {
  value: LocationType;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  background: string;
}[] = [
  {
    value: "saved",
    label: "Saved",
    icon: "heart",
    color: colors.danger,
    background: colors.dangerSoft,
  },
  {
    value: "home",
    label: "Home",
    icon: "home",
    color: colors.primaryStrong,
    background: colors.primarySoft,
  },
  {
    value: "work",
    label: "Work",
    icon: "briefcase",
    color: colors.adminStrong,
    background: colors.adminSoft,
  },
  {
    value: "school",
    label: "School",
    icon: "school",
    color: colors.marketStrong,
    background: colors.marketSoft,
  },
];

export const locationType = (value?: string) =>
  locationTypes.find((item) => item.value === value) ?? locationTypes[0];
