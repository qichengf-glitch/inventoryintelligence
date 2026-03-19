"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useLanguage, type Lang } from "@/components/LanguageProvider";

type SuggestedLink = { label: string; labelZh: string; href: string };

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  model?: string;
  isInsight?: boolean;
  htmlContent?: string | null;
  suggestedLinks?: SuggestedLink[];
};

type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  messages: ChatMessage[];
};

type LangString = {
  zh: string;
  en: string;
};

type InsightContext = {
  latestMonth: string | null;
  kpis: Array<{ id: string; value: number }>;
  stockStatus: {
    percentages: {
      normal_stock?: number;
      low_stock?: number;
      out_of_stock?: number;
      over_stock?: number;
    };
  };
};

type CopilotPanelProps = {
  summaryContext?: unknown;
  insightContext?: InsightContext | null;
  dashboardLoading?: boolean;
};

const suggestedQuestions: LangString[] = [
  { zh: "哪些 SKU 库存低于安全库存？", en: "Which SKUs are below safety stock?" },
  { zh: "预测下个月的销量趋势", en: "Forecast next month's sales trend." },
  { zh: "给我补货优先级建议", en: "Give me replenishment priorities." },
];

const TEXT = {
  title: { zh: "AI COPILOT", en: "AI COPILOT" },
  subtitle: {
    zh: "将问题、预测和库存上下文放在同一对话中。",
    en: "Keep questions, forecast, and inventory context in one thread.",
  },
  newChat: { zh: "New chat", en: "New chat" },
  clearChat: { zh: "Clear", en: "Clear" },
  chats: { zh: "Chats", en: "Chats" },
  placeholder: { zh: "输入你的问题...", en: "Ask your question..." },
  send: { zh: "Send", en: "Send" },
  empty: { zh: "正在生成本月数据洞察...", en: "Generating monthly insight..." },
  emptyNoContext: { zh: "输入问题开始对话", en: "Ask something to start a conversation" },
  model: { zh: "Model", en: "Model" },
  insightLabel: { zh: "📊 本月数据解读", en: "📊 Monthly Insight" },
  goTo: { zh: "前往", en: "Go to" },
};

function t(str: LangString, lang: Lang) {
  return str[lang || "zh"];
}

function buildNewSession(lang: Lang): ChatSession {
  return {
    id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: lang === "zh" ? "新对话" : "New chat",
    createdAt: Date.now(),
    messages: [],
  };
}

/** Sandboxed iframe for AI-generated HTML charts */
function HtmlChart({ html }: { html: string }) {
  const blob = useMemo(() => {
    const b = new Blob([html], { type: "text/html" });
    return URL.createObjectURL(b);
  }, [html]);

  useEffect(() => {
    return () => URL.revokeObjectURL(blob);
  }, [blob]);

  return (
    <iframe
      src={blob}
      sandbox="allow-scripts"
      className="mt-3 h-72 w-full rounded-xl border border-slate-700 bg-slate-950"
      title="AI generated chart"
    />
  );
}

