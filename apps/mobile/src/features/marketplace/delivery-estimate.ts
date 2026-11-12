export const deliveryEstimateLabel = (minutes?: number) => {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return "Delivery time unavailable";
  const lower = Math.max(10, Math.round((minutes - 5) / 5) * 5);
  const upper = Math.max(lower + 5, Math.round((minutes + 5) / 5) * 5);
  return `${lower}–${upper} min`;
};

