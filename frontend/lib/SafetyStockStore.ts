export type SafetyStockRow = {
  sku: string;
  safetyStock: number;
  leadTimeDays?: number;
  serviceLevel?: number;
};

const keyOf = (companyKey: string) => `ii:safetyStock:${companyKey}`;

export function saveSafetyStock(companyKey: string, rows: SafetyStockRow[]) {
  if (typeof window === 'undefined') return;
  const map: Record<string, SafetyStockRow> = {};
  for (const r of rows) {
    map[r.sku] = r;
  }
  localStorage.setItem(keyOf(companyKey), JSON.stringify(map));
}

export function loadSafetyStockMap(companyKey: string): Record<string, SafetyStockRow> {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(keyOf(companyKey));
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, SafetyStockRow>;
  } catch {
    return {};
  }
}
  