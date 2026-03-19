"use client";

import React from "react";

type InsightCardProps = {
  report: string | null;
  loading: boolean;
  error: string | null;
  lang: string;
  onRefresh?: () => void;
};

/** Parse a section header line like "**一、标题**" */
function isSectionHeader(line: string) {
  return /^\*\*[^*]+\*\*\s*$/.test(line.trim());
}

/** Parse a bullet line starting with "- " or "– " */
function isBullet(line: string) {
  return line.startsWith("- ") || line.startsWith("– ");
}

/** Render inline **bold** spans */
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+?\*\*)/g);
  return parts.map((part, i) => {
    const m = part.match(/^\*\*(.+?)\*\*$/);
    return m ? (
      <strong key={i} className="font-semibold text-slate-100">
        {m[1]}
      </strong>
    ) : (
      part
    );
  });
}

/** Priority badge detection: [紧急] / [重要] / [关注] / [Urgent] / [Important] / [Monitor] */
function extractPriority(text: string): { badge: React.ReactNode | null; rest: string } {
  const zh = text.match(/^\[(紧急|重要|关注)\]\s*/);
  const en = text.match(/^\[(Urgent|Important|Monitor)\]\s*/);
  const match = zh || en;
  if (!match) return { badge: null, rest: text };

  const label = match[1];
  const colorMap: Record<string, string> = {
    紧急: "bg-red-500/20 text-red-300 border-red-500/40",
    重要: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    关注: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    Urgent: "bg-red-500/20 text-red-300 border-red-500/40",
    Important: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    Monitor: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  };
  const cls = colorMap[label] ?? "bg-slate-500/20 text-slate-300 border-slate-500/30";

  return {
    badge: (
      <span className={`mr-2 inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>
        {label}
      </span>
    ),
    rest: text.slice(match[0].length),
  };
}

type Block =
  | { type: "header"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "para"; text: string }
  | { type: "spacer" };

function parseBlocks(raw: string): Block[] {
  const lines = raw.split("\n");
  const blocks: Block[] = [];
  let bulletBuf: string[] = [];

  function flush() {
    if (bulletBuf.length > 0) {
      blocks.push({ type: "bullets", items: [...bulletBuf] });
      bulletBuf = [];
    }
  }

  for (const line of lines) {
    if (line.trim() === "") {
      flush();
      blocks.push({ type: "spacer" });
    } else if (isSectionHeader(line.trim())) {
      flush();
      blocks.push({ type: "header", text: line.trim().replace(/^\*\*|\*\*\s*$/g, "") });
    } else if (isBullet(line)) {
      bulletBuf.push(line.slice(2));
    } else {
      flush();
      blocks.push({ type: "para", text: line });
    }
  }
  flush();
  return blocks;
}

function renderBlocks(blocks: Block[]): React.ReactNode {
  // Remove leading/trailing spacers
  let start = 0;
  let end = blocks.length - 1;
  while (start <= end && blocks[start].type === "spacer") start++;
  while (end >= start && blocks[end].type === "spacer") end--;
  const trimmed = blocks.slice(start, end + 1);

  return trimmed.map((block, idx) => {
    if (block.type === "spacer") {
      return <div key={idx} className="h-3" />;
    }

    if (block.type === "header") {
      return (
        <div
          key={idx}
          className="mt-5 mb-2 flex items-center gap-2.5 first:mt-0"
        >
          <span className="h-3.5 w-0.5 rounded-full bg-cyan-400/70 shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wide text-cyan-300/90">
            {block.text}
          </span>
        </div>
      );
    }

    if (block.type === "bullets") {
      return (
        <ul key={idx} className="space-y-1.5 my-1">
          {block.items.map((item, i) => {
            const { badge, rest } = extractPriority(item);
            return (
              <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-slate-300">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500/60" />
                <span>
                  {badge}
                  {renderInline(rest)}
                </span>
              </li>
            );
          })}
        </ul>
      );
    }

    if (block.type === "para") {
      return (
        <p key={idx} className="text-sm leading-[1.75] text-slate-300/90">
          {renderInline(block.text)}
        </p>
      );
    }

    return null;
  });
}

const SKELETON_WIDTHS = [92, 78, 85, 60, 88, 72, 80];

export default function InsightCard({ report, loading, error, lang, onRefresh }: InsightCardProps) {
  const blocks = report ? parseBlocks(report) : [];

  return (
    <section className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-slate-900/80 shadow-[0_0_24px_-4px_rgba(34,211,238,0.06)]">
      {/* Top accent strip */}
      <div className="h-px w-full bg-gradient-to-r from-cyan-500/60 via-cyan-400/20 to-transparent" />

      <div className="px-5 py-4">
        {/* Header row */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {/* Pulse dot */}
            <span className="relative flex h-2 w-2 shrink-0">
              {!loading && report && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400/50" />
              )}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${loading ? "bg-slate-600 animate-pulse" : report ? "bg-cyan-400" : "bg-slate-600"}`} />
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-400/80">
              AI Copilot
            </span>
          </div>

          <div className="flex items-center gap-2">
            {loading && (
              <span className="text-xs text-slate-500">
                {lang === "zh" ? "正在分析…" : "Analyzing…"}
              </span>
            )}
            {onRefresh && !loading && (
              <button
                type="button"
                onClick={onRefresh}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-400 transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
              >
                <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 8a6 6 0 1 0 1.5-3.9" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M2 4v4h4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {lang === "zh" ? "重新生成" : "Regenerate"}
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-2">
            {SKELETON_WIDTHS.map((w, i) => (
              <div
                key={i}
                className="h-3 animate-pulse rounded-full bg-slate-700/60"
                style={{ width: `${w}%`, animationDelay: `${i * 80}ms` }}
              />
            ))}
            <div className="mt-4 h-px w-full bg-slate-800" />
            {[55, 70, 50].map((w, i) => (
              <div
                key={`s2-${i}`}
                className="h-3 animate-pulse rounded-full bg-slate-700/40"
                style={{ width: `${w}%`, animationDelay: `${(i + 7) * 80}ms` }}
              />
            ))}
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
            <p className="text-sm text-red-300/80">{error}</p>
          </div>
        ) : report ? (
          <div>{renderBlocks(blocks)}</div>
        ) : null}
      </div>
    </section>
  );
}
