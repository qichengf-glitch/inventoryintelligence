#!/usr/bin/env python3
"""
Inventory data preprocessing script.

Input  : 成品仓库报表 .xls files named like  2025年7月份成品仓库报表.xls
Output : cleaned .xlsx file named             2025-07_cleaned.xlsx

Usage:
    python preprocess.py <file.xls>        # single file
    python preprocess.py <directory/>      # all matching files in directory
"""

import re
import sys
import pandas as pd
from pathlib import Path

# ── filename ───────────────────────────────────────────────────────────────────

FILE_PATTERN = re.compile(r"\d{4}年\d{1,2}月份成品仓库报表\.xlsx?$")


def parse_time(name: str) -> str | None:
    m = re.search(r"(\d{4})年(\d{1,2})月", name)
    return f"{m.group(1)}-{m.group(2).zfill(2)}" if m else None


# ── regex helpers ──────────────────────────────────────────────────────────────

HAN = re.compile(r"[\u4e00-\u9fff]")
ZERO_BATCH = re.compile(r"^0+\.?0*$")  # 000000 / 0.0 / 0
FLOAT_TAIL = re.compile(r"^(-?\d+)\.0$")


def has_chinese(s: str) -> bool:
    return bool(HAN.search(s))


def is_zero_batch(s: str) -> bool:
    return bool(s) and bool(ZERO_BATCH.match(s))


# ── value converters ───────────────────────────────────────────────────────────

def to_str(v) -> str:
    """Return clean string; convert '25072260.0' → '25072260'."""
    s = str(v).strip()
    if s in ("", "nan"):
        return ""
    m = FLOAT_TAIL.match(s)
    return m.group(1) if m else s


def to_float(v) -> float:
    try:
        f = float(v)
        return f if f == f else 0.0  # NaN guard
    except (TypeError, ValueError):
        return 0.0


# ── header detection ───────────────────────────────────────────────────────────

def build_combined_headers(sheet, row1: int, row2: int) -> list[str]:
    """Concatenate text from two header rows per column, stripping whitespace."""
    return [
        (str(sheet.cell_value(row1, c)).strip()
         + str(sheet.cell_value(row2, c)).strip())
        for c in range(sheet.ncols)
    ]


def find_col(headers: list[str], *candidates: str) -> int | None:
    for cand in candidates:
        if cand in headers:
            return headers.index(cand)
    return None


def find_header_row(sheet) -> int:
    """Locate the first header row (contains '型' or '型号' in col 0)."""
    for r in range(min(12, sheet.nrows)):
        v = str(sheet.cell_value(r, 0)).strip()
        if v in ("型", "型号"):
            return r
    return 4  # safe fallback


# ── row filters ────────────────────────────────────────────────────────────────

SUMMARY_KW = ("合计", "小计", "总计", "合 计", "汇总")
NUM_FIELDS = ("last_month_stock", "month_in", "month_out",
              "month_sale", "sample_out", "month_end_stock", "note_value")


def is_blank_row(rec: dict) -> bool:
    """True when batch is empty and all numeric fields are zero."""
    return not rec["batch"] and all(rec[f] == 0.0 for f in NUM_FIELDS)


# ── sheet processor ────────────────────────────────────────────────────────────

# Mapping: output field → possible combined-header texts in the XLS
FIELD_HEADERS = {
    "sku":              ("型号",),
    "batch":            ("批号",),
    "last_month_stock": ("上月结存",),
    "month_in":         ("本月入库",),
    "month_out":        ("本月领用", "车间领用"),
    "month_sale":       ("本月销售", "本月出库销售"),
    "sample_out":       ("取样",),
    "month_end_stock":  ("本月结存",),
    "note_value":       ("小计",),
    "remark":           ("备注",),
}

OUTPUT_COLS = [
    "time", "sku", "batch",
    "last_month_stock", "month_in", "month_out", "month_sale",
    "sample_out", "month_end_stock", "note_value", "remark",
]


class PandasSheetAdapter:
    """Adapter to provide xlrd-like sheet access over a pandas DataFrame."""

    def __init__(self, df: pd.DataFrame) -> None:
        # Reconstruct a row-based matrix including the parsed header row.
        self._rows = [list(df.columns)] + df.values.tolist()
        self.nrows = len(self._rows)
        self.ncols = len(df.columns)

    def cell_value(self, row: int, col: int):
        if row >= self.nrows or col >= self.ncols:
            return ""
        val = self._rows[row][col]
        return "" if pd.isna(val) else val


