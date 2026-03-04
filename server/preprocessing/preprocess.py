#!/usr/bin/env python3
"""
Basic CSV preprocessing pipeline.

Usage:
  python3 preprocess.py --input /tmp/raw.csv --output /tmp/cleaned.csv
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

CANONICAL_COLUMNS = [
    "sku",
    "batch",
    "last_month_stock",
    "month_in",
    "month_out",
    "month_sales",
    "month_end_stock",
    "note_value",
    "remark",
]

COLUMN_ALIASES = {
    "sku": ["sku", "SKU", "model", "型号"],
    "batch": ["batch", "批号"],
    "last_month_stock": ["last_month_stock", "Last_Month_Stock", "上月结存"],
    "month_in": ["month_in", "本月入库", "inbound"],
    "month_out": ["month_out", "本月领用", "outbound"],
    "month_sales": ["month_sales", "month_sale", "本月销售", "sales"],
    "month_end_stock": ["month_end_stock", "month_end_inventory", "本月结存", "current_balance"],
    "note_value": ["note_value", "Note_value", "小计"],
    "remark": ["remark", "Remark", "备注"],
}

NUMERIC_COLUMNS = [
    "last_month_stock",
    "month_in",
    "month_out",
    "month_sales",
    "month_end_stock",
    "note_value",
]


def choose_column(df: pd.DataFrame, aliases: list[str]) -> str | None:
    for col in aliases:
        if col in df.columns:
            return col
    return None


def normalize_frame(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame()

    for target in CANONICAL_COLUMNS:
        src = choose_column(df, COLUMN_ALIASES.get(target, []))
        if src is None:
            out[target] = "" if target in ("sku", "batch", "remark") else 0
        else:
            out[target] = df[src]

    # normalize text columns
    out["sku"] = out["sku"].astype(str).str.strip()
    out["batch"] = out["batch"].astype(str).str.strip()
    out["remark"] = out["remark"].astype(str).str.strip()

    # remove rows with empty SKU
    out = out[out["sku"].astype(str).str.len() > 0]

    # normalize numeric columns
    for col in NUMERIC_COLUMNS:
        out[col] = pd.to_numeric(out[col], errors="coerce").fillna(0)

    # remove duplicated (sku, batch) rows, keeping latest
    out = out.drop_duplicates(subset=["sku", "batch"], keep="last")

    return out[CANONICAL_COLUMNS]


def main() -> int:
    parser = argparse.ArgumentParser(description="Clean inventory CSV file")
    parser.add_argument("--input", required=True, help="Input CSV path")
    parser.add_argument("--output", required=True, help="Output CSV path")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        raise FileNotFoundError(f"Input file does not exist: {input_path}")

    df = pd.read_csv(input_path, dtype=str, keep_default_na=False)
    cleaned = normalize_frame(df)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    cleaned.to_csv(output_path, index=False, encoding="utf-8-sig")

    print(f"rows_in={len(df)} rows_out={len(cleaned)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
