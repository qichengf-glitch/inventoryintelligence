"use client";

import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { saveSafetyStock, type SafetyStockRow } from "@/lib/SafetyStockStore";

type SafetyStockUploaderProps = {
  companyKey: string;
  onUploaded?: () => void;
};

export default function SafetyStockUploader({ companyKey, onUploaded }: SafetyStockUploaderProps) {
  const [status, setStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsArrayBuffer(file);

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // 转换为二维数组
        type RawCell = string | number | boolean | null | undefined;
        type RawRow = RawCell[];
        const rawData = XLSX.utils.sheet_to_json<RawRow>(worksheet, { header: 1 });

        if (!rawData || rawData.length === 0) {
          setStatus("⚠️ 文件为空或格式错误");
          return;
        }

        // 寻找表头行
        let headerRowIndex = -1;
        let headers: string[] = [];

        for (let i = 0; i < Math.min(rawData.length, 20); i++) {
          const rowStr = rawData[i].join(" ").toLowerCase();
          if (
            (rowStr.includes("型号") || rowStr.includes("sku") || rowStr.includes("model")) &&
            (rowStr.includes("安全库存") || rowStr.includes("safety") || rowStr.includes("客户类型") || rowStr.includes("customer"))
          ) {
            headerRowIndex = i;
            headers = rawData[i].map(String);
            break;
          }
        }

        if (headerRowIndex === -1) {
          setStatus("⚠️ 未找到表头行，请确保文件包含'型号'和'安全库存'列");
          return;
        }

        // 找到列索引
        const getColIndex = (keywords: string[]) => {
          for (const kw of keywords) {
            const idx = headers.findIndex((h) => h.toLowerCase().includes(kw.toLowerCase()));
            if (idx >= 0) return idx;
          }
          return -1;
        };

        const skuIdx = getColIndex(["型号", "sku", "model", "产品", "product"]);
        const customerTypeIdx = getColIndex(["客户类型", "customer", "客户", "type"]);
        const safetyStockIdx = getColIndex(["安全库存", "safety", "safety stock", "安全"]);

        if (skuIdx === -1 || safetyStockIdx === -1) {
          setStatus("⚠️ 缺少必要列：需要'型号'和'安全库存'列");
          return;
        }

        // 解析数据
        const rows: SafetyStockRow[] = [];
        const seen = new Set<string>();

        for (let i = headerRowIndex + 1; i < rawData.length; i++) {
          const row = rawData[i];
          if (!row || row.length === 0) continue;

          const sku = String(row[skuIdx] ?? "").trim();
          const customerType = customerTypeIdx >= 0 ? String(row[customerTypeIdx] ?? "").trim() : "";
          const safetyStockVal = row[safetyStockIdx];

          if (!sku) continue;

          const safetyStock = Number(safetyStockVal);
          if (!Number.isFinite(safetyStock) || safetyStock < 0) continue;

          // 如果有客户类型，使用 sku|customerType 作为 key
          const key = customerType ? `${sku}|${customerType}` : sku;

          // 避免重复（保留最后一个）
          if (seen.has(key)) {
            const existingIdx = rows.findIndex((r) => (r as any).__key === key);
            if (existingIdx >= 0) rows.splice(existingIdx, 1);
          }

          rows.push({
            sku: key, // 存储时使用组合key
            safetyStock: Math.round(safetyStock),
          } as SafetyStockRow & { __key: string });

          (rows[rows.length - 1] as any).__key = key;
          seen.add(key);
        }

        // 清理临时属性
        rows.forEach((r) => delete (r as any).__key);

        if (rows.length === 0) {
          setStatus("⚠️ 未解析到有效数据");
          return;
        }

        // 保存到 localStorage
        saveSafetyStock(companyKey, rows);
        setStatus(`✅ 成功导入 ${rows.length} 条安全库存配置`);
        onUploaded?.();

        // 清空文件输入
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      } catch (error) {
        console.error("Upload error:", error);
        setStatus("⚠️ 解析失败：" + (error instanceof Error ? error.message : String(error)));
      }
    };

    reader.onerror = () => {
      setStatus("⚠️ 文件读取失败");
    };
  };

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleUpload}
        className="block w-full text-xs text-slate-600 dark:text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700"
      />
      {status && (
        <div
          className={`text-xs px-3 py-2 rounded-lg ${
            status.startsWith("✅")
              ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
              : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
          }`}
        >
          {status}
        </div>
      )}
    </div>
  );
}


