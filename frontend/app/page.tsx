"use client";

import Link from "next/link";
import { useState } from "react";
import { useLanguage, type Lang } from "@/components/LanguageProvider";

// --- 类型定义 ---
type LangString = { zh: string; en: string };

type QuickAction = {
  key: string;
  href: string;
  title: LangString;
  description: LangString;
  badge?: LangString;
};

type KPIData = {
  label: LangString;
  value: string;
  change: string;
  trend: "up" | "down" | "neutral";
  highlight?: boolean;
};

// --- 数据源配置 ---

// 1. 顶部 KPI 数据 (新增)
const kpiData: KPIData[] = [
  { label: { zh: "总库存 SKU", en: "Total SKUs" }, value: "1,248", change: "+12%", trend: "up" },
  { label: { zh: "缺货预警", en: "Low Stock Alert" }, value: "15", change: "+3", trend: "down", highlight: true },
  { label: { zh: "本月出库数", en: "Monthly Outbound" }, value: "8,920", change: "+5.4%", trend: "up" },
  { label: { zh: "平均周转天数", en: "Avg Turnover Days" }, value: "42", change: "-2.1%", trend: "up" },
];

// 2. AI 推荐问题 (新增)
const suggestedQuestions: LangString[] = [
  { zh: "📦 哪些商品库存不足？", en: "📦 Which items are low on stock?" },
  { zh: "📈 预测下个月的销量", en: "📈 Forecast sales for next month" },
  { zh: "💰 滞销品有哪些？", en: "💰 Show me slow-moving items" },
];

// 3. 底部动态 (新增)
const recentActivities = [
  { time: "10 min ago", text: { zh: "用户 Admin 上传了 '2025_Q1_库存表.xlsx'", en: "User Admin uploaded '2025_Q1_Inventory.xlsx'" } },
  { time: "2 hours ago", text: { zh: "系统检测到 SKU-8829 库存低于安全水位", en: "System detected SKU-8829 is below safety stock" }, type: "warning" },
  { time: "Yesterday", text: { zh: "完成了 12 月份的月度盘点报告", en: "Completed monthly inventory report for December" } },
];

// 4. 左侧操作入口 (保留原样)
const operationActions: QuickAction[] = [
  {
    key: "upload", href: "/inventory",
    title: { zh: "上传库存数据", en: "Upload Inventory Data" },
    description: { zh: "导入 CSV/Excel 库存清单，更新库存数据库。", en: "Import CSV/Excel inventory sheets to update the DB." },
  },
  {
    key: "database", href: "/dataset",
    title: { zh: "库存数据库", en: "Inventory Database" },
    description: { zh: "查看所有已上传的数据集与字段结构。", en: "View all uploaded datasets and schema." },
  },
  {
    key: "lookup", href: "/search",
    title: { zh: "库存查询", en: "Inventory Lookup" },
    description: { zh: "按 SKU / 品名快速查询库存数量与仓位。", en: "Quickly search stock by SKU or product name." },
    badge: { zh: "常用", en: "Popular" },
  },
  {
    key: "movements", href: "/inventory",
    title: { zh: "入库 / 出库记录", en: "Stock Movements" },
    description: { zh: "查看最近的入库、出库与调整记录。", en: "See recent inbound, outbound and adjustment records." },
  },
  {
    key: "reports", href: "/dataset",
    title: { zh: "库存报表导出", en: "Inventory Reports" },
    description: { zh: "导出库存明细、出入库报表、月度汇总。", en: "Export stock detail, movement and monthly reports." },
  },
];

// 5. 右侧智能分析（6个按钮：不重叠）
const analyticsActions: QuickAction[] = [
  {
    key: "forecast_replenish",
    href: "/analytics/forecast",
    title: { zh: "预测 & 补货", en: "Forecast & Replenish" },
    description: { zh: "预测需求、预计缺货日期、生成建议补货量。", en: "Forecast demand, stockout date, and reorder qty." },
    badge: { zh: "核心", en: "Core" },
  },
  {
    key: "alerts_risk",
    href: "/analytics/alerts",
    title: { zh: "预警 & 风险", en: "Alerts & Risk" },
    description: { zh: "低库存预警、风险分级与待处理列表。", en: "Low-stock alerts, risk tiers, and action queue." },
    badge: { zh: "推荐", en: "Hot" },
  },
  {
    key: "turnover_slow",
    href: "/analytics/turnover",
    title: { zh: "周转 & 滞销", en: "Turnover & Slow-Moving" },
    description: { zh: "库存天数、周转率、呆滞品识别与处置建议。", en: "Turnover, days on hand, slow movers & actions." },
  },
  {
    key: "abc_segment",
    href: "/analytics/abc",
    title: { zh: "ABC & 分层策略", en: "ABC & Segmentation" },
    description: { zh: "按价值/销量分层，制定差异化补货策略。", en: "Segment SKUs and tailor inventory policies." },
  },
  {
    key: "anomaly_quality",
    href: "/analytics/anomaly",
    title: { zh: "异常 & 数据质量", en: "Anomaly & Data Quality" },
    description: { zh: "异常销量/库存变化检测，数据完整性提示。", en: "Detect anomalies and flag data issues." },
  },
  {
    key: "performance_accuracy",
    href: "/analytics/performance",
    title: { zh: "表现 & 准确度", en: "Performance & Accuracy" },
    description: { zh: "MAPE/Bias、预测稳定性、数据更新状态。", en: "MAPE/Bias, stability, and data freshness." },
  },
];


