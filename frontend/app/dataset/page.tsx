"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/components/LanguageProvider";

// 对应 Inventory 页面的数据结构
type InventoryItem = {
  id: string;
  model: string;
  batch: string;
  category: string;
  currentBalance: number;
  status: string;
  [key: string]: string | number | null | undefined; // 允许其他字段
};

// 数据集文件结构
type DatasetFile = {
  fileName: string;
  uploadDate: string;
  rowCount: number;
  size: string; // 模拟大小 "12KB"
  data: InventoryItem[];
};

// 模拟的初始数据 (防止页面一开始是空的)
const MOCK_DATASETS: DatasetFile[] = [
  {
    fileName: "2024_Q4_Inventory_Backup.csv",
    uploadDate: "2024-12-01 14:30",
    rowCount: 156,
    size: "24 KB",
    data: Array(10).fill(null).map((_, i) => ({ id: `old-${i}`, model: `OLD-ITEM-${i}`, batch: "BATCH-old", category: "Legacy", currentBalance: 10, status: "Normal" }))
  }
];

const TEXT = {
  title: { zh: "库存数据库", en: "Inventory Database" },
  subtitle: { zh: "管理所有已保存的库存快照与历史文件。", en: "Manage all saved inventory snapshots and history." },
  searchPlaceholder: { zh: "搜索文件名...", en: "Search filenames..." },
  emptyState: { zh: "暂无保存的数据集", en: "No datasets saved yet" },
  
  // 卡片字段
  rows: { zh: "行数据", en: "rows" },
  date: { zh: "上传时间", en: "Uploaded" },
  viewBtn: { zh: "查看详情", en: "View Data" },
  deleteBtn: { zh: "删除", en: "Delete" },
  
  // 预览弹窗
  previewTitle: { zh: "文件预览", en: "File Preview" },
  closeBtn: { zh: "关闭", en: "Close" },
  
  headers: {
    model: { zh: "型号", en: "Model" },
    batch: { zh: "批号", en: "Batch" },
    category: { zh: "类别", en: "Category" },
    curr: { zh: "库存", en: "Stock" },
    status: { zh: "状态", en: "Status" },
  }
};

