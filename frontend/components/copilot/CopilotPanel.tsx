"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useLanguage, type Lang } from "@/components/LanguageProvider";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  model?: string;
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

type CopilotPanelProps = {
  summaryContext?: unknown;
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
  empty: { zh: "输入问题开始对话", en: "Ask something to start" },
  model: { zh: "Model", en: "Model" },
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

export default function CopilotPanel({ summaryContext }: CopilotPanelProps) {
  const { lang } = useLanguage();

  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState("gpt-4o-mini");
  const [usedModel, setUsedModel] = useState<string | null>(null);

  const [sessions, setSessions] = useState<ChatSession[]>(() => [buildNewSession(lang)]);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => sessions[0]?.id || "");

  const inputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeSessionId && sessions[0]) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions]);

  const activeSession = useMemo(() => {
    return sessions.find((session) => session.id === activeSessionId) || sessions[0];
  }, [activeSessionId, sessions]);

  const activeMessages = activeSession?.messages || [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeMessages.length]);

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
    setSessions((previous) => [session, ...previous]);
    setActiveSessionId(session.id);
    setQuestion("");
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const clearCurrentChat = () => {
    if (!activeSession) return;

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
      const raw = localStorage.getItem("ii:forecast:latest");
      const forecastSummary = raw ? JSON.parse(raw) : null;

      const response = await fetch("/api/ai/forecast-advice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope: "home",
          question: prompt,
          forecastSummary,
          dashboardSummaryContext: summaryContext,
          recentChat,
          lang,
          model: selectedModel,
        }),
      });

      const data = await response.json();
      const modelName = typeof data?.model === "string" ? data.model : selectedModel;
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
            item.id === assistantId
              ? { ...item, text: messageText, model: modelName }
              : item
          )
        );
        return;
      }

      updateSessionMessages(sessionId, (previous) =>
        previous.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                text: String(data?.answer || ""),
                model: modelName,
              }
            : message
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      updateSessionMessages(sessionId, (previous) =>
        previous.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                text: message,
                model: selectedModel,
              }
            : item
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

          <div className="flex items-center gap-2">
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
          <div className="flex-1 overflow-y-auto p-4">
            {activeMessages.length ? (
              <div className="space-y-3">
                {activeMessages.map((message) => (
                  <article
                    key={message.id}
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      message.role === "user"
                        ? "ml-auto bg-cyan-500 text-slate-950"
                        : "mr-auto border border-slate-700 bg-slate-900 text-slate-100"
                    }`}
                  >
                    {message.role === "assistant" && (
                      <p className="mb-2 text-[11px] text-slate-400">
                        {t(TEXT.model, lang)}: {message.model || usedModel || selectedModel}
                      </p>
                    )}
                    {message.text}
                  </article>
                ))}
                <div ref={messagesEndRef} />
              </div>
            ) : (
              <div className="grid h-full place-items-center text-sm text-slate-500">
                {t(TEXT.empty, lang)}
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
