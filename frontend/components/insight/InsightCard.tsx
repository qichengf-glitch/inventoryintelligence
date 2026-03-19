"use client";

import { useEffect, useRef, useState } from "react";

type InsightCardProps = {
  /** The raw report text from the AI (may contain **bold** and - bullet syntax) */
  report: string | null;
  loading: boolean;
  error: string | null;
  lang: string;
  /** Called when user wants to refresh */
  onRefresh?: () => void;
};

/** Converts a line like "**Title**" → <strong>Title</strong> and "- item" → bullet item */
function renderLine(line: string, idx: number) {
  // Section header: **text**
  const headerMatch = line.match(/^\*\*(.+?)\*\*\s*$/);
  if (headerMatch) {
    return (
      <p key={idx} className="mt-4 mb-1 text-sm font-semibold text-slate-100 first:mt-0">
        {headerMatch[1]}
      </p>
    );
  }

  // Bullet line: starts with "- "
  if (line.startsWith("- ") || line.startsWith("– ")) {
    const content = line.slice(2);
    return (
      <li key={idx} className="ml-3 text-sm leading-relaxed text-slate-300">
        {renderInline(content)}
      </li>
    );
  }

  // Empty line → spacing
  if (line.trim() === "") {
    return <div key={idx} className="h-2" />;
  }

  // Regular paragraph
  return (
    <p key={idx} className="text-sm leading-relaxed text-slate-300">
      {renderInline(line)}
    </p>
  );
}

/** Renders inline **bold** markers within a string */
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+?\*\*)/g);
  return parts.map((part, i) => {
    const boldMatch = part.match(/^\*\*(.+?)\*\*$/);
    if (boldMatch) {
      return <strong key={i} className="font-semibold text-slate-100">{boldMatch[1]}</strong>;
    }
    return part;
  });
}

export default function InsightCard({ report, loading, error, lang, onRefresh }: InsightCardProps) {
  const lines = report ? report.split("\n") : [];

  // Group consecutive bullet lines into <ul> blocks
  const blocks: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];
  let bufStart = 0;

  function flushBullets() {
    if (bulletBuffer.length > 0) {
      blocks.push(
        <ul key={`ul-${bufStart}`} className="my-1 space-y-0.5 list-none">
          {bulletBuffer.map((b, i) => renderLine(b, bufStart + i))}
        </ul>
      );
      bulletBuffer = [];
    }
  }

  lines.forEach((line, idx) => {
    if (line.startsWith("- ") || line.startsWith("– ")) {
      if (bulletBuffer.length === 0) bufStart = idx;
      bulletBuffer.push(line);
    } else {
      flushBullets();
      blocks.push(renderLine(line, idx));
    }
  });
  flushBullets();

  return (
    <section className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/20 text-xs text-violet-300">
            AI
          </span>
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
            {lang === "zh" ? "AI 智能分析" : "AI Insight"}
          </span>
        </div>
        {onRefresh && !loading && (
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200 transition-colors"
          >
            {lang === "zh" ? "重新生成" : "Regenerate"}
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2.5">
          {[100, 90, 95, 75, 85].map((w, i) => (
            <div
              key={i}
              className="h-3.5 animate-pulse rounded bg-slate-700/60"
              style={{ width: `${w}%` }}
            />
          ))}
          <p className="mt-3 text-xs text-slate-500">
            {lang === "zh" ? "正在生成分析报告，请稍候…" : "Generating analysis, please wait…"}
          </p>
        </div>
      ) : error ? (
        <p className="text-sm text-red-300/80">{error}</p>
      ) : report ? (
        <div className="space-y-0.5">{blocks}</div>
      ) : null}
    </section>
  );
}
