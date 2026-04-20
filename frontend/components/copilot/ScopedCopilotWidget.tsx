"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type CopilotRole = "user" | "assistant";

type CopilotMessage = {
  role: CopilotRole;
  content: string;
  outOfScope?: boolean;
  redirectTo?: string | null;
};

type ScopedCopilotWidgetProps = {
  endpoint: string;
  pageScope: "alerts" | "forecast";
  scopeInstruction: string;
  contextData?: unknown;
  title?: string;
  titleZh?: string;
  subtitle?: string;
  subtitleZh?: string;
  suggestedPrompts?: string[];
};

function extractErrorText(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const maybeError = (payload as { error?: unknown }).error;
  if (typeof maybeError === "string" && maybeError.trim()) return maybeError;
  return fallback;
}

export default function ScopedCopilotWidget({
  endpoint,
  pageScope,
  scopeInstruction,
  contextData,
  title = "Intelligence Helper",
  titleZh = "智能助手",
  subtitle = "Page-scoped Q&A",
  subtitleZh = "页面范围内问答",
  suggestedPrompts = [],
}: ScopedCopilotWidgetProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<CopilotMessage[]>([]);

  // Detect language from HTML lang attribute (set by LanguageProvider)
  const isZh = typeof document !== "undefined"
    ? document.documentElement.lang !== "en"
    : true;

  const placeholder = useMemo(() => {
    if (pageScope === "alerts")
      return isZh ? "问我 OOS/LOW/HIGH、阈值、补货建议..." : "Ask about OOS/LOW/HIGH, thresholds, reorder suggestions...";
    return isZh ? "继续问当前页面相关问题..." : "Ask anything about this page...";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageScope]);

  const handleAsk = async (questionRaw: string) => {
    const question = questionRaw.trim();
    if (!question || isLoading) return;

    const nextMessages: CopilotMessage[] = [
      ...messages,
      { role: "user", content: question },
      { role: "assistant", content: "思考中..." },
    ];
    setMessages(nextMessages);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageScope,
          scopeInstruction,
          contextData,
          messages: nextMessages
            .filter((m) => m.content !== "思考中...")
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const payload = await res.json();
      if (!res.ok) {
        const text = extractErrorText(payload, "AI 请求失败，请稍后重试。");
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "assistant", content: text },
        ]);
        return;
      }

      const answer =
        typeof payload?.answer === "string" && payload.answer.trim()
          ? payload.answer.trim()
          : "当前暂无可用回答。";

      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant",
          content: answer,
          outOfScope: Boolean(payload?.outOfScope),
          redirectTo: typeof payload?.redirectTo === "string" ? payload.redirectTo : null,
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant",
          content: error instanceof Error ? error.message : "AI 请求失败，请稍后重试。",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-40">
      {isOpen ? (
        <div className="w-[360px] overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/95 shadow-[0_16px_40px_rgba(2,6,23,0.55)] backdrop-blur">
          <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-cyan-200">
                {isZh ? titleZh : title}
              </h3>
              <p className="text-xs text-slate-400">{isZh ? subtitleZh : subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              {isZh ? "收起" : "Close"}
            </button>
          </header>

          <div className="max-h-[360px] space-y-2 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <p className="text-sm text-slate-500">
                {isZh ? "欢迎使用智能助手。" : "Welcome to Intelligence Helper."}
              </p>
            ) : (
              messages.map((msg, idx) => (
                <div
                  key={`${msg.role}-${idx}`}
                  className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "ml-8 bg-cyan-500/80 text-slate-950"
                      : "mr-8 border border-slate-700 bg-slate-900 text-slate-100"
                  }`}
                >
                  <p>{msg.content}</p>
                  {msg.role === "assistant" && msg.outOfScope && (
                    <button
                      type="button"
                      onClick={() => router.push(msg.redirectTo || "/home")}
                      className="mt-2 rounded-md border border-cyan-400/40 bg-cyan-500/15 px-2.5 py-1 text-xs text-cyan-100 hover:bg-cyan-500/25"
                    >
                      返回首页 / Dashboard
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {suggestedPrompts.length > 0 && (
            <div className="border-t border-slate-800 px-4 py-2">
              <div className="flex flex-wrap gap-2">
                {suggestedPrompts.slice(0, 3).map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => handleAsk(prompt)}
                    disabled={isLoading}
                    className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-cyan-400/40 hover:text-cyan-200 disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleAsk(input);
            }}
            className="border-t border-slate-800 px-4 py-3"
          >
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={placeholder}
                className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="rounded-xl border border-cyan-300/50 bg-cyan-500/15 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading ? "..." : isZh ? "发送" : "Send"}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setIsOpen(true);
            setTimeout(() => inputRef.current?.focus(), 60);
          }}
          className="rounded-full border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-100 shadow-[0_8px_30px_rgba(34,211,238,0.25)] hover:bg-cyan-500/25"
        >
          {isZh ? "智能助手" : "Intelligence Helper"}
        </button>
      )}
    </div>
  );
}
