"""
Inventory Intelligence — ML Forecast Training Script
======================================================
目标：以 LightGBM 全局模型对所有 SKU 做月度出库量预测，
      结果写入 Supabase ml_forecast_results 表。

使用方式（本地运行）：
  pip install lightgbm scikit-learn pandas numpy python-dotenv supabase
  python scripts/ml_forecast/train.py

环境变量（.env.local 或系统环境变量）：
  SUPABASE_URL      - Supabase 项目 URL
  SUPABASE_SERVICE_KEY 或 SUPABASE_ANON_KEY - Supabase 密钥
  DATASET_DIR       - 清洗后 CSV 目录（默认：I&I_dataset/Cleaned Data/csv）
  APPENDIX_PATH     - SKU 品类映射文件（默认：I&I_dataset/Appendix.csv）
  FORECAST_HORIZON  - 预测未来月数（默认：6）
  ML_MODEL_VERSION  - 版本标签（默认：lgbm-v1）
"""

import os
import glob
import warnings
import json
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

# ──────────────────────────────────────────────
# 0. 配置
# ──────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    # 优先读项目根目录的 .env.local
    load_dotenv(Path(__file__).parent.parent.parent / "frontend" / ".env.local")
    load_dotenv(Path(__file__).parent.parent.parent / ".env.local")
    load_dotenv()
except ImportError:
    pass

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_KEY")
    or os.environ.get("SUPABASE_ANON_KEY")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
)
DATASET_DIR  = os.environ.get("DATASET_DIR",
    str(Path(__file__).parent.parent.parent / "I&I_dataset" / "Cleaned Data" / "csv"))
APPENDIX_PATH = os.environ.get("APPENDIX_PATH",
    str(Path(__file__).parent.parent.parent / "I&I_dataset" / "Appendix.csv"))
FORECAST_HORIZON = int(os.environ.get("FORECAST_HORIZON", "6"))
MODEL_VERSION    = os.environ.get("ML_MODEL_VERSION", "lgbm-v1")
TABLE_NAME       = "ml_forecast_results"

print(f"[config] dataset_dir={DATASET_DIR}")
print(f"[config] forecast_horizon={FORECAST_HORIZON}  version={MODEL_VERSION}")

# ──────────────────────────────────────────────
# 1. 读取并聚合数据
# ──────────────────────────────────────────────
def load_data(dataset_dir: str, appendix_path: str) -> pd.DataFrame:
    files = sorted(glob.glob(os.path.join(dataset_dir, "*.csv")))
    if not files:
        raise FileNotFoundError(f"没有找到 CSV 文件：{dataset_dir}")
    print(f"[load] 找到 {len(files)} 个月度文件")

    dfs = []
    for f in files:
        try:
            df = pd.read_csv(f, low_memory=False)
            dfs.append(df)
        except Exception as e:
            print(f"  [warn] 跳过 {f}：{e}")
    raw = pd.concat(dfs, ignore_index=True)

    # 聚合到 SKU-月粒度（出库量求和）
    agg = (
        raw.groupby(["SKU", "Time"], as_index=False)
        .agg(month_out=("month_out", "sum"),
             month_in=("month_in", "sum"),
             month_end_stock=("month_end_stock", "sum"))
    )
    agg = agg.rename(columns={"Time": "month"})
    agg["month"] = pd.to_datetime(agg["month"], format="%Y-%m")
    agg = agg.sort_values(["SKU", "month"]).reset_index(drop=True)

    # 附加品类信息
    if os.path.exists(appendix_path):
        cat = pd.read_csv(appendix_path, low_memory=False)
        cat.columns = [c.strip() for c in cat.columns]
        cat = cat.rename(columns={"SKU": "SKU", "Category": "category"})
        cat = cat[["SKU", "category"]].drop_duplicates("SKU")
        agg = agg.merge(cat, on="SKU", how="left")
    else:
        agg["category"] = "Unknown"

    print(f"[load] 聚合后：{len(agg)} 行，{agg['SKU'].nunique()} 个 SKU")
    return agg


