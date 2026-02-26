"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import * as XLSX from "xlsx"; // 引入强大的解析库

type InventoryItem = {
  id: string;
  model: string; // SKU
  batch: string;
  category?: string;
  lastBalance: number; // Last_Month_Stock
  inbound: number; // month_in
  outbound: number; // month_out
  sales: number; // month_sales
  currentBalance: number; // month_end_stock
  safetyStock: number; // safety_stock
  noteValue?: number; // Note_value
  location?: string; // Location
  monthEndInventory?: number; // month_end_inventory
  inventoryDiff?: number; // inventory_diff
  remark?: string; // Remark
  time?: string; // Time
  status: "Normal" | "Low" | "Out";
};

const INITIAL_DATA: InventoryItem[] = [];

const TEXT = {
  title: { zh: "库存管理系统", en: "Inventory Management System" },
  listTitle: { zh: "库存清单", en: "Inventory List" },
  uploadBtn: { zh: "上传库存数据 (支持XLS/CSV)", en: "Upload Data (XLS/CSV)" },
  importBtn: { zh: "导入文件", en: "Import File" },
  parseBtn: { zh: "解析文件", en: "Parse File" },
  parsingBtn: { zh: "解析中...", en: "Parsing..." },
  newItemBtn: { zh: "新增物品", en: "New Item" },
  saveBtn: { zh: "保存到数据库", en: "Save to Database" },
  chooseFileFirst: { zh: "⚠️ 请先选择文件。", en: "⚠️ Please choose a file first." },
  uploadSuccess: { zh: "✅ 导入成功！格式已自动转换。", en: "✅ Imported! Format auto-converted." },
  saveError: { zh: "⚠️ 没有数据可保存。", en: "⚠️ No data to save." },
  uploadError: { zh: "⚠️ 解析失败，请确认文件包含'型号'列。", en: "⚠️ Failed. Missing 'Model' column." },
};

