"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

/* ── Types ─────────────────────────────────────────────────── */
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  loading?: boolean;
};

/* ── Suggestion chips ───────────────────────────────────────── */
const SUGGESTIONS = {
  zh: [
    "哪些 SKU 目前库存最紧张？",
    "销量增长最快的品类是哪个？",
    "我应该优先补哪些货？",
    "有哪些 SKU 库存积压严重？",
    "整体库存健康状况怎么样？",
    "哪些 SKU 最近销量在下滑？",
  ],
  en: [
    "Which SKUs have the most critical stock levels?",
    "Which category is growing fastest?",
    "What should I reorder first?",
    "Which SKUs have excess stock?",
    "What's the overall inventory health?",
    "Which SKUs are seeing declining sales?",
  ],
};

const CARD = "rounded-2xl border border-slate-800 bg-slate-900/70";

export default function AskPage() {
  const { lang } = useLanguage();
  const isZh = lang === "zh";
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (question: string) => {
    const q = question.trim();
    if (!q || isLoading) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: q };
    const loadingMsg: Message = { id: crypto.randomUUID(), role: "assistant", content: "", loading: true };

    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setInput("");
    setIsLoading(true);

    const history = messages
      .filter(m => !m.loading)
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch("/api/ai/ask-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history, lang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);

      setMessages(prev =>
        prev.map(m =>
          m.id === loadingMsg.id
            ? { ...m, content: data.answer, model: data.model, loading: false }
            : m
        )
      );
    } catch (e) {
      const err = e instanceof Error ? e.message : "Request failed";
      setMessages(prev =>
        prev.map(m =>
          m.id === loadingMsg.id
            ? { ...m, content: isZh ? `错误：${err}` : `Error: ${err}`, loading: false }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleClear = () => {
    setMessages([]);
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className={`${CARD} px-5 py-4`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.15em] text-slate-400">
              {isZh ? "智能问答" : "Ask AI"}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-100">
              {isZh ? "数据问答" : "Ask Your Data"}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {isZh
                ? "用自然语言查询你的库存数据，AI 实时分析并给出答案。"
                : "Query your inventory in plain language — AI analyses live data and answers instantly."}
            </p>
          </div>
          <span className="text-3xl">🤖</span>
        </div>
      </div>

      {/* Suggestions (only when no messages) */}
      {messages.length === 0 && (
        <div className={`${CARD} p-4`}>
          <p className="text-xs text-slate-400 mb-3">
            {isZh ? "你可以这样问：" : "Try asking:"}
          </p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS[lang].map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => sendMessage(s)}
                className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300 hover:border-cyan-500/50 hover:text-cyan-300 hover:bg-slate-800 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat area */}
      {messages.length > 0 && (
        <div className={`${CARD} p-4 space-y-4 min-h-[300px] max-h-[60vh] overflow-y-auto`}>
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              {/* Avatar */}
              <div
                className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${
                  msg.role === "user"
                    ? "bg-cyan-500/20 border border-cyan-500/40 text-cyan-300"
                    : "bg-purple-500/20 border border-purple-500/40 text-purple-300"
                }`}
              >
                {msg.role === "user" ? "U" : "AI"}
              </div>

              {/* Bubble */}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                  msg.role === "user"
                    ? "bg-cyan-500/15 border border-cyan-500/30 text-slate-100"
                    : "bg-slate-800 border border-slate-700 text-slate-200"
                }`}
              >
                {msg.loading ? (
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                ) : (
                  <div>
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    {msg.model && (
                      <p className="mt-1.5 text-[10px] text-slate-500">{msg.model}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Input bar */}
      <div className={`${CARD} p-3`}>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={isZh ? "问任何关于你库存的问题…" : "Ask anything about your inventory…"}
            disabled={isLoading}
            className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="rounded-xl border border-cyan-500/40 bg-cyan-500/20 px-4 py-2.5 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? "…" : (isZh ? "发送" : "Send")}
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              {isZh ? "清空" : "Clear"}
            </button>
          )}
        </form>
        <p className="mt-2 text-[10px] text-slate-600 px-1">
          {isZh
            ? "AI 基于你的真实库存数据作答 · GPT-4.1 · 数据每次问答时实时拉取"
            : "AI answers from your live inventory data · GPT-4.1 · Data fetched fresh on each question"}
        </p>
      </div>
    </div>
  );
}