# ──────────────────────────────────────────────
# 2. 特征工程
# ──────────────────────────────────────────────
def add_abc_xyz(df: pd.DataFrame) -> pd.DataFrame:
    """简单 ABC（按总出库量）和 XYZ（按变异系数）分类。"""
    sku_total = df.groupby("SKU")["month_out"].sum()
    total = sku_total.sum()
    cum = sku_total.sort_values(ascending=False).cumsum() / total
    abc = pd.cut(cum, bins=[-0.001, 0.7, 0.9, 1.0],
                 labels=["A", "B", "C"]).rename("abc_class")

    sku_cv = (df.groupby("SKU")["month_out"]
               .apply(lambda x: x.std() / (x.mean() + 1e-9)))
    xyz = pd.cut(sku_cv, bins=[-0.001, 0.5, 1.0, 1e9],
                 labels=["X", "Y", "Z"]).rename("xyz_class")

    meta = pd.DataFrame({"abc_class": abc, "xyz_class": xyz}).reset_index()
    return df.merge(meta, on="SKU", how="left")


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    df = add_abc_xyz(df)

    # Encode 类别变量
    df["category_code"] = pd.Categorical(df["category"]).codes
    df["abc_code"] = pd.Categorical(df["abc_class"]).codes
    df["xyz_code"] = pd.Categorical(df["xyz_class"]).codes

    # 时间特征
    df["month_num"] = df["month"].dt.month          # 1-12
    df["quarter"]   = df["month"].dt.quarter         # 1-4

    # 对每个 SKU 单独建特征（按时间排序）
    feature_rows = []
    for sku, grp in df.groupby("SKU"):
        grp = grp.sort_values("month").reset_index(drop=True)
        n = len(grp)

        lag_cols = {}
        for lag in [1, 2, 3, 4, 6]:
            lag_cols[f"lag_{lag}"] = grp["month_out"].shift(lag)

        # 滚动统计（基于 lag-1 以避免数据泄漏）
        shifted = grp["month_out"].shift(1)
        lag_cols["roll3_mean"] = shifted.rolling(3, min_periods=1).mean()
        lag_cols["roll3_std"]  = shifted.rolling(3, min_periods=1).std().fillna(0)
        lag_cols["roll6_mean"] = shifted.rolling(6, min_periods=1).mean()
        lag_cols["roll6_max"]  = shifted.rolling(6, min_periods=1).max()

        # 库存滞后
        lag_cols["stock_lag1"] = grp["month_end_stock"].shift(1)

        lag_df = pd.DataFrame(lag_cols)
        grp = pd.concat([grp.reset_index(drop=True), lag_df], axis=1)
        feature_rows.append(grp)

    result = pd.concat(feature_rows, ignore_index=True)
    return result


FEATURE_COLS = [
    "lag_1", "lag_2", "lag_3", "lag_4", "lag_6",
    "roll3_mean", "roll3_std", "roll6_mean", "roll6_max",
    "stock_lag1",
    "month_num", "quarter",
    "category_code", "abc_code", "xyz_code",
]
TARGET_COL = "month_out"


# ──────────────────────────────────────────────
# 3. Walk-forward 交叉验证
# ──────────────────────────────────────────────
def walk_forward_cv(df: pd.DataFrame, months: list, min_train: int = 6):
    """按月份走向前验证，返回每个 SKU 的误差指标。"""
    try:
        import lightgbm as lgb
        use_lgb = True
    except ImportError:
        from sklearn.ensemble import GradientBoostingRegressor
        use_lgb = False
        print("[warn] LightGBM 未安装，退回到 sklearn GradientBoosting（速度较慢）")

    results = []  # (sku, mae, rmse, mape)
    test_months = months[min_train:]

    if not test_months:
        print("[cv] 月份数不足，跳过交叉验证")
        return pd.DataFrame(columns=["SKU", "mae", "rmse", "mape"])

    all_preds = []
    all_actuals = []
    all_skus = []

    for i, test_month in enumerate(test_months):
        train_months = months[:min_train + i]
        train_df = df[df["month"].isin(train_months)].dropna(subset=FEATURE_COLS)
        test_df  = df[df["month"] == test_month].dropna(subset=FEATURE_COLS)
        if len(train_df) < 10 or len(test_df) == 0:
            continue

        X_train = train_df[FEATURE_COLS].values
        y_train = train_df[TARGET_COL].values.clip(0)
        X_test  = test_df[FEATURE_COLS].values
        y_test  = test_df[TARGET_COL].values

        if use_lgb:
            model = lgb.LGBMRegressor(
                n_estimators=200, learning_rate=0.05,
                num_leaves=31, min_child_samples=5,
                random_state=42, verbose=-1,
            )
        else:
            model = GradientBoostingRegressor(
                n_estimators=100, learning_rate=0.1,
                max_depth=4, random_state=42,
            )

        model.fit(X_train, y_train)
        preds = model.predict(X_test).clip(0)

        all_preds.extend(preds)
        all_actuals.extend(y_test)
        all_skus.extend(test_df["SKU"].tolist())

    if not all_preds:
        return pd.DataFrame(columns=["SKU", "mae", "rmse", "mape"])

    cv_df = pd.DataFrame({"SKU": all_skus, "pred": all_preds, "actual": all_actuals})
    metrics = []
    for sku, g in cv_df.groupby("SKU"):
        mae  = float(np.mean(np.abs(g["pred"] - g["actual"])))
        rmse = float(np.sqrt(np.mean((g["pred"] - g["actual"]) ** 2)))
        # MAPE: 只计算 actual > 0 的月份
        mask = g["actual"] > 0
        mape = float(np.mean(np.abs((g["pred"][mask] - g["actual"][mask]) / g["actual"][mask]))) \
               if mask.any() else None
        metrics.append({"SKU": sku, "mae": round(mae, 2), "rmse": round(rmse, 2),
                         "mape": round(mape, 4) if mape is not None else None})

    print(f"[cv] 完成 walk-forward 验证，{len(test_months)} 个测试月，"
          f"{len(metrics)} 个 SKU 有误差指标")
    return pd.DataFrame(metrics)