def process_sheet(sheet, time_val: str, label: str) -> pd.DataFrame | None:
    hdr1 = find_header_row(sheet)
    hdr2 = hdr1 + 1
    data_start = hdr2 + 1

    combined = build_combined_headers(sheet, hdr1, hdr2)

    # Map fields to column indices
    ci: dict[str, int | None] = {}
    for field, candidates in FIELD_HEADERS.items():
        ci[field] = find_col(combined, *candidates)
        if ci[field] is None:
            print(f"  [{label}] WARNING: column '{field}' not found")

    def _float(field: str, raw: list) -> float:
        idx = ci.get(field)
        return to_float(raw[idx]) if idx is not None else 0.0

    def _str(field: str, raw: list) -> str:
        idx = ci.get(field)
        return to_str(raw[idx]) if idx is not None else ""

    rows = []
    current_sku = ""

    for r in range(data_start, sheet.nrows):
        raw = [sheet.cell_value(r, c) for c in range(sheet.ncols)]

        sku_raw = to_str(raw[ci["sku"]]) if ci["sku"] is not None else ""
        batch_raw = to_str(raw[ci["batch"]]) if ci["batch"] is not None else ""

        # ── skip rows with Chinese in the SKU column (series headers,
        #    summary rows, misc labels like "加工费")
        if has_chinese(sku_raw):
            continue

        # ── forward-fill SKU
        if sku_raw:
            current_sku = sku_raw

        if not current_sku:
            continue

        # ── skip summary rows (Chinese check above catches most; this
        #    catches rare cases where summary text is in batch column)
        if any(kw in batch_raw for kw in SUMMARY_KW):
            continue

        # ── batch cleanup
        batch_clean = to_str(raw[ci["batch"]]) if ci["batch"] is not None else ""

        # skip Chinese in batch
        if has_chinese(batch_clean):
            continue

        # skip all-zero batch  (e.g. 000000 / 0.0)
        if is_zero_batch(batch_clean):
            continue

        rec = {
            "time":             time_val,
            "sku":              current_sku,
            "batch":            batch_clean,
            "last_month_stock": _float("last_month_stock", raw),
            "month_in":         _float("month_in",         raw),
            "month_out":        _float("month_out",        raw),
            "month_sale":       _float("month_sale",       raw),
            "sample_out":       _float("sample_out",       raw),
            "month_end_stock":  _float("month_end_stock",  raw),
            "note_value":       _float("note_value",       raw),
            "remark":           _str("remark",             raw),
        }

        # skip blank placeholder rows (no batch + all zeros)
        if is_blank_row(rec):
            continue

        rows.append(rec)

    if not rows:
        return None
    return pd.DataFrame(rows)[OUTPUT_COLS]


# ── file-level pipeline ────────────────────────────────────────────────────────

def process_file(filepath: str, output_dir: str | None = None) -> None:
    path = Path(filepath)
    file_path = str(path)
    time_val = parse_time(path.name)
    if not time_val:
        print(f"ERROR: cannot parse date from '{path.name}'")
        return

    print(f"\n{'='*60}")
    print(f"  File : {path.name}")
    print(f"  Time : {time_val}")

    try:
        print("  Loading first sheet only (sheet index 0)...")
        # ====================================================
        # IMPORTANT:
        # Only process the FIRST sheet (finished goods table)
        # All other sheets are intentionally ignored.
        # ====================================================
        first_sheet_df = pd.read_excel(file_path, sheet_name=0)
        if first_sheet_df.empty or first_sheet_df.dropna(how="all").empty:
            raise ValueError("First sheet is empty. Expected finished goods table.")

        sheet = PandasSheetAdapter(first_sheet_df)
        print(f"  [Finished Goods] sheet_0  ({sheet.nrows}R × {sheet.ncols}C)")
        df = process_sheet(sheet, time_val, "sheet_0")
        if df is None:
            print("  No data extracted — skipping output.")
            return
        print(f"                   → {len(df)} rows kept")
        dfs: dict[str, pd.DataFrame] = {"成品表": df}
    except Exception as exc:
        print(f"ERROR: failed to process first sheet for '{path.name}': {exc}")
        raise

    out_dir = Path(output_dir) if output_dir else path.parent
    out_path = out_dir / f"{time_val}_cleaned.xlsx"

    with pd.ExcelWriter(str(out_path), engine="openpyxl") as writer:
        for sheet_key, df in dfs.items():
            df.to_excel(writer, sheet_name=sheet_key, index=False)

            # Extract big-customer rows into a dedicated sheet
            big = df[df["remark"].str.contains("大客户", na=False)]
            if len(big) > 0:
                bname = f"{sheet_key}_大客户"
                big.to_excel(writer, sheet_name=bname, index=False)
                print(f"  Big-customer rows in '{sheet_key}': {len(big)} → sheet '{bname}'")

    print(f"\n  ✓ Saved → {out_path}")


# ── directory batch mode ───────────────────────────────────────────────────────

def process_directory(directory: str) -> None:
    dir_path = Path(directory)
    files = sorted(
        f for f in dir_path.glob("*.xls*")
        if FILE_PATTERN.match(f.name)
    )

    if not files:
        print(f"No matching files found in: {directory}")
        return

    print(f"Found {len(files)} file(s):")
    for f in files:
        print(f"  {f.name}")

    for f in files:
        try:
            process_file(str(f), directory)
        except Exception as exc:
            print(f"\nERROR in {f.name}: {exc}")
            import traceback
            traceback.print_exc()


# ── entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    target = Path(sys.argv[1])
    if not target.exists():
        print(f"ERROR: '{target}' not found")
        sys.exit(1)

    if target.is_dir():
        process_directory(str(target))
    else:
        process_file(str(target))
