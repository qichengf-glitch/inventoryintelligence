"use client";

import { useState, useRef, useEffect } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import * as XLSX from "xlsx"; // 引入强大的解析库
import SafetyStockUploader from "@/components/SafetyStockUploader";
import { loadSafetyStockMap, type SafetyStockRow } from "@/lib/SafetyStockStore";

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

// --- 初始模拟数据 ---
const INITIAL_DATA: InventoryItem[] = [
  { id: "1", model: "IPHONE-15-PRO", batch: "BATCH-202401", category: "Electronics", lastBalance: 120, inbound: 50, outbound: 10, sales: 30, currentBalance: 130, safetyStock: 20, status: "Normal" },
  { id: "2", model: "MACBOOK-AIR-M2", batch: "BATCH-202312", category: "Laptop", lastBalance: 45, inbound: 10, outbound: 5, sales: 15, currentBalance: 35, safetyStock: 10, status: "Normal" },
];

const TEXT = {
  title: { zh: "库存管理系统", en: "Inventory Management System" },
  filterTitle: { zh: "筛选条件", en: "Filters" },
  searchPlaceholder: { zh: "按名称或编号搜索...", en: "Search by name or ID..." },
  categoryLabel: { zh: "类别", en: "Category" },
  statusLabel: { zh: "库存状态", en: "Status" },
  searchBtn: { zh: "搜索", en: "Search" },
  resetBtn: { zh: "重置", en: "Reset" },
  listTitle: { zh: "库存清单", en: "Inventory List" },
  uploadBtn: { zh: "上传库存数据 (支持XLS/CSV)", en: "Upload Data (XLS/CSV)" },
  importBtn: { zh: "导入文件", en: "Import File" },
  newItemBtn: { zh: "新增物品", en: "New Item" },
  saveBtn: { zh: "保存到数据库", en: "Save to Database" },
  manageTitle: { zh: "类别管理", en: "Manage Categories" },
  manageDesc: { zh: "上传 Appendix 文件以自动识别并永久保存类别。", en: "Upload Appendix to auto-detect and save categories." },
  uploadAppendixBtn: { zh: "上传 Appendix (更新类别)", en: "Upload Appendix (Update Categories)" },
  clearCategoriesBtn: { zh: "清空所有类别", en: "Clear All Categories" },
  currentCategories: { zh: "当前已保存类别：", en: "Saved Categories:" },
  tableHeaders: {
    model: { zh: "型号 / 品名", en: "Model / Name" },
    batch: { zh: "批号", en: "Batch" },
    category: { zh: "类别", en: "Category" },
    last: { zh: "上月结存", en: "Last Bal." },
    in: { zh: "本月入库", en: "Inbound" },
    out: { zh: "本月领用", en: "Outbound" },
    sales: { zh: "本月销售", en: "Sales" },
    curr: { zh: "本月结存", en: "Current" },
    safety: { zh: "安全库存", en: "Safety Stock" },
    status: { zh: "状态", en: "Status" },
  },
  statusMap: {
    Normal: { zh: "正常", en: "Normal" },
    Low: { zh: "缺货预警", en: "Low Stock" },
    Out: { zh: "已售罄", en: "Out of Stock" },
  },
  uploadSuccess: { zh: "✅ 导入成功！格式已自动转换。", en: "✅ Imported! Format auto-converted." },
  saveSuccess: { zh: "✅ 已保存到数据库！", en: "✅ Saved to Database!" },
  saveError: { zh: "⚠️ 没有数据可保存。", en: "⚠️ No data to save." },
  uploadError: { zh: "⚠️ 解析失败，请确认文件包含'型号'列。", en: "⚠️ Failed. Missing 'Model' column." },
  categoryUpdateSuccess: { zh: "✅ 类别更新成功！", en: "✅ Categories updated!" },
  safetyStockTitle: { zh: "上传安全库存", en: "Upload Safety Stock" },
  safetyStockHint: { zh: "建议格式（长表）：型号 / 客户类型(普通/大客户) / 安全库存", en: "Recommended (long format): SKU / CustomerType(普通/大客户) / SafetyStock" },
  safetyStockRefresh: { zh: "刷新安全库存配置", en: "Reload Safety Stock Config" },
  safetyStockLoaded: { zh: "当前已加载配置条目：", en: "Loaded config entries: " },
};

export default function InventoryPage() {
  const { lang } = useLanguage();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedStatus, setSelectedStatus] = useState<"All" | "Normal" | "Low" | "Out">("All");
  const DEFAULT_CATEGORIES = ["All", "Electronics", "Laptop", "Accessories"];
  const [categories, setCategories] = useState<string[]>(() => {
    if (typeof window === "undefined") return DEFAULT_CATEGORIES;
    const savedCats = localStorage.getItem("inventory_categories");
    if (savedCats) {
      try {
        const parsed = JSON.parse(savedCats);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {
        console.error(e);
      }
    }
    return DEFAULT_CATEGORIES;
  });
  const [inventoryData, setInventoryData] = useState<InventoryItem[]>(INITIAL_DATA);
  const [notification, setNotification] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string>(""); 

  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const inventoryFileInputRef = useRef<HTMLInputElement>(null);
  const appendixFileInputRef = useRef<HTMLInputElement>(null);
  
  const companyKey = "customer";
  const [ssMap, setSsMap] = useState<Record<string, SafetyStockRow>>({});
  useEffect(() => {
    setSsMap(loadSafetyStockMap(companyKey));
  }, [companyKey]);

  const saveCategoriesToStorage = (newCats: string[]) => {
    setCategories(newCats);
    localStorage.setItem("inventory_categories", JSON.stringify(newCats));
  };

  // --- 🔥 核心修复：使用 XLSX 库解析所有格式 ---
  const handleInventoryUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCurrentFileName(file.name);

    const reader = new FileReader();
    reader.readAsArrayBuffer(file); // 读取为二进制流

    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      
      // 1. 使用 XLSX 读取数据 (这就解决了 HTML/XML 伪装成 CSV 的问题)
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      // 2. 转换为 JSON 数组 (二维数组)
      type RawCell = string | number | boolean | null | undefined;
      type RawRow = RawCell[];
      // header: 1 表示生成二维数组，不自动推断表头，方便我们自己找表头行
      const rawData = XLSX.utils.sheet_to_json<RawRow>(worksheet, { header: 1 });

      if (!rawData || rawData.length === 0) {
        setNotification(TEXT.uploadError[lang]);
        return;
      }

      // 3. 智能寻找表头行
      let headerRowIndex = -1;
      let headers: string[] = [];

      // 扫描前 20 行寻找包含关键列的行
      for (let i = 0; i < Math.min(rawData.length, 20); i++) {
        const rowStr = rawData[i].join(" ").toLowerCase();
        if ((rowStr.includes("型号") || rowStr.includes("model") || rowStr.includes("sku")) && 
            (rowStr.includes("批号") || rowStr.includes("batch") || rowStr.includes("入库") || rowStr.includes("time"))) {
          headerRowIndex = i;
          headers = rawData[i].map(String); // 转为字符串数组
          break;
        }
      }

      if (headerRowIndex === -1) {
        // 保底尝试：查找包含型号/SKU/Model的行
        headerRowIndex = rawData.findIndex(row => {
          const rowStr = row.join(" ").toLowerCase();
          return rowStr.includes("型号") || rowStr.includes("model") || rowStr.includes("sku");
        });
        if (headerRowIndex !== -1) headers = rawData[headerRowIndex].map(String);
      }

      if (headerRowIndex === -1) {
        setNotification(TEXT.uploadError[lang]);
        return;
      }

      // 4. 建立索引映射
      const getIndex = (keywords: string[]) => headers.findIndex(h => keywords.some(k => h && h.toLowerCase().includes(k.toLowerCase())));
      
      const idxModel = getIndex(['型号', 'Model', 'SKU', 'sku']);
      const idxBatch = getIndex(['批号', 'Batch', 'batch']);
      const idxCategory = getIndex(['类别', 'Category']);
      const idxLast = getIndex(['上月结存', 'Last Balance', 'Last_Month_Stock']);
      const idxIn = getIndex(['本月入库', 'Inbound', 'month_in']);
      const idxOut = getIndex(['本月领用', 'Outbound', 'month_out']);
      const idxSales = getIndex(['本月销售', 'Sales', 'month_sales']);
      const idxCurr = getIndex(['本月结存', 'Current Balance', '结存', 'month_end_stock']);
      const idxSafety = getIndex(['安全库存', 'Safety Stock', 'safety_stock']);
      const idxNoteValue = getIndex(['Note_value', 'Note Value', '备注值']);
      const idxLocation = getIndex(['Location', 'location', '位置', '仓位']);
      const idxMonthEndInv = getIndex(['month_end_inventory', 'Month End Inventory', '月末库存']);
      const idxInvDiff = getIndex(['inventory_diff', 'Inventory Diff', '库存差异']);
      const idxRemark = getIndex(['Remark', 'remark', '备注', '说明']);
      const idxTime = getIndex(['Time', 'time', '时间', '月份', 'Month']);

      const newItems: InventoryItem[] = [];
      let lastModel = "";
      let lastCategory = "Uncategorized";

      // 5. 遍历数据行
      for (let i = headerRowIndex + 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length === 0) continue;

        // 安全获取单元格数据
        const getCell = (idx: number) => (idx !== -1 && row[idx] !== undefined) ? String(row[idx]).trim() : "";
        
        let model = getCell(idxModel);
        let category = getCell(idxCategory);
        
        // 判断行是否有效 (有批号或库存数据)
        const batchVal = getCell(idxBatch);
        const currVal = getCell(idxCurr);
        const hasData = batchVal || currVal;

        // --- 自动填充 (Forward Fill) ---
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

        // 跳过无效行
        if (!model || model === "型号" || model.toLowerCase() === "model" || model.toLowerCase() === "sku" || model.includes("Total") || model.includes("合计")) continue;

        // 数值解析
        const parseNum = (val: string) => {
          if (!val) return 0;
          return parseFloat(val.replace(/,/g, '')) || 0;
        };

        const currentBalance = parseNum(getCell(idxCurr));
        const safetyStock = parseNum(getCell(idxSafety));
        
        let status: "Normal" | "Low" | "Out" = "Normal";
        if (currentBalance <= 0) status = "Out";
        else if (currentBalance < safetyStock) status = "Low";

        // 从文件名提取月份作为默认 Time
        const extractMonthFromFileName = (name: string): string | null => {
          const match = name.match(/(\d{4})[_-]?(\d{1,2})/);
          if (match) {
            const year = match[1];
            const month = match[2].padStart(2, "0");
            return `${year}-${month}`;
          }
          return null;
        };

        const timeValue = getCell(idxTime) || extractMonthFromFileName(file.name) || new Date().toISOString().slice(0, 7);

        newItems.push({
          id: `row-${i}`,
          model: model,
          batch: batchVal || "-",
          category: category || "Uncategorized",
          lastBalance: parseNum(getCell(idxLast)),
          inbound: parseNum(getCell(idxIn)),
          outbound: parseNum(getCell(idxOut)),
          sales: parseNum(getCell(idxSales)),
          currentBalance: currentBalance,
          safetyStock: safetyStock,
          noteValue: idxNoteValue !== -1 ? parseNum(getCell(idxNoteValue)) : undefined,
          location: getCell(idxLocation) || undefined,
          monthEndInventory: idxMonthEndInv !== -1 ? parseNum(getCell(idxMonthEndInv)) : undefined,
          inventoryDiff: idxInvDiff !== -1 ? parseNum(getCell(idxInvDiff)) : undefined,
          remark: getCell(idxRemark) || undefined,
          time: timeValue,
          status: status
        });
      }

      if (newItems.length > 0) {
        setInventoryData(newItems);
        setNotification(TEXT.uploadSuccess[lang]);
        setTimeout(() => setNotification(null), 3000);
      } else {
        setNotification("⚠️ 未解析到有效数据，请检查文件格式。");
      }
    };
    event.target.value = '';
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

  const handleAppendixUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    // Appendix 也用 XLSX 解析，更稳
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      type RawCell = string | number | boolean | null | undefined;
      type RawRow = RawCell[];
      const json = XLSX.utils.sheet_to_json<RawRow>(sheet, { header: 1 }); // 二维数组

      let catIndex = -1;
      const newCats = new Set<string>();

      // 找表头
      for(let i=0; i<json.length; i++) {
        const row = json[i].map(String);
        catIndex = row.findIndex(c => c.includes("类别") || c.includes("Category"));
        if(catIndex !== -1) {
          // 从下一行开始取数据
          for(let j=i+1; j<json.length; j++) {
             const val = json[j][catIndex];
             if(val) newCats.add(String(val).trim());
          }
          break;
        }
      }

      if (newCats.size > 0) {
        saveCategoriesToStorage(["All", ...Array.from(newCats)]);
        setNotification(TEXT.categoryUpdateSuccess[lang]);
        setShowCategoryModal(false);
      } else {
        setNotification(TEXT.uploadError[lang]);
      }
    };
    event.target.value = '';
  };

  const filteredData = inventoryData.filter(item => {
    const matchesSearch = item.model.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.batch.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "All" || item.category === selectedCategory;
    const matchesStatus = selectedStatus === "All" || item.status === selectedStatus;
    return matchesSearch && matchesCategory && matchesStatus;
  });

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

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-300 dark:border-slate-700 p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
           <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
           {TEXT.filterTitle[lang]}
        </h2>
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label className="block text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">{TEXT.searchPlaceholder[lang]}</label>
            <input type="text" className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white outline-none" placeholder="IPHONE..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
          <div className="w-full md:w-56">
             <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-bold text-slate-800 dark:text-slate-200">{TEXT.categoryLabel[lang]}</label>
                <button onClick={() => setShowCategoryModal(true)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer">⚙️ Manage</button>
             </div>
            <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white outline-none cursor-pointer">
              {categories.map((cat, index) => <option key={index} value={cat}>{cat}</option>)}
            </select>
          </div>
          <div className="w-full md:w-48">
             <label className="block text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">{TEXT.statusLabel[lang]}</label>
             <select
               value={selectedStatus}
               onChange={(e) => setSelectedStatus(e.target.value as "All" | "Normal" | "Low" | "Out")}
               className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white outline-none cursor-pointer"
             >
              <option value="All">All</option>
              <option value="Normal">{TEXT.statusMap.Normal[lang]}</option>
              <option value="Low">{TEXT.statusMap.Low[lang]}</option>
              <option value="Out">{TEXT.statusMap.Out[lang]}</option>
            </select>
          </div>
          <button className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-sm">{TEXT.searchBtn[lang]}</button>
          <button onClick={() => { setSearchTerm(""); setSelectedCategory("All"); }} className="border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-bold">{TEXT.resetBtn[lang]}</button>
        </div>
      </div>

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
          
          {/* Save Button */}
          <div className="flex justify-end">
            <button 
              onClick={handleSaveToDataset} 
              disabled={saving}
              className="bg-green-600 hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed text-white px-8 py-3 rounded-lg text-sm font-bold shadow-sm active:scale-95 transition-transform"
            >
              {saving ? (lang === "zh" ? "保存中..." : "Saving...") : TEXT.saveBtn[lang]}
            </button>
          </div>
          
          {/* Safety Stock Upload Section - Same style as inventory upload */}
          <details className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900/50">
            <summary className="cursor-pointer p-6 flex items-center justify-between hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors group">
              <span className="text-sm font-bold text-slate-700 dark:text-slate-300 group-hover:text-blue-700 dark:group-hover:text-blue-400">{TEXT.safetyStockTitle[lang]}</span>
              <span className="text-blue-600 dark:text-blue-400 text-sm font-bold group-hover:underline">{TEXT.importBtn[lang]}</span>
            </summary>
            <div className="px-6 pb-6 pt-0 space-y-3">
              <div className="text-xs text-slate-600 dark:text-slate-300">{TEXT.safetyStockHint[lang]}</div>
              <SafetyStockUploader
                companyKey={companyKey}
                onUploaded={() => setSsMap(loadSafetyStockMap(companyKey))}
              />
              <button
                onClick={() => setSsMap(loadSafetyStockMap(companyKey))}
                className="w-full rounded-lg bg-blue-600 text-white text-xs font-bold py-2 hover:bg-blue-700"
              >
                {TEXT.safetyStockRefresh[lang]}
              </button>
              <div className="text-xs text-slate-600 dark:text-slate-300">
                {TEXT.safetyStockLoaded[lang]}
                <span className="font-semibold">{Object.keys(ssMap).length}</span>
              </div>
            </div>
          </details>
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
              {filteredData.map((item) => (
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

      {showCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg p-6 border border-slate-200 dark:border-slate-700 animate-in zoom-in-95">
            <div className="flex justify-between items-start mb-4">
              <div><h3 className="text-xl font-bold text-slate-900 dark:text-white">{TEXT.manageTitle[lang]}</h3><p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{TEXT.manageDesc[lang]}</p></div>
              <button onClick={() => setShowCategoryModal(false)} className="text-slate-400 hover:text-slate-600"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            <div className="space-y-4">
              <button onClick={() => appendixFileInputRef.current?.click()} className="w-full py-3 border-2 border-dashed border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-xl font-bold hover:bg-blue-100 transition-colors flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                {TEXT.uploadAppendixBtn[lang]}
              </button>
              <input type="file" ref={appendixFileInputRef} onChange={handleAppendixUpload} accept=".csv,.xlsx,.xls" className="hidden" />
              <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 max-h-40 overflow-y-auto">
                <div className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-2 uppercase">{TEXT.currentCategories[lang]}</div>
                <div className="flex flex-wrap gap-2">{categories.map((cat, i) => <span key={i} className="px-2 py-1 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded text-xs font-medium text-slate-700 dark:text-slate-200">{cat}</span>)}</div>
              </div>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-700 flex justify-end">
                <button onClick={() => { if(confirm("Clear all?")) saveCategoriesToStorage(DEFAULT_CATEGORIES); }} className="text-red-600 text-sm font-bold hover:underline">{TEXT.clearCategoriesBtn[lang]}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