# ──────────────────────────────────────────────
# 4. 最终模型训练 + 预测
# ──────────────────────────────────────────────
def train_and_predict(df: pd.DataFrame, forecast_horizon: int) -> pd.DataFrame:
    """用全量数据训练，对未来 horizon 个月逐月滚动预测。"""
    try:
        import lightgbm as lgb
        use_lgb = True
    except ImportError:
        from sklearn.ensemble import GradientBoostingRegressor
        use_lgb = False

    # 训练集：丢弃 NaN 特征行
    train_df = df.dropna(subset=FEATURE_COLS)
    X_train  = train_df[FEATURE_COLS].values
    y_train  = train_df[TARGET_COL].values.clip(0)

    if use_lgb:
        model = lgb.LGBMRegressor(
            n_estimators=300, learning_rate=0.04,
            num_leaves=31, min_child_samples=5,
            random_state=42, verbose=-1,
        )
    else:
        from sklearn.ensemble import GradientBoostingRegressor
        model = GradientBoostingRegressor(
            n_estimators=150, learning_rate=0.08,
            max_depth=4, random_state=42,
        )

    model.fit(X_train, y_train)
    print(f"[train] 模型训练完成（{'LightGBM' if use_lgb else 'GradientBoosting'}），"
          f"特征数={len(FEATURE_COLS)}")

    # ── 滚动预测每个 SKU 未来 horizon 个月 ──
    all_skus = df["SKU"].unique()
    last_month = df["month"].max()
    meta = df.drop_duplicates("SKU")[["SKU", "category_code", "abc_code", "xyz_code"]]

    prediction_rows = []

    for sku in all_skus:
        sku_df = df[df["SKU"] == sku].sort_values("month").reset_index(drop=True)
        if sku_df.empty:
            continue

        # 维护一个滚动窗口（最多保留最近 12 个月用于 lag 计算）
        history_out   = list(sku_df["month_out"].values)
        history_stock = list(sku_df["month_end_stock"].values)
        sku_meta = meta[meta["SKU"] == sku].iloc[0]

        for h in range(1, forecast_horizon + 1):
            target_month = last_month + pd.DateOffset(months=h)

            # 构建特征向量
            def safe_lag(arr, lag):
                idx = len(arr) - lag
                return float(arr[idx]) if idx >= 0 else 0.0

            lag1 = safe_lag(history_out, 1)
            lag2 = safe_lag(history_out, 2)
            lag3 = safe_lag(history_out, 3)
            lag4 = safe_lag(history_out, 4)
            lag6 = safe_lag(history_out, 6)

            recent3 = history_out[-3:] if len(history_out) >= 3 else history_out
            recent6 = history_out[-6:] if len(history_out) >= 6 else history_out
            shifted_for_roll = history_out[:-0] if len(history_out) >= 1 else [0]

            r3m = float(np.mean(recent3)) if recent3 else 0.0
            r3s = float(np.std(recent3))  if len(recent3) > 1 else 0.0
            r6m = float(np.mean(recent6)) if recent6 else 0.0
            r6max = float(np.max(recent6)) if recent6 else 0.0
            s_lag1 = float(history_stock[-1]) if history_stock else 0.0

            X_pred = np.array([[
                lag1, lag2, lag3, lag4, lag6,
                r3m, r3s, r6m, r6max,
                s_lag1,
                target_month.month, target_month.quarter,
                int(sku_meta["category_code"]),
                int(sku_meta["abc_code"]),
                int(sku_meta["xyz_code"]),
            ]])

            pred = float(model.predict(X_pred).clip(0)[0])

            prediction_rows.append({
                "SKU": sku,
                "target_month": target_month.strftime("%Y-%m"),
                "predicted_qty": round(pred, 2),
            })

            # 将预测值加入历史（用于下一个 horizon step 的 lag 特征）
            history_out.append(pred)
            history_stock.append(s_lag1)  # 简化：库存延用上期

    pred_df = pd.DataFrame(prediction_rows)
    print(f"[predict] 生成预测 {len(pred_df)} 条（{len(all_skus)} SKU × {forecast_horizon} 个月）")
    return pred_df