// 文字常量
const TEXT = {
  title: { zh: "Inventory Intelligence", en: "Inventory Intelligence" } as LangString,
  welcome: { zh: "欢迎使用！", en: "Welcome!" } as LangString,
  askPrompt: { zh: "请问今天想问些什么？", en: "What would you like to ask today?" } as LangString,
  inputPlaceholder: { zh: "请输入问题...", en: "Ask something..." } as LangString,
  send: { zh: "发送", en: "Send" } as LangString,
  thinking: { zh: "思考中...", en: "Thinking..." } as LangString,
  aiReplyPrefix: { zh: "AI (模拟回复): ", en: "AI (Mock): " } as LangString,
  operationsTitle: { zh: "操作入口", en: "Operations" } as LangString,
  operationsSubtitle: { zh: "与数据最直接相关的日常操作。", en: "Day-to-day actions directly related to your data." } as LangString,
  analyticsTitle: { zh: "智能分析", en: "Intelligent Analytics" } as LangString,
  analyticsSubtitle: { zh: "用数据与 AI 帮你做更聪明的决策。", en: "Use data & AI to support smarter decisions." } as LangString,
  recentActivityTitle: { zh: "最近动态", en: "Recent Activity" } as LangString,
  trendTitle: { zh: "本周出库趋势", en: "Weekly Outbound Trend" } as LangString,
};

function t(str: LangString, lang: Lang) {
  return str[lang || "zh"];
}

// --- 组件部分 ---

