export type DashboardPeriod = "today" | "week" | "month" | "year";
export type DashboardData = {
  summary: { revenue: number; sales: number; orders: number; products: number; deals: number };
  period: {
    key: DashboardPeriod;
    label: string;
    start_date: string;
    end_date: string;
    timezone: string;
  };
  store: { id: string; name: string };
  generated_at: string;
  revenue: { day: string; amount: number }[];
  top_products: {
    id: string;
    name: string;
    category?: string;
    price: number;
    original_price?: number;
    sold: number;
  }[];
  reviews: {
    product_name: string;
    rating: number;
    comment?: string;
    name: string;
    date_submitted: string;
  }[];
  review_summary: { rating: number; count: number };
  live_orders: {
    id: string;
    customer_name: string;
    items: string;
    total: number;
    status: string;
    order_date?: string;
  }[];
  order_summary: {
    completed: number;
    cancelled: number;
    active: number;
    delivery: number;
    pickup: number;
    refunded?: number;
    customer_count?: number;
    items_sold?: number;
  };
  inventory: { listed: number; low_stock: number; out_of_stock: number };
  report_years: number[];
  notes?: string[];
};