export default function DatasetPage() {
  const { lang } = useLanguage(); // 获取当前语言
  const [datasets, setDatasets] = useState<DatasetFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFile, setSelectedFile] = useState<DatasetFile | null>(null); // 当前预览的文件

  // 从 Supabase 加载数据集
  useEffect(() => {
    const loadDatasets = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/inventory/datasets", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          // 转换数据库格式到前端格式
          const convertedDatasets = (data.datasets || []).map((ds: any) => ({
            fileName: ds.fileName,
            uploadDate: ds.uploadDate,
            rowCount: ds.rowCount,
            size: ds.size,
            data: [], // 数据在查看详情时加载
            month: ds.month,
          }));
          setDatasets(convertedDatasets);
        } else {
          // 如果 API 失败，尝试从 localStorage 加载
          const saved = localStorage.getItem("inventory_datasets");
          if (saved) {
            try {
              setDatasets(JSON.parse(saved) as DatasetFile[]);
            } catch (e) {
              console.error("Failed to load datasets", e);
              setDatasets([]);
            }
          } else {
            setDatasets([]);
          }
        }
      } catch (error) {
        console.error("Failed to load datasets from database:", error);
        // Fallback to localStorage
        const saved = localStorage.getItem("inventory_datasets");
        if (saved) {
          try {
            setDatasets(JSON.parse(saved) as DatasetFile[]);
          } catch (e) {
            setDatasets([]);
          }
        } else {
          setDatasets([]);
        }
      } finally {
        setLoading(false);
      }
    };
    loadDatasets();
  }, []);

  // 加载文件详情
  const loadFileDetail = async (file: DatasetFile) => {
    // 如果是数据库数据集（有 month 字段），从 API 加载
    if ((file as any).month) {
      try {
        const res = await fetch(`/api/inventory/dataset-detail?month=${(file as any).month}`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setSelectedFile({
            ...file,
            data: data.items || [],
          });
          return;
        }
      } catch (error) {
        console.error("Failed to load file detail:", error);
      }
    }
    // 使用现有数据（localStorage）
    setSelectedFile(file);
  };

  // 过滤搜索
  const filteredDatasets = datasets.filter(d => 
    d.fileName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto py-6 px-4 space-y-6">
      
      {/* 头部 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-blue-700 dark:text-blue-400">{TEXT.title[lang]}</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">{TEXT.subtitle[lang]}</p>
        </div>
        <div className="relative w-full md:w-64">
          <input 
            type="text" 
            placeholder={TEXT.searchPlaceholder[lang]}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <svg className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        </div>
      </div>

      {/* --- 文件卡片网格 --- --- */}
      {loading ? (
        <div className="text-center py-20 bg-slate-50 dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
          <p className="text-slate-500 dark:text-slate-400">{lang === "zh" ? "加载中..." : "Loading..."}</p>
        </div>
      ) : filteredDatasets.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredDatasets.map((file) => (
            <div key={file.fileName} className="group bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all cursor-pointer"
                 onClick={() => loadFileDetail(file)} // 点击卡片打开预览
            >
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                  {/* CSV 图标 */}
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                </div>
                {(file as any).month ? (
                  <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded">
                    {lang === "zh" ? "数据库" : "Database"}
                  </span>
                ) : (
                  <button 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      if (confirm(lang === 'zh' ? "确定要删除这个文件吗？" : "Delete this file?")) {
                        const newDatasets = datasets.filter(d => d.fileName !== file.fileName);
                        setDatasets(newDatasets);
                        localStorage.setItem("inventory_datasets", JSON.stringify(newDatasets));
                      }
                    }}
                    className="text-slate-400 hover:text-red-500 transition-colors p-1"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                )}
              </div>
              
              <h3 className="font-bold text-lg text-slate-900 dark:text-white truncate mb-1" title={file.fileName}>
                {file.fileName}
              </h3>
              
              <div className="space-y-1 text-sm text-slate-500 dark:text-slate-400">
                <div className="flex justify-between">
                  <span>{TEXT.date[lang]}:</span>
                  <span>{file.uploadDate.split(' ')[0]}</span>
                </div>
                <div className="flex justify-between">
                  <span>Size:</span>
                  <span>{file.size}</span>
                </div>
                <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                  <span className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded text-xs font-bold">
                    {file.rowCount} {TEXT.rows[lang]}
                  </span>
                  <span className="text-blue-600 dark:text-blue-400 text-xs font-bold flex items-center gap-1 group-hover:underline">
                    {TEXT.viewBtn[lang]} &rarr;
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 bg-slate-50 dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
          <p className="text-slate-500 dark:text-slate-400">{TEXT.emptyState[lang]}</p>
        </div>
      )}

      {/* --- 预览弹窗 (Preview Modal) --- */}
      {selectedFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 w-full max-w-5xl h-[80vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700 animate-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  {selectedFile.fileName}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {selectedFile.uploadDate} • {selectedFile.rowCount} rows
                </p>
              </div>
              <button 
                onClick={() => setSelectedFile(null)}
                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-500 dark:text-slate-400"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Modal Body (Table) */}
            <div className="flex-1 overflow-auto p-0">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-6 py-3 font-bold border-b border-slate-200 dark:border-slate-700">{TEXT.headers.model[lang]}</th>
                    <th className="px-6 py-3 font-bold border-b border-slate-200 dark:border-slate-700">{TEXT.headers.batch[lang]}</th>
                    <th className="px-6 py-3 font-bold border-b border-slate-200 dark:border-slate-700">{TEXT.headers.category[lang]}</th>
                    <th className="px-6 py-3 font-bold border-b border-slate-200 dark:border-slate-700 text-right">{TEXT.headers.curr[lang]}</th>
                    <th className="px-6 py-3 font-bold border-b border-slate-200 dark:border-slate-700 text-center">{TEXT.headers.status[lang]}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {selectedFile.data.map((item, idx) => (
                    <tr key={idx} className="hover:bg-blue-50/50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-6 py-3 text-slate-900 dark:text-slate-100 font-medium">{item.model}</td>
                      <td className="px-6 py-3 text-slate-500 dark:text-slate-400">{item.batch}</td>
                      <td className="px-6 py-3 text-slate-500 dark:text-slate-400">{item.category}</td>
                      <td className="px-6 py-3 text-slate-900 dark:text-white font-bold text-right">{item.currentBalance}</td>
                      <td className="px-6 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium 
                          ${item.status === 'Low' ? 'bg-yellow-100 text-yellow-800' : 
                            item.status === 'Out' ? 'bg-red-100 text-red-800' : 
                            'bg-green-100 text-green-800'}`}>
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-end">
              <button 
                onClick={() => setSelectedFile(null)}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-sm transition-colors"
              >
                {TEXT.closeBtn[lang]}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