// 1. 快捷卡片组件 (保留原样)
function QuickActionCard({ action, lang }: { action: QuickAction; lang: Lang }) {
  return (
    <Link href={action.href} className="block group">
      <div className="w-full rounded-xl border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700 px-4 py-3 shadow hover:shadow-md transition-all group-hover:border-blue-300 dark:group-hover:border-blue-500">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold text-sm md:text-base text-slate-900 dark:text-blue-100 group-hover:text-blue-600 dark:group-hover:text-blue-300">
              {t(action.title, lang)}
            </div>
            <p className="mt-1 text-xs md:text-sm text-slate-600 dark:text-slate-300">
              {t(action.description, lang)}
            </p>
          </div>
          {action.badge && (
            <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-100 px-2 py-0.5 text-[10px] font-bold">
              {t(action.badge, lang)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

// 2. KPI 卡片组件 (新增)
function KPICards({ lang }: { lang: Lang }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
      {kpiData.map((item, index) => (
        <div key={index} className="p-4 rounded-xl border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm flex flex-col justify-between">
          <div className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">
            {t(item.label, lang)}
          </div>
          <div className="mt-2 flex items-end justify-between">
            <div className={`text-2xl font-bold ${item.highlight ? "text-red-600 dark:text-red-400" : "text-slate-800 dark:text-white"}`}>
              {item.value}
            </div>
            <div className={`text-xs font-medium px-1.5 py-0.5 rounded ${
              item.trend === "up" ? "text-green-700 bg-green-50 dark:bg-green-900/30 dark:text-green-400" :
              item.trend === "down" ? "text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-400" :
              "text-slate-600 bg-slate-100 dark:bg-slate-700 dark:text-slate-300"
            }`}>
              {item.change}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// 3. 简易图表组件 (新增 - CSS绘制，无需插件)
function SimpleChart() {
  const bars = [40, 65, 34, 82, 55, 70, 48];
  return (
    <div className="flex items-end justify-between h-32 gap-2 mt-4 px-2">
      {bars.map((h, i) => (
        <div key={i} className="w-full flex flex-col items-center gap-1 group cursor-pointer">
          <div 
            className="w-full bg-blue-200 dark:bg-blue-900/50 rounded-t-sm group-hover:bg-blue-400 dark:group-hover:bg-blue-500 transition-colors relative"
            style={{ height: `${h}%` }}
          >
             <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] bg-slate-800 text-white px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
               {h * 10}
             </div>
          </div>
          <div className="text-[10px] text-slate-400 dark:text-slate-500">
            {["M", "T", "W", "T", "F", "S", "S"][i]}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- 主页面 ---
export default function HomePage() {
  const { lang } = useLanguage(); 
  
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleAsk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setIsLoading(true);
    setTimeout(() => {
      setAnswer(t(TEXT.aiReplyPrefix, lang) + question);
      setIsLoading(false);
    }, 400);
  };

  return (
    <div className="py-2 md:py-4 space-y-8 max-w-7xl mx-auto">
      
      {/* 1. 标题区域 (保留了您要求的正蓝色方案) */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl md:text-5xl font-extrabold italic text-blue-700 dark:text-blue-400 drop-shadow-sm">
          {t(TEXT.title, lang)}
        </h1>
        <p className="text-base md:text-lg text-blue-600/80 dark:text-blue-300/80">
          {t(TEXT.welcome, lang)}
        </p>
      </div>

      {/* 2. KPI 数据区域 (新增) */}
      <section>
        <KPICards lang={lang} />
      </section>

      {/* 3. 核心三列布局 (保留原样) */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_260px] gap-6 items-start">
        
        {/* 左侧：操作 */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-bold text-blue-700 dark:text-blue-400">
              {t(TEXT.operationsTitle, lang)}
            </h2>
            <p className="text-xs text-blue-600/80 dark:text-blue-300/80">
              {t(TEXT.operationsSubtitle, lang)}
            </p>
          </div>
          <div className="space-y-3">
            {operationActions.map((action) => (
              <QuickActionCard key={action.key} action={action} lang={lang} />
            ))}
          </div>
        </section>

        {/* 中间：AI (增加了推荐问题) */}
        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-600 px-4 py-6 shadow-sm flex flex-col h-full min-h-[400px]">
            <p className="text-sm md:text-base text-slate-900 dark:text-white mb-3 font-semibold">
              {t(TEXT.askPrompt, lang)}
            </p>
            
            {/* 输入框 */}
            <form onSubmit={handleAsk} className="flex gap-2">
              <input
                className="flex-1 border border-slate-300 dark:border-slate-500 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder={t(TEXT.inputPlaceholder, lang)}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <button
                type="submit"
                disabled={isLoading}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold shadow hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
              >
                {isLoading ? t(TEXT.thinking, lang) : t(TEXT.send, lang)}
              </button>
            </form>

            {/* AI 推荐问题 (新增) */}
            <div className="mt-4 flex flex-wrap gap-2">
              {suggestedQuestions.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => setQuestion(t(q, lang))}
                  className="px-3 py-1 rounded-full text-xs bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 hover:border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800 dark:hover:bg-blue-900/50 transition-colors"
                >
                  {t(q, lang)}
                </button>
              ))}
            </div>

            {/* 回复区域 */}
            {answer && (
              <div className="mt-6 flex-1 bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700 rounded-xl p-4 text-sm text-slate-800 dark:text-slate-200">
                {answer}
              </div>
            )}
            
            {!answer && (
              <div className="flex-1 flex items-center justify-center text-slate-300 dark:text-slate-600 text-4xl">
                🤖
              </div>
            )}
          </div>
        </section>

        {/* 右侧：分析（按钮入口） */}
<section className="space-y-3">
  <div>
    <h2 className="text-sm font-bold text-blue-700 dark:text-blue-400">
      {t(TEXT.analyticsTitle, lang)}
    </h2>
    <p className="text-xs text-blue-600/80 dark:text-blue-300/80">
      {t(TEXT.analyticsSubtitle, lang)}
    </p>
  </div>

  <div className="space-y-3">
    {analyticsActions.map((action) => (
      <QuickActionCard key={action.key} action={action} lang={lang} />
    ))}
  </div>
</section>
      </div>

      {/* 4. 底部动态与图表 (新增) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-200 dark:border-slate-800">
        
        {/* 左下：最近动态 */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            {t(TEXT.recentActivityTitle, lang)}
          </h3>
          <ul className="space-y-3">
            {recentActivities.map((act, idx) => (
              <li key={idx} className="flex gap-3 items-start text-xs border-b last:border-0 border-slate-100 dark:border-slate-700 pb-2 last:pb-0">
                <span className="text-slate-400 dark:text-slate-500 whitespace-nowrap font-mono">{act.time}</span>
                <span className={`${act.type === 'warning' ? 'text-orange-600 dark:text-orange-400' : 'text-slate-700 dark:text-slate-300'}`}>
                  {t(act.text, lang)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* 右下：简易图表 */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
            {t(TEXT.trendTitle, lang)}
          </h3>
          <SimpleChart />
        </div>

      </div>
    </div>
  );
}