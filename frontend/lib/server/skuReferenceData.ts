import path from "path";
import { access, readFile } from "fs/promises";

import * as XLSX from "xlsx";

type SkuReferenceData = {
  safetyStockBySku: Record<string, number>;
  categoryBySku: Record<string, string>;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { loadedAt: number; data: SkuReferenceData } | null = null;

export function normalizeSkuCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

async function findExistingPath(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function resolveCsvCandidates(fileName: string) {
  return [
    path.resolve(process.cwd(), "I&I_dataset", fileName),
    path.resolve(process.cwd(), "../I&I_dataset", fileName),
    path.resolve(process.cwd(), "../../I&I_dataset", fileName),
  ];
}

async function readCsvRows(fileName: string): Promise<Array<Record<string, unknown>>> {
  const csvPath = await findExistingPath(resolveCsvCandidates(fileName));
  if (!csvPath) {
    console.warn(`[sku-ref] file not found: ${fileName}`);
    return [];
  }

  const csvContent = await readFile(csvPath, "utf-8");
  const workbook = XLSX.read(csvContent, { type: "string" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
    defval: "",
  });
}

function pickFirst(row: Record<string, unknown>, keys: string[]) {
  const normalizeHeaderKey = (value: string) =>
    value
      .replace(/^\ufeff/, "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");

  const normalizedRow = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    normalizedRow.set(normalizeHeaderKey(key), value);
  }

  for (const key of keys) {
    const value = normalizedRow.get(normalizeHeaderKey(key));
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }

  return "";
}

function parseSafetyStock(value: unknown) {
  if (value == null) return null;
  const raw = String(value).trim().replace(/,/g, "");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

async function loadSafetyStockBySku() {
  const rows = await readCsvRows("SafetyStock_Config.csv");
  const safetyStockBySku: Record<string, number> = {};

  for (const row of rows) {
    const sku = normalizeSkuCode(pickFirst(row, ["SKU", "sku", "Model", "型号"]));
    if (!sku) continue;

    const parsed = parseSafetyStock(
      pickFirst(row, ["Safety_Stock", "safety_stock", "Safety Stock", "安全库存"])
    );
    if (parsed == null) continue;

    // Duplicate SKUs exist; keep the max threshold for conservative risk detection.
    const previous = safetyStockBySku[sku];
    safetyStockBySku[sku] = previous == null ? parsed : Math.max(previous, parsed);
  }

  return safetyStockBySku;
}

async function loadCategoryBySku() {
  const rows = await readCsvRows("Appendix.csv");
  const categoryBySku: Record<string, string> = {};

  for (const row of rows) {
    const sku = normalizeSkuCode(pickFirst(row, ["SKU", "sku", "Model", "型号"]));
    if (!sku) continue;
    const category = pickFirst(row, ["Category", "category", "类别"]);
    if (!category) continue;

    if (!categoryBySku[sku]) {
      categoryBySku[sku] = category;
    }
  }

  return categoryBySku;
}

export async function loadSkuReferenceData(): Promise<SkuReferenceData> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  const [safetyStockBySku, categoryBySku] = await Promise.all([
    loadSafetyStockBySku(),
    loadCategoryBySku(),
  ]);

  const data = { safetyStockBySku, categoryBySku };
  cache = { loadedAt: Date.now(), data };
  console.log("[sku-ref] loaded", {
    safetySkuCount: Object.keys(safetyStockBySku).length,
    categorySkuCount: Object.keys(categoryBySku).length,
  });

  return data;
}
