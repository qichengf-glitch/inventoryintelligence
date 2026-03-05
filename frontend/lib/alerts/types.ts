export type AlertStatus = "OOS" | "LOW" | "HIGH";

export type AlertItem = {
  sku: string;
  on_hand: number;
  safety_stock: number;
  high_stock: number;
  status: AlertStatus;
  suggested_action: string;
  suggested_replenish_qty: number;
};

export type AlertsResponse = {
  as_of: string;
  updated_at: string;
  counts: {
    oos: number;
    low: number;
    high: number;
  };
  top10: {
    oos: AlertItem[];
    low: AlertItem[];
    high: AlertItem[];
  };
  views: {
    oos: AlertItem[];
    low: AlertItem[];
    high: AlertItem[];
  };
};