export default function InventoryPage() {
  const { lang } = useLanguage();
  const router = useRouter();
  const [inventoryData, setInventoryData] = useState<InventoryItem[]>(INITIAL_DATA);
  const [notification, setNotification] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const inventoryFileInputRef = useRef<HTMLInputElement>(null);

  const parseInventoryFile = (file: File): Promise<InventoryItem[]> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsArrayBuffer(file);

      reader.onerror = () => reject(new Error(TEXT.uploadError[lang]));
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);

          // 1. 使用 XLSX 读取数据，并且只处理第一张表
          const workbook = XLSX.read(data, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];

          // 2. 转换为二维数组
          type RawCell = string | number | boolean | null | undefined;
          type RawRow = RawCell[];
          const rawData = XLSX.utils.sheet_to_json<RawRow>(worksheet, { header: 1 });

          if (!rawData || rawData.length === 0) {
            reject(new Error(TEXT.uploadError[lang]));
            return;
          }

          const normalizeCell = (value: unknown) =>
            String(value ?? "")
              .trim()
              .replace(/\s+/g, "")
              .toLowerCase();

          const normalizeMonth = (value: unknown): string | null => {
            if (value == null) return null;
            const text = String(value).trim();
            if (!text) return null;
            const normalized = text
              .replace(/[年月]/g, "-")
              .replace(/日/g, "")
              .replace(/[./]/g, "-");
            const match = normalized.match(/(\d{4})-(\d{1,2})/);
            if (!match) return null;
            return `${match[1]}-${match[2].padStart(2, "0")}`;
          };

          const extractMonthFromFileName = (name: string): string | null => {
            const normalizedName = String(name ?? "").trim();
            if (!normalizedName) return null;
            const match = normalizedName.match(/(\d{4})\D{0,6}(\d{1,2})/);
            if (!match) return null;
            return `${match[1]}-${match[2].padStart(2, "0")}`;
          };

          const fileMonth = extractMonthFromFileName(file.name);

          const rowHasAny = (row: RawRow, tokens: string[]) => {
            const rowText = row.map((cell) => normalizeCell(cell)).join("|");
            return tokens.some((token) => rowText.includes(normalizeCell(token)));
          };

          // 3. 寻找表头
          let headerRowIndex = -1;
          let headers: string[] = [];
          let dataStartRow = -1;
          const modelTokens = ["型号", "型", "model", "sku"];
          const contextTokens = ["批号", "batch", "本月入库", "入库", "time", "时间", "月份", "month", "结存"];

          for (let i = 0; i < Math.min(rawData.length, 30); i++) {
            if (rowHasAny(rawData[i], modelTokens) && rowHasAny(rawData[i], contextTokens)) {
              headerRowIndex = i;
              headers = rawData[i].map((v) => String(v ?? "").trim());
              dataStartRow = i + 1;
              break;
            }
          }

          if (headerRowIndex === -1) {
            headerRowIndex = rawData.findIndex((row) => rowHasAny(row, modelTokens));
            if (headerRowIndex !== -1) {
              headers = rawData[headerRowIndex].map((v) => String(v ?? "").trim());
              dataStartRow = headerRowIndex + 1;
            }
          }

          if (headerRowIndex === -1) {
            reject(new Error(TEXT.uploadError[lang]));
            return;
          }

          const resolveIndex = (headerValues: string[], keywords: string[]) =>
            headerValues.findIndex((h) =>
              keywords.some((k) => normalizeCell(h).includes(normalizeCell(k)))
            );

          // 4. 同时评估单行/双行表头，选择匹配列更多的方案
          const firstHeader = headers;
          const secondHeader = rawData[headerRowIndex + 1] ?? [];
          const combinedHeaders = firstHeader.map(
            (h, idx) => `${h}${String(secondHeader[idx] ?? "")}`.trim()
          );
          const scoreHeaders = (headerValues: string[]) => {
            let score = 0;
            if (resolveIndex(headerValues, ["型号", "型", "Model", "SKU", "sku"]) !== -1) score++;
            if (resolveIndex(headerValues, ["批号", "Batch", "batch"]) !== -1) score++;
            if (resolveIndex(headerValues, ["上月结存", "Last Balance", "Last_Month_Stock"]) !== -1) score++;
            if (resolveIndex(headerValues, ["本月入库", "Inbound", "month_in"]) !== -1) score++;
            if (resolveIndex(headerValues, ["本月领用", "Outbound", "month_out"]) !== -1) score++;
            if (resolveIndex(headerValues, ["本月销售", "Sales", "month_sales"]) !== -1) score++;
            if (resolveIndex(headerValues, ["本月结存", "Current Balance", "month_end_stock"]) !== -1) score++;
            return score;
          };

          const singleScore = scoreHeaders(firstHeader);
          const combinedScore = scoreHeaders(combinedHeaders);
          if (combinedScore > singleScore) {
            headers = combinedHeaders;
            dataStartRow = headerRowIndex + 2;
          } else {
            headers = firstHeader;
            dataStartRow = headerRowIndex + 1;
          }

          // 5. 索引映射
          const getIndex = (keywords: string[]) => resolveIndex(headers, keywords);

          const idxModel = getIndex(["型号", "型", "Model", "SKU", "sku"]);
          const idxBatch = getIndex(["批号", "Batch", "batch"]);
          const idxCategory = getIndex(["类别", "Category"]);
          const idxLast = getIndex(["上月结存", "Last Balance", "Last_Month_Stock"]);
          const idxIn = getIndex(["本月入库", "Inbound", "month_in"]);
          const idxOut = getIndex(["本月领用", "Outbound", "month_out"]);
          const idxSales = getIndex(["本月销售", "Sales", "month_sales"]);
          const idxCurr = getIndex(["本月结存", "Current Balance", "month_end_stock"]);
          const idxSafety = getIndex(["安全库存", "Safety Stock", "safety_stock"]);
          const idxNoteValue = getIndex(["Note_value", "Note Value", "备注值"]);
          const idxLocation = getIndex(["Location", "location", "位置", "仓位"]);
          const idxMonthEndInv = getIndex(["month_end_inventory", "Month End Inventory", "月末库存"]);
          const idxInvDiff = getIndex(["inventory_diff", "Inventory Diff", "库存差异"]);
          const idxRemark = getIndex(["Remark", "remark", "备注", "说明"]);
          const idxTime = getIndex(["Time", "time", "时间", "月份", "Month"]);

          if (idxModel === -1) {
            reject(new Error(TEXT.uploadError[lang]));
            return;
          }

          const requiredColumnIndexes = [idxBatch, idxLast, idxIn, idxOut, idxSales, idxCurr];
          const missingRequiredColumns = requiredColumnIndexes.filter((idx) => idx === -1).length;
          if (missingRequiredColumns >= 3) {
            reject(new Error("关键数值列识别失败，请确认第一张表为成品库存表。"));
            return;
          }

          const newItems: InventoryItem[] = [];
          let lastModel = "";
          let lastCategory = "Uncategorized";

          for (let i = dataStartRow; i < rawData.length; i++) {
            const row = rawData[i];
            if (!row || row.length === 0) continue;

            const getCell = (idx: number) =>
              idx !== -1 && row[idx] !== undefined ? String(row[idx]).trim() : "";

            let model = getCell(idxModel);
            let category = getCell(idxCategory);

            const batchVal = getCell(idxBatch);
            const currVal = getCell(idxCurr);
            const hasData = batchVal || currVal;

            if (!model && hasData && lastModel) {
              model = lastModel;
            } else if (model) {
              lastModel = model;
            }

            if (!category && hasData && lastCategory !== "Uncategorized") {
              category = lastCategory;
            } else if (category) {
              lastCategory = category;
            }

            const normalizedModel = model.replace(/\s+/g, "");
            const hasAlnum = /[A-Za-z0-9]/.test(normalizedModel);
            const hasChinese = /[\u4e00-\u9fff]/.test(normalizedModel);
            if (
              !normalizedModel ||
              normalizedModel === "型号" ||
              normalizedModel.toLowerCase() === "model" ||
              normalizedModel.toLowerCase() === "sku" ||
              normalizedModel.includes("合计") ||
              normalizedModel.toLowerCase().includes("total") ||
              (hasChinese && !hasAlnum)
            ) {
              continue;
            }

            const parseNum = (val: string) => {
              if (!val) return 0;
              return parseFloat(val.replace(/,/g, "")) || 0;
            };

            const currentBalance = parseNum(getCell(idxCurr));
            const safetyStock = parseNum(getCell(idxSafety));
            let status: "Normal" | "Low" | "Out" = "Normal";
            if (currentBalance <= 0) status = "Out";
            else if (currentBalance < safetyStock) status = "Low";

            const timeValue =
              fileMonth ||
              normalizeMonth(getCell(idxTime)) ||
              new Date().toISOString().slice(0, 7);

            newItems.push({
              id: `row-${i}`,
              model: normalizedModel,
              batch: batchVal || "-",
              category: category || "Uncategorized",
              lastBalance: parseNum(getCell(idxLast)),
              inbound: parseNum(getCell(idxIn)),
              outbound: parseNum(getCell(idxOut)),
              sales: parseNum(getCell(idxSales)),
              currentBalance,
              safetyStock,
              noteValue: idxNoteValue !== -1 ? parseNum(getCell(idxNoteValue)) : undefined,
              location: getCell(idxLocation) || undefined,
              monthEndInventory: idxMonthEndInv !== -1 ? parseNum(getCell(idxMonthEndInv)) : undefined,
              inventoryDiff: idxInvDiff !== -1 ? parseNum(getCell(idxInvDiff)) : undefined,
              remark: getCell(idxRemark) || undefined,
              time: timeValue,
              status,
            });
          }

          resolve(newItems);
        } catch {
          reject(new Error(TEXT.uploadError[lang]));
        }
      };
    });

  const handleInventoryUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setCurrentFileName(file.name);
    setNotification(
      lang === "zh"
        ? `已选择文件：${file.name}，请点击“${TEXT.parseBtn.zh}”。`
        : `Selected file: ${file.name}. Click "${TEXT.parseBtn.en}".`
    );
    setTimeout(() => setNotification(null), 3000);
    event.target.value = "";
  };

  const handleParseSelectedFile = async () => {
    if (!selectedFile) {
      setNotification(TEXT.chooseFileFirst[lang]);
      setTimeout(() => setNotification(null), 2500);
      return;
    }
    setParsing(true);
    try {
      const newItems = await parseInventoryFile(selectedFile);
      if (newItems.length > 0) {
        setInventoryData(newItems);
        setNotification(TEXT.uploadSuccess[lang]);
      } else {
        setNotification("⚠️ 未解析到有效数据，请检查第一张表格式。");
      }
    } catch (error) {
      setNotification(
        error instanceof Error ? `⚠️ ${error.message}` : TEXT.uploadError[lang]
      );
    } finally {
      setTimeout(() => setNotification(null), 3000);
      setParsing(false);
    }
  };

  const [saving, setSaving] = useState(false);

  const handleSaveToDataset = async () => {
    if (!inventoryData || inventoryData.length === 0) {
      setNotification(TEXT.saveError[lang]);
      setTimeout(() => setNotification(null), 2000);
      return;
    }

    setSaving(true);
    try {
      const fileName = currentFileName || `Manual_Save_${new Date().toISOString().slice(0,10)}.xlsx`;
      
      const response = await fetch("/api/inventory/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rows: inventoryData,
          fileName: fileName,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to save to database");
      }

      setNotification(
        lang === "zh"
          ? `✅ 成功保存 ${result.inserted || result.total || inventoryData.length} 条数据到数据库！`
          : `✅ Successfully saved ${result.inserted || result.total || inventoryData.length} rows to database!`
      );
      router.refresh();
      setTimeout(() => setNotification(null), 3000);
    } catch (error) {
      console.error("Save error:", error);
      setNotification(
        lang === "zh"
          ? `⚠️ 保存失败：${error instanceof Error ? error.message : "Unknown error"}`
          : `⚠️ Save failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      setTimeout(() => setNotification(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto py-6 px-4 space-y-6 relative">
      {notification && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-lg shadow-lg font-bold text-sm animate-in fade-in slide-in-from-top-4 duration-300
          ${notification.includes('⚠️') ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}
        `}>
          {notification}
        </div>
      )}

      <h1 className="text-3xl font-extrabold text-blue-700 dark:text-blue-400">{TEXT.title[lang]}</h1>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-300 dark:border-slate-700 p-6 shadow-sm space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            {TEXT.listTitle[lang]}
          </h2>
          <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm">+ {TEXT.newItemBtn[lang]}</button>
        </div>
        <div className="space-y-4">
          {/* Upload Inventory Data */}
          <div onClick={() => inventoryFileInputRef.current?.click()} className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors cursor-pointer group">
            <input type="file" ref={inventoryFileInputRef} onChange={handleInventoryUpload} accept=".csv,.xlsx,.xls" className="hidden" />
            <span className="text-sm font-bold text-slate-700 dark:text-slate-300 group-hover:text-blue-700 dark:group-hover:text-blue-400">{TEXT.uploadBtn[lang]}</span>
            <span className="text-blue-600 dark:text-blue-400 text-sm font-bold group-hover:underline">{TEXT.importBtn[lang]}</span>
          </div>
          {selectedFile && (
            <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {lang === "zh" ? "当前文件：" : "Selected file: "} {selectedFile.name}
            </div>
          )}
          
          <div className="flex justify-end gap-3">
            <button
              onClick={handleParseSelectedFile}
              disabled={!selectedFile || parsing}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed text-white px-8 py-3 rounded-lg text-sm font-bold shadow-sm active:scale-95 transition-transform"
            >
              {parsing ? TEXT.parsingBtn[lang] : TEXT.parseBtn[lang]}
            </button>
            <button 
              onClick={handleSaveToDataset} 
              disabled={saving}
              className="bg-green-600 hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed text-white px-8 py-3 rounded-lg text-sm font-bold shadow-sm active:scale-95 transition-transform"
            >
              {saving ? (lang === "zh" ? "保存中..." : "Saving...") : TEXT.saveBtn[lang]}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-300 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-b border-slate-300 dark:border-slate-700">
              <tr>
                <th className="px-6 py-4 font-bold whitespace-nowrap">SKU</th>
                <th className="px-6 py-4 font-bold whitespace-nowrap">batch</th>
                <th className="px-6 py-4 font-bold text-right whitespace-nowrap">Last_Month_Stock</th>
                <th className="px-6 py-4 font-bold text-right text-green-700 dark:text-green-400 whitespace-nowrap">month_in</th>
                <th className="px-6 py-4 font-bold text-right text-orange-700 dark:text-orange-400 whitespace-nowrap">month_out</th>
                <th className="px-6 py-4 font-bold text-right text-blue-700 dark:text-blue-400 whitespace-nowrap">month_sales</th>
                <th className="px-6 py-4 font-bold text-right whitespace-nowrap">month_end_stock</th>
                <th className="px-6 py-4 font-bold text-right whitespace-nowrap">Note_value</th>
                <th className="px-6 py-4 font-bold text-right whitespace-nowrap">safety_stock</th>
                <th className="px-6 py-4 font-bold whitespace-nowrap">Location</th>
                <th className="px-6 py-4 font-bold text-right whitespace-nowrap">month_end_inventory</th>
                <th className="px-6 py-4 font-bold text-right whitespace-nowrap">inventory_diff</th>
                <th className="px-6 py-4 font-bold whitespace-nowrap">Remark</th>
                <th className="px-6 py-4 font-bold whitespace-nowrap">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {inventoryData.map((item) => (
                <tr key={item.id} className="hover:bg-blue-50/50 dark:hover:bg-slate-700/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-slate-900 dark:text-white whitespace-nowrap">{item.model}</td>
                  <td className="px-6 py-4 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">{item.batch}</td>
                  <td className="px-6 py-4 text-right font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">{item.lastBalance || 0}</td>
                  <td className="px-6 py-4 text-right font-bold text-green-700 dark:text-green-400 whitespace-nowrap">{item.inbound || 0}</td>
                  <td className="px-6 py-4 text-right font-bold text-orange-700 dark:text-orange-400 whitespace-nowrap">{item.outbound || 0}</td>
                  <td className="px-6 py-4 text-right font-bold text-blue-700 dark:text-blue-400 whitespace-nowrap">{item.sales || 0}</td>
                  <td className="px-6 py-4 text-right font-extrabold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-900/30 whitespace-nowrap">{item.currentBalance || 0}</td>
                  <td className="px-6 py-4 text-right font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">{item.noteValue !== undefined ? item.noteValue : (item.currentBalance || 0)}</td>
                  <td className="px-6 py-4 text-right font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">{item.safetyStock || 0}</td>
                  <td className="px-6 py-4 font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">{item.location || ""}</td>
                  <td className="px-6 py-4 text-right font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">{item.monthEndInventory !== undefined ? item.monthEndInventory : (item.currentBalance || 0)}</td>
                  <td className="px-6 py-4 text-right font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">{item.inventoryDiff || 0}</td>
                  <td className="px-6 py-4 font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">{item.remark || ""}</td>
                  <td className="px-6 py-4 font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">{item.time || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