export default function CopilotPanel({ summaryContext, insightContext, dashboardLoading }: CopilotPanelProps) {
  const { lang } = useLanguage();

  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState("gpt-4.1-mini");
  const [usedModel, setUsedModel] = useState<string | null>(null);

  const [sessions, setSessions] = useState<ChatSession[]>(() => [buildNewSession(lang)]);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => sessions[0]?.id || "");

  const inputRef = useRef<HTMLInputElement | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  // Track whether we've already auto-generated the insight for the current session
  const autoInsightFiredRef = useRef(false);

  useEffect(() => {
    if (!activeSessionId && sessions[0]) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions]);

  const activeSession = useMemo(() => {
    return sessions.find((session) => session.id === activeSessionId) || sessions[0];
  }, [activeSessionId, sessions]);

  const activeMessages = activeSession?.messages || [];

  const scrollMessagesToBottom = (behavior: ScrollBehavior = "auto") => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  };

  useEffect(() => {
    scrollMessagesToBottom("smooth");
  }, [activeMessages.length, activeSession?.id]);

  const updateSessionMessages = (
    sessionId: string,
    updater: (previous: ChatMessage[]) => ChatMessage[],
    maybeTitle?: string
  ) => {
    setSessions((previous) =>
      previous.map((session) => {
        if (session.id !== sessionId) return session;

        const canRename = session.title === "New chat" || session.title === "新对话";
        return {
          ...session,
          title: maybeTitle && canRename ? maybeTitle : session.title,
          messages: updater(session.messages),
        };
      })
    );
  };

  const createNewChat = () => {
    const session = buildNewSession(lang);
    autoInsightFiredRef.current = false;
    setSessions((previous) => [session, ...previous]);
    setActiveSessionId(session.id);
    setQuestion("");
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const clearCurrentChat = () => {
    if (!activeSession) return;
    autoInsightFiredRef.current = false;
    setSessions((previous) =>
      previous.map((session) => {
        if (session.id !== activeSession.id) return session;
        return {
          ...session,
          messages: [],
          title: lang === "zh" ? "新对话" : "New chat",
        };
      })
    );
    setQuestion("");
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  /** Core AI call — shared by user asks and auto-insight */
  const callAI = async (opts: {
    sessionId: string;
    assistantId: string;
    prompt: string;
    isInsight?: boolean;
    sessionTitle?: string;
    useModel?: string;
    recentChat?: Array<{ role: "user" | "assistant"; text: string }>;
  }) => {
    const { sessionId, assistantId, prompt, isInsight, sessionTitle, useModel, recentChat } = opts;
    const raw = localStorage.getItem("ii:forecast:latest");
    const forecastSummary = raw ? JSON.parse(raw) : null;

    const response = await fetch("/api/ai/forecast-advice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "home",
        question: prompt,
        forecastSummary,
        dashboardSummaryContext: summaryContext,
        recentChat: recentChat ?? [],
        lang,
        model: useModel ?? selectedModel,
      }),
    });

    const data = await response.json();
    const modelName = typeof data?.model === "string" ? data.model : (useModel ?? selectedModel);
    setUsedModel(modelName);

    if (!response.ok) {
      const code = typeof data?.code === "string" ? data.code : "";
      const messageText =
        code === "insufficient_quota"
          ? lang === "zh"
            ? "当前 API 项目额度不足（insufficient_quota）。"
            : "Insufficient quota for this API project."
          : typeof data?.error === "string"
          ? data.error
          : "AI request failed";

      updateSessionMessages(sessionId, (previous) =>
        previous.map((item) =>
          item.id === assistantId ? { ...item, text: messageText, model: modelName } : item
        )
      );
      return;
    }

    updateSessionMessages(
      sessionId,
      (previous) =>
        previous.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                text: String(data?.answer || ""),
                model: modelName,
                isInsight: isInsight ?? message.isInsight,
                htmlContent: data?.htmlContent ?? null,
                suggestedLinks: data?.suggestedLinks ?? [],
              }
            : message
        ),
      sessionTitle
    );
  };

  /** Auto-generate insight when insightContext becomes available for an empty session */
  useEffect(() => {
    if (
      autoInsightFiredRef.current ||
      !insightContext ||
      dashboardLoading ||
      !activeSession ||
      activeSession.messages.length > 0
    ) {
      return;
    }

    autoInsightFiredRef.current = true;

    const { kpis, stockStatus, latestMonth } = insightContext;
    const find = (id: string) => kpis.find((k) => k.id === id)?.value ?? 0;
    const pct = stockStatus.percentages;

    const riskPct = ((find("kpi_2") / Math.max(find("kpi_1"), 1)) * 100).toFixed(1);
    const stockCoverMonths = find("kpi_4") > 0
      ? (find("kpi_3") / find("kpi_4")).toFixed(1)
      : "N/A";

    const prompt =
      lang === "zh"
        ? `你是一位专业库存管理分析师，请根据以下数据生成一份简洁的本月库存管理简报，结构如下（直接输出内容，不要重复结构标题之外的分析）：

**一、本月整体库存健康状况**
（2-3句总结整体状态：正常率、风险比例、与上月对比趋势）

**二、核心风险识别**
（分别说明高库存、低库存、缺货的数量和主要影响，各1-2句）

**三、销售与库存匹配度分析**
（基于库存覆盖月数和销售趋势，说明供需是否平衡，2-3句）

**四、本月优先行动建议**
（列出3-5条带【紧急】【重要】【关注】标签的具体行动项）

数据：统计月份=${latestMonth}；SKU总数=${find("kpi_1")}；风险SKU=${find("kpi_2")}（占比${riskPct}%）；当前总库存=${find("kpi_3").toLocaleString()}；月销售量=${find("kpi_4").toLocaleString()}；库存覆盖约${stockCoverMonths}个月；库存健康分布：正常=${pct.normal_stock?.toFixed(1)}%，低库存=${pct.low_stock?.toFixed(1)}%，缺货=${pct.out_of_stock?.toFixed(1)}%，过库存=${pct.over_stock?.toFixed(1)}%。`
        : `You are a professional inventory analyst. Generate a concise monthly inventory management brief using the structure below (output the content directly under each heading):

**1. Overall Inventory Health**
(2-3 sentences: healthy rate, risk ratio, trend vs. last month)

**2. Core Risk Identification**
(1-2 sentences each on: overstock, low stock, and out-of-stock — counts and business impact)

**3. Sales-Inventory Alignment**
(2-3 sentences on stock cover months and supply/demand balance)

**4. Priority Actions This Month**
(3-5 specific action items tagged [URGENT] [IMPORTANT] [MONITOR])

Data: month=${latestMonth}; total_skus=${find("kpi_1")}; at_risk_skus=${find("kpi_2")} (${riskPct}%); total_stock=${find("kpi_3").toLocaleString()}; monthly_sales=${find("kpi_4").toLocaleString()}; stock_cover_months=${stockCoverMonths}; distribution: healthy=${pct.normal_stock?.toFixed(1)}%, low=${pct.low_stock?.toFixed(1)}%, oos=${pct.out_of_stock?.toFixed(1)}%, overstock=${pct.over_stock?.toFixed(1)}%.`;

    const sessionId = activeSession.id;
    const assistantId = `${Date.now()}-insight`;
    const insightTitle = t(TEXT.insightLabel, lang);

    updateSessionMessages(
      sessionId,
      (prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          text: lang === "zh" ? "正在解读数据…" : "Analysing data…",
          model: selectedModel,
          isInsight: true,
        },
      ],
      insightTitle
    );

    callAI({
      sessionId,
      assistantId,
      prompt,
      isInsight: true,
      sessionTitle: insightTitle,
    }).catch(() => {
      updateSessionMessages(sessionId, (prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, text: lang === "zh" ? "请求失败，请重试。" : "Request failed." }
            : m
        )
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insightContext, dashboardLoading]);

  const handleAsk = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt || !activeSession) return;

    const sessionId = activeSession.id;
    const recentChat = activeSession.messages
      .slice(-8)
      .map((message) => ({ role: message.role, text: message.text }));

    const userId = `${Date.now()}-u`;
    const assistantId = `${Date.now()}-a`;

    updateSessionMessages(
      sessionId,
      (previous) => [
        ...previous,
        { id: userId, role: "user", text: prompt },
        {
          id: assistantId,
          role: "assistant",
          text: lang === "zh" ? "正在思考..." : "Thinking...",
          model: selectedModel,
        },
      ],
      prompt.slice(0, 30)
    );

    setQuestion("");
    setIsLoading(true);

    try {
      await callAI({ sessionId, assistantId, prompt, recentChat });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      updateSessionMessages(sessionId, (previous) =>
        previous.map((item) =>
          item.id === assistantId ? { ...item, text: message, model: selectedModel } : item
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 shadow-[0_12px_35px_rgba(2,6,23,0.4)]">
      <header className="border-b border-slate-800 px-4 py-3 md:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200">
              {t(TEXT.title, lang)}
            </h2>
            <p className="mt-1 text-xs text-slate-400">{t(TEXT.subtitle, lang)}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-slate-400" htmlFor="copilot-model">
              {t(TEXT.model, lang)}
            </label>
            <select
              id="copilot-model"
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.target.value)}
              className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
            >
              <option value="gpt-4o-mini">gpt-4o-mini</option>
              <option value="gpt-4.1-mini">gpt-4.1-mini</option>
              <option value="gpt-4.1">gpt-4.1</option>
            </select>
            <button
              type="button"
              onClick={createNewChat}
              className="rounded-md border border-cyan-400/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20"
            >
              {t(TEXT.newChat, lang)}
            </button>
            <button
              type="button"
              onClick={clearCurrentChat}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              {t(TEXT.clearChat, lang)}
            </button>
          </div>
        </div>
      </header>

      <div className="grid h-[68vh] min-h-[560px] grid-cols-1 md:grid-cols-[240px_1fr]">
        <aside className="border-b border-slate-800 p-3 md:border-b-0 md:border-r">
          <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-slate-400">
            {t(TEXT.chats, lang)}
          </p>
          <div className="max-h-[220px] space-y-1 overflow-auto pr-1 md:max-h-[calc(68vh-120px)]">
            {sessions.map((session) => {
              const active = session.id === activeSession?.id;
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setActiveSessionId(session.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                    active
                      ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-100"
                      : "border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600 hover:bg-slate-800"
                  }`}
                >
                  <div className="truncate">{session.title}</div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          <div ref={messagesViewportRef} className="flex-1 overflow-y-auto p-4">
            {activeMessages.length ? (
              <div className="space-y-3">
                {activeMessages.map((message) => (
                  <article
                    key={message.id}
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      message.role === "user"
                        ? "ml-auto bg-cyan-500 text-slate-950"
                        : message.isInsight
                        ? "mr-auto border border-cyan-500/30 bg-cyan-950/40 text-slate-100"
                        : "mr-auto border border-slate-700 bg-slate-900 text-slate-100"
                    }`}
                  >
                    {message.role === "assistant" && (
                      <p className={`mb-2 text-[11px] ${message.isInsight ? "text-cyan-400/80" : "text-slate-400"}`}>
                        {message.isInsight
                          ? t(TEXT.insightLabel, lang)
                          : `${t(TEXT.model, lang)}: ${message.model || usedModel || selectedModel}`}
                      </p>
                    )}
                    {message.text}

                    {/* HTML chart block */}
                    {message.htmlContent && <HtmlChart html={message.htmlContent} />}

                    {/* Suggested navigation links */}
                    {message.suggestedLinks && message.suggestedLinks.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {message.suggestedLinks.map((link) => (
                          <Link
                            key={link.href}
                            href={link.href}
                            className="inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300 transition hover:bg-cyan-500/20"
                          >
                            <span>→</span>
                            {lang === "zh" ? link.labelZh : link.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="grid h-full place-items-center text-sm text-slate-500">
                {insightContext
                  ? t(TEXT.empty, lang)
                  : t(TEXT.emptyNoContext, lang)}
              </div>
            )}
          </div>

          <div className="sticky bottom-0 border-t border-slate-800 bg-slate-950/95 p-4 backdrop-blur">
            <form onSubmit={handleAsk} className="space-y-3">
              <div className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2">
                <input
                  ref={inputRef}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder={t(TEXT.placeholder, lang)}
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isLoading}
                  className="rounded-full bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading ? "..." : t(TEXT.send, lang)}
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {suggestedQuestions.map((item) => (
                  <button
                    key={item.en}
                    type="button"
                    onClick={() => setQuestion(t(item, lang))}
                    className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-200"
                  >
                    {t(item, lang)}
                  </button>
                ))}
              </div>
            </form>
          </div>
        </section>
      </div>
    </section>
  );
}