# ──────────────────────────────────────────────
# 5. 写入 Supabase
# ──────────────────────────────────────────────
def push_to_supabase(pred_df: pd.DataFrame, metrics_df: pd.DataFrame,
                     model_version: str, trained_at: str):
    """将预测结果 + 误差指标写入 Supabase ml_forecast_results 表。"""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[supabase] ⚠  未设置 SUPABASE_URL / SUPABASE_KEY，跳过上传。")
        print("            结果已保存为本地 CSV: ml_forecast_output.csv")
        return

    try:
        from supabase import create_client
    except ImportError:
        print("[supabase] supabase-py 未安装（pip install supabase），跳过上传。")
        return

    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # 合并误差指标
    merged = pred_df.merge(
        metrics_df[["SKU", "mae", "rmse", "mape"]] if not metrics_df.empty
        else pd.DataFrame(columns=["SKU", "mae", "rmse", "mape"]),
        on="SKU", how="left",
    )
    merged["model_version"] = model_version
    merged["trained_at"]    = trained_at

    # NaN / Inf → None，避免 JSON 序列化报错
    merged_clean = merged.rename(columns={"SKU": "sku"})
    merged_clean = merged_clean.where(pd.notna(merged_clean), other=None)
    # 额外处理 float inf（极端情况）
    import math
    def _safe(v):
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return None
        return v
    records = [{k: _safe(v) for k, v in row.items()} for row in merged_clean.to_dict(orient="records")]

    # 先删除同版本旧数据
    print(f"[supabase] 清除旧版本 {model_version} 数据...")
    client.table(TABLE_NAME).delete().eq("model_version", model_version).execute()

    # 分批插入（Supabase 建议 ≤ 500 行/批）
    batch_size = 500
    total = len(records)
    errors = 0
    for i in range(0, total, batch_size):
        batch = records[i : i + batch_size]
        resp = client.table(TABLE_NAME).insert(batch).execute()
        if hasattr(resp, "error") and resp.error:
            print(f"  [warn] 批次 {i//batch_size+1} 插入失败：{resp.error}")
            errors += 1
        else:
            print(f"  [ok] 批次 {i//batch_size+1}：{len(batch)} 行已写入")

    status = "✅ 完成" if errors == 0 else f"⚠  完成（{errors} 批次失败）"
    print(f"[supabase] {status}，共写入 {total} 条预测记录")


# ──────────────────────────────────────────────
# 6. 主流程
# ──────────────────────────────────────────────
def main():
    trained_at = datetime.utcnow().isoformat() + "Z"

    # 读取数据
    df_raw = load_data(DATASET_DIR, APPENDIX_PATH)

    # 特征工程
    print("[features] 构建特征中...")
    df_feat = build_features(df_raw)

    # 月份列表
    months = sorted(df_feat["month"].unique())
    print(f"[info] 月份范围：{months[0].strftime('%Y-%m')} → {months[-1].strftime('%Y-%m')}，共 {len(months)} 个月")

    # Walk-forward 验证
    print("[cv] 开始 walk-forward 交叉验证...")
    metrics_df = walk_forward_cv(df_feat, months, min_train=6)

    # 全量训练 + 预测
    print("[train] 用全量数据训练最终模型...")
    pred_df = train_and_predict(df_feat, FORECAST_HORIZON)

    # 保存本地备份
    output_path = Path(__file__).parent / "ml_forecast_output.csv"
    merged_out = pred_df.merge(
        metrics_df if not metrics_df.empty else pd.DataFrame(columns=["SKU", "mae", "rmse", "mape"]),
        on="SKU", how="left"
    )
    merged_out["model_version"] = MODEL_VERSION
    merged_out["trained_at"]    = trained_at
    merged_out.to_csv(output_path, index=False)
    print(f"[save] 本地备份：{output_path}")

    # 上传 Supabase
    push_to_supabase(pred_df, metrics_df, MODEL_VERSION, trained_at)

    # 打印汇总
    print("\n═══ 训练完成 ═══")
    print(f"  预测行数：{len(pred_df)}")
    if not metrics_df.empty:
        print(f"  全局平均 MAE：{metrics_df['mae'].mean():.2f}")
        print(f"  全局平均 RMSE：{metrics_df['rmse'].mean():.2f}")
        mape_valid = metrics_df["mape"].dropna()
        if not mape_valid.empty:
            print(f"  全局平均 MAPE：{mape_valid.mean()*100:.1f}%")
    print(f"  模型版本：{MODEL_VERSION}")
    print(f"  训练时间：{trained_at}")


if __name__ == "__main__":
    main()
