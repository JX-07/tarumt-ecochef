export type NotificationCategory =
  | "sensor_alert"
  | "ingredient_expiry"
  | "meal_reminder"
  | "payment"
  | "delivery"
  | "order"
  | "promotion"
  | "moderation";

export type EcoChefNotification = {
  id: string;
  category: NotificationCategory;
  title: string;
  message: string;
  action_path?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  read_at?: string;
};

export type NotificationList = {
  items: EcoChefNotification[];
  unread_count: number;
};

export type NotificationPreferences = {
  sensor_alerts: boolean;
  ingredient_expiry: boolean;
  meal_reminders: boolean;
  payment_updates: boolean;
  delivery_updates: boolean;
};
