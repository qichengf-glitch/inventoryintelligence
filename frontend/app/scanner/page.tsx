"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

// ─── Types ──────────────────────────────────────────────────────────────────

type WorkflowMode = "STANDARD" | "RECEIVING" | "STOCKTAKE" | "PICKING";
type MovementType = "IN_PURCHASE" | "IN_RETURN" | "OUT_SALES" | "OUT_DAMAGED" | "ADJUSTMENT";

type LookupResult = {
  found: boolean;
  barcode: string;
  sku?: string;
  label?: string;
  currentStock?: number | null;
  recentMovements?: RecentMovement[];
};

type RecentMovement = {
  id: string;
  movement_type: MovementType;
  qty: number;
  movement_date: string;
  reference_no: string | null;
};

type FeedEntry = {
  id: string;
  sku: string;
  movement_type: MovementType;
  qty: number;
  movement_date: string;
  created_at: string;
  isNew?: boolean;
};

type StocktakeRow = {
  sku: string;
  scanned: number;
  dbStock: number | null;
  diff: number | null;
  loading: boolean;
};

type SessionItem = { sku: string; scanned_qty: number; expected_qty: number | null };

// ─── Constants ───────────────────────────────────────────────────────────────

const TYPE_META: Record<MovementType, {
  labelZh: string; labelEn: string; colorClass: string; bgClass: string; sign: string;
}> = {
  IN_PURCHASE: { labelZh: "采购入库", labelEn: "Purchase In",  colorClass: "text-emerald-300", bgClass: "bg-emerald-500/15 border-emerald-400/40", sign: "+" },
  IN_RETURN:   { labelZh: "退货入库", labelEn: "Return In",    colorClass: "text-teal-300",    bgClass: "bg-teal-500/15 border-teal-400/40",    sign: "+" },
  OUT_SALES:   { labelZh: "销售出库", labelEn: "Sales Out",    colorClass: "text-red-300",     bgClass: "bg-red-500/15 border-red-400/40",     sign: "−" },
  OUT_DAMAGED: { labelZh: "损耗出库", labelEn: "Damaged Out",  colorClass: "text-orange-300",  bgClass: "bg-orange-500/15 border-orange-400/40",  sign: "−" },
  ADJUSTMENT:  { labelZh: "库存调整", labelEn: "Adjustment",   colorClass: "text-amber-300",   bgClass: "bg-amber-500/15 border-amber-400/40",   sign: "±" },
};

const OVERSTOCK_THRESHOLD = 1000;
const CARD = "rounded-2xl border border-slate-800 bg-slate-900/70";
const INPUT_CLS = "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string, lang: "zh" | "en") {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5)  return lang === "zh" ? "刚刚" : "just now";
  if (s < 60) return lang === "zh" ? `${s}秒前` : `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return lang === "zh" ? `${m}分前` : `${m}m ago`;
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getStockWarning(
  currentStock: number | null | undefined,
  qty: number,
  type: MovementType,
  lang: "zh" | "en"
): { level: "red" | "amber" | null; msg: string } {
  if (currentStock == null) return { level: null, msg: "" };
  const isOut = type === "OUT_SALES" || type === "OUT_DAMAGED";
  const isIn  = type === "IN_PURCHASE" || type === "IN_RETURN";
  const projected = isOut ? currentStock - Math.abs(qty) : isIn ? currentStock + Math.abs(qty) : currentStock;
  if (isOut && projected < 0)
    return { level: "red",   msg: lang === "zh" ? `⚠ 出库后库存将为负数 (${projected})` : `⚠ Stock would go negative (${projected})` };
  if (isOut && projected === 0)
    return { level: "amber", msg: lang === "zh" ? "⚠ 出库后库存将归零" : "⚠ This will empty stock to zero" };
  if (isIn && projected > OVERSTOCK_THRESHOLD)
    return { level: "amber", msg: lang === "zh" ? `⚠ 入库后库存将达 ${projected} 件（过高）` : `⚠ Stock would reach ${projected} units (high)` };
  return { level: null, msg: "" };
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ModeTab({ mode, active, icon, label, onClick }: {
  mode: WorkflowMode; active: boolean; icon: string; label: string; onClick: () => void;
}) {
  const colours: Record<WorkflowMode, string> = {
    STANDARD:  active ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-200"       : "border-slate-700 text-slate-400 hover:text-cyan-300 hover:border-cyan-400/30",
    RECEIVING: active ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200" : "border-slate-700 text-slate-400 hover:text-emerald-300 hover:border-emerald-400/30",
    STOCKTAKE: active ? "border-amber-400/50 bg-amber-500/15 text-amber-200"    : "border-slate-700 text-slate-400 hover:text-amber-300 hover:border-amber-400/30",
    PICKING:   active ? "border-red-400/50 bg-red-500/15 text-red-200"          : "border-slate-700 text-slate-400 hover:text-red-300 hover:border-red-400/30",
  };
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-all ${colours[mode]}`}>
      <span>{icon}</span><span>{label}</span>
    </button>
  );
}

function FeedRow({ entry, lang }: { entry: FeedEntry; lang: "zh" | "en" }) {
  const meta = TYPE_META[entry.movement_type];
  const isIn  = entry.movement_type === "IN_PURCHASE" || entry.movement_type === "IN_RETURN";
  const isOut = entry.movement_type === "OUT_SALES"   || entry.movement_type === "OUT_DAMAGED";
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm transition-all duration-500 ${
      entry.isNew ? "border-cyan-400/30 bg-cyan-500/10 shadow-[0_0_10px_rgba(34,211,238,0.12)]" : "border-slate-800 bg-slate-900/50"
    }`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${isIn ? "bg-emerald-400" : isOut ? "bg-red-400" : "bg-amber-400"}`} />
      <span className="w-[60px] shrink-0 text-xs text-slate-500">
        {new Date(entry.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </span>
      <span className="w-24 shrink-0 font-medium text-slate-100 truncate">{entry.sku}</span>
      <span className={`shrink-0 rounded-md border px-2 py-0.5 text-xs ${meta.bgClass} ${meta.colorClass}`}>
        {lang === "zh" ? meta.labelZh : meta.labelEn}
      </span>
      <span className={`ml-auto shrink-0 tabular-nums font-semibold ${isIn ? "text-emerald-300" : isOut ? "text-red-300" : "text-amber-300"}`}>
        {meta.sign}{Math.abs(entry.qty)}
      </span>
      <span className="w-16 shrink-0 text-right text-xs text-slate-500">{timeAgo(entry.created_at, lang)}</span>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ScannerPage() {
  const { lang } = useLanguage();

  // ── Core scanner state ────────────────────────────────────────────────
  const inputRef   = useRef<HTMLInputElement>(null);
  const [inputVal, setInputVal]   = useState("");
  const [isActive, setIsActive]   = useState(false);
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>("STANDARD");

  // ── Lookup ────────────────────────────────────────────────────────────
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult,  setLookupResult]  = useState<LookupResult | null>(null);

  // ── Confirm modal ─────────────────────────────────────────────────────
  const [showModal,    setShowModal]    = useState(false);
  const [confirmQty,   setConfirmQty]   = useState("1");
  const [confirmType,  setConfirmType]  = useState<MovementType>("IN_PURCHASE");
  const [confirmRef,   setConfirmRef]   = useState("");
  const [confirmNotes, setConfirmNotes] = useState("");
  const [submitting,   setSubmitting]   = useState(false);
  const [submitError,  setSubmitError]  = useState<string | null>(null);

  // ── Duplicate scan detection ──────────────────────────────────────────
  const recentScans = useRef<{ sku: string; ts: number }[]>([]);
  const forceScan   = useRef(false);
  const [dupToast, setDupToast] = useState<string | null>(null);
  const dupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Workflow: Receiving ───────────────────────────────────────────────
  const [poReference,    setPoReference]    = useState("");
  const [sessionId,      setSessionId]      = useState<string | null>(null);
  const [sessionItems,   setSessionItems]   = useState<SessionItem[]>([]);

  // ── Workflow: Stocktake ───────────────────────────────────────────────
  const [stocktakeMap,   setStocktakeMap]   = useState<Map<string, number>>(new Map());
  const [stocktakeRows,  setStocktakeRows]  = useState<StocktakeRow[]>([]);
  const [showDiffModal,  setShowDiffModal]  = useState(false);
  const [diffRows,       setDiffRows]       = useState<StocktakeRow[]>([]);
  const [selectedDiffs,  setSelectedDiffs]  = useState<Set<string>>(new Set());
  const [approvingDiff,  setApprovingDiff]  = useState(false);
  const [scanFlash,      setScanFlash]      = useState(false);

  // ── Workflow: Picking ─────────────────────────────────────────────────
  const [orderReference, setOrderReference] = useState("");
  const [pickList,       setPickList]        = useState<Map<string, number>>(new Map());

  // ── Live feed ─────────────────────────────────────────────────────────
  const [feed,           setFeed]           = useState<FeedEntry[]>([]);
  const [feedLoading,    setFeedLoading]    = useState(true);
  const [todayIn,        setTodayIn]        = useState(0);
  const [todayOut,       setTodayOut]       = useState(0);
  const [todayScans,     setTodayScans]     = useState(0);
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "live" | "error">("connecting");

  // ── Session summary ───────────────────────────────────────────────────
  const [summaryOpen,    setSummaryOpen]    = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryReport,  setSummaryReport]  = useState<string | null>(null);
  const [summaryError,   setSummaryError]   = useState<string | null>(null);
  const [summaryDate,    setSummaryDate]    = useState(new Date().toISOString().slice(0, 10));

  // ── Toast ─────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Focus ─────────────────────────────────────────────────────────────
  const focusInput = useCallback(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { focusInput(); }, [focusInput]);

  // ── Load initial feed ─────────────────────────────────────────────────
  const loadFeed = useCallback(async () => {
    setFeedLoading(true);
    try {
      const res  = await fetch("/api/inout/movements?page=1", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        const today = new Date().toISOString().slice(0, 10);
        const entries: FeedEntry[] = data.data ?? [];
        setFeed(entries.slice(0, 20));
        const todayEntries = entries.filter(e => e.movement_date === today || e.created_at?.startsWith(today));
        setTodayScans(todayEntries.length);
        setTodayIn(todayEntries.filter(e => e.movement_type === "IN_PURCHASE" || e.movement_type === "IN_RETURN").reduce((s, e) => s + Math.abs(e.qty), 0));
        setTodayOut(todayEntries.filter(e => e.movement_type === "OUT_SALES" || e.movement_type === "OUT_DAMAGED").reduce((s, e) => s + Math.abs(e.qty), 0));
      }
    } finally { setFeedLoading(false); }
  }, []);

  useEffect(() => { void loadFeed(); }, [loadFeed]);

  // ── Supabase Realtime ─────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel("scanner:movements")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "stock_movements" }, (payload) => {
        const e = payload.new as FeedEntry;
        const entry: FeedEntry = { ...e, isNew: true };
        setFeed(prev => [entry, ...prev].slice(0, 30));
        const today = new Date().toISOString().slice(0, 10);
        if (e.created_at?.startsWith(today) || e.movement_date === today) {
          setTodayScans(c => c + 1);
          const isIn  = e.movement_type === "IN_PURCHASE" || e.movement_type === "IN_RETURN";
          const isOut = e.movement_type === "OUT_SALES"   || e.movement_type === "OUT_DAMAGED";
          if (isIn)  setTodayIn(c => c + Math.abs(e.qty));
          if (isOut) setTodayOut(c => c + Math.abs(e.qty));
        }
        setTimeout(() => setFeed(prev => prev.map(x => x.id === e.id ? { ...x, isNew: false } : x)), 3000);
      })
      .subscribe(s => {
        if (s === "SUBSCRIBED")    setRealtimeStatus("live");
        if (s === "CHANNEL_ERROR") setRealtimeStatus("error");
      });
    return () => { void supabase.removeChannel(channel); };
  }, []);

  // ── Toast helper ──────────────────────────────────────────────────────
  const showToast = useCallback((msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Duplicate scan helper ─────────────────────────────────────────────
  const checkDuplicate = useCallback((sku: string): boolean => {
    const now = Date.now();
    const recent = recentScans.current.filter(r => r.sku === sku && now - r.ts < 5000);
    if (recent.length > 0 && !forceScan.current) {
      const secs = Math.round((now - recent[recent.length - 1].ts) / 1000);
      const msg = lang === "zh"
        ? `⚠ 重复扫码：${sku}（${secs}秒前刚扫过）— 再扫一次强制录入`
        : `⚠ Duplicate: ${sku} scanned ${secs}s ago — scan again to force`;
      setDupToast(msg);
      forceScan.current = true;
      if (dupTimer.current) clearTimeout(dupTimer.current);
      dupTimer.current = setTimeout(() => { setDupToast(null); forceScan.current = false; }, 8000);
      return true;
    }
    forceScan.current = false;
    recentScans.current = [...recentScans.current.filter(r => now - r.ts < 30000), { sku, ts: now }];
    return false;
  }, [lang]);

  // ── Core scan handler ─────────────────────────────────────────────────
  const handleScan = useCallback(async (raw: string) => {
    const barcode = raw.trim();
    if (!barcode) return;
    setInputVal("");

    // STOCKTAKE: silent accumulate, no lookup needed
    if (workflowMode === "STOCKTAKE") {
      setScanFlash(true);
      setTimeout(() => setScanFlash(false), 400);
      setStocktakeMap(prev => {
        const next = new Map(prev);
        next.set(barcode, (next.get(barcode) ?? 0) + 1);
        return next;
      });
      setStocktakeRows(prev => {
        const existing = prev.find(r => r.sku === barcode);
        const newCount = (existing?.scanned ?? 0) + 1;
        if (existing) {
          return prev.map(r => r.sku === barcode
            ? { ...r, scanned: newCount, diff: r.dbStock != null ? newCount - r.dbStock : null }
            : r
          );
        }
        return [{ sku: barcode, scanned: newCount, dbStock: null, diff: null, loading: false }, ...prev];
      });
      setTimeout(focusInput, 50);
      return;
    }

    // Duplicate detection for all other modes
    if (checkDuplicate(barcode)) {
      setTimeout(focusInput, 50);
      return;
    }

    setLookupLoading(true);
    setLookupResult(null);
    try {
      const res  = await fetch(`/api/scanner/lookup?barcode=${encodeURIComponent(barcode)}`);
      const data: LookupResult = await res.json();
      setLookupResult(data);
      if (data.found) {
        // Set defaults based on workflow mode
        const defaultType: MovementType =
          workflowMode === "RECEIVING" ? "IN_PURCHASE" :
          workflowMode === "PICKING"   ? "OUT_SALES"   : "IN_PURCHASE";
        const defaultRef =
          workflowMode === "RECEIVING" ? poReference :
          workflowMode === "PICKING"   ? orderReference : "";
        setConfirmType(defaultType);
        setConfirmQty("1");
        setConfirmRef(defaultRef);
        setConfirmNotes("");
        setSubmitError(null);
        setShowModal(true);
      } else {
        showToast(lang === "zh" ? `未识别: ${barcode}` : `Unknown barcode: ${barcode}`, "error");
      }
    } catch {
      showToast(lang === "zh" ? "查询失败，请重试" : "Lookup failed, please retry", "error");
    } finally {
      setLookupLoading(false);
      setTimeout(focusInput, 100);
    }
  }, [workflowMode, poReference, orderReference, lang, checkDuplicate, focusInput, showToast]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") void handleScan(inputVal);
  };

  // ── Confirm movement ──────────────────────────────────────────────────
  const handleConfirm = async () => {
    if (!lookupResult?.sku) return;
    const qty = Number(confirmQty);
    if (!Number.isInteger(qty) || qty === 0) {
      setSubmitError(lang === "zh" ? "数量必须是非零整数" : "Qty must be a non-zero integer");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/inout/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: lookupResult.sku, movement_type: confirmType, qty,
          reference_no: confirmRef || null, notes: confirmNotes || null,
          movement_date: new Date().toISOString().slice(0, 10),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");

      // RECEIVING: update session
      if (workflowMode === "RECEIVING" && poReference) {
        const srRes = await fetch("/api/scanner/sessions/receiving", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId, po_reference: poReference,
            sku: lookupResult.sku, qty: Math.abs(qty), movement_id: data.data?.id,
          }),
        });
        const srData = await srRes.json();
        if (srRes.ok) {
          setSessionId(srData.session_id);
          setSessionItems(srData.session_items ?? []);
        }
      }

      // PICKING: update local pick list
      if (workflowMode === "PICKING") {
        setPickList(prev => {
          const next = new Map(prev);
          next.set(lookupResult.sku!, (next.get(lookupResult.sku!) ?? 0) + Math.abs(qty));
          return next;
        });
      }

      setShowModal(false);
      setLookupResult(null);
      showToast(
        lang === "zh"
          ? `✓ 已记录 ${lookupResult.sku}  ${qty > 0 ? "+" : ""}${qty}`
          : `✓ Recorded ${lookupResult.sku}  ${qty > 0 ? "+" : ""}${qty}`,
        "success"
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
      setTimeout(focusInput, 150);
    }
  };

  const closeModal = () => { setShowModal(false); setLookupResult(null); setTimeout(focusInput, 100); };

  // ── Stocktake: End count → load DB stock → show diff ──────────────────
  const handleEndCount = async () => {
    const skus = Array.from(stocktakeMap.keys());
    if (skus.length === 0) return;
    const rows: StocktakeRow[] = skus.map(sku => ({
      sku, scanned: stocktakeMap.get(sku) ?? 0, dbStock: null, diff: null, loading: true,
    }));
    setDiffRows(rows);
    setSelectedDiffs(new Set(skus));
    setShowDiffModal(true);

    // Fetch DB stock for each SKU
    const results = await Promise.allSettled(
      skus.map(sku => fetch(`/api/scanner/lookup?barcode=${encodeURIComponent(sku)}`).then(r => r.json()))
    );
    setDiffRows(prev => prev.map((row, i) => {
      const res = results[i];
      if (res.status === "fulfilled" && res.value.found) {
        const dbStock = res.value.currentStock ?? 0;
        return { ...row, dbStock, diff: row.scanned - dbStock, loading: false };
      }
      return { ...row, dbStock: null, diff: null, loading: false };
    }));
  };

  // ── Stocktake: Approve selected diffs ────────────────────────────────
  const handleApproveSelected = async () => {
    setApprovingDiff(true);
    const toApprove = diffRows.filter(r => selectedDiffs.has(r.sku) && r.diff !== null && r.diff !== 0);
    try {
      await Promise.all(toApprove.map(row =>
        fetch("/api/inout/movements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sku: row.sku, movement_type: "ADJUSTMENT", qty: row.diff,
            notes: `Stocktake ${new Date().toISOString().slice(0, 10)}`,
            movement_date: new Date().toISOString().slice(0, 10),
          }),
        })
      ));
      showToast(
        lang === "zh"
          ? `✓ 已审批 ${toApprove.length} 个调整`
          : `✓ Approved ${toApprove.length} adjustments`,
        "success"
      );
      setShowDiffModal(false);
      setStocktakeMap(new Map());
      setStocktakeRows([]);
    } catch {
      showToast(lang === "zh" ? "审批失败，请重试" : "Approval failed, please retry", "error");
    } finally {
      setApprovingDiff(false);
    }
  };

  // ── Session summary ────────────────────────────────────────────────────
  const handleSummary = async () => {
    setSummaryOpen(true);
    setSummaryLoading(true);
    setSummaryReport(null);
    setSummaryError(null);
    try {
      const res  = await fetch("/api/scanner/session-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: summaryDate, lang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setSummaryReport(data.report);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSummaryLoading(false);
    }
  };

  // ── Mode switch: reset workflow state ─────────────────────────────────
  const switchMode = (m: WorkflowMode) => {
    setWorkflowMode(m);
    setLookupResult(null);
    setShowModal(false);
    setInputVal("");
    setTimeout(focusInput, 100);
  };

  // ── Stock warning (derived) ───────────────────────────────────────────
  const stockWarning = lookupResult?.found
    ? getStockWarning(lookupResult.currentStock, Number(confirmQty), confirmType, lang)
    : { level: null, msg: "" };

  // ── Locked type for workflow modes ────────────────────────────────────
  const isTypeLocked = workflowMode === "RECEIVING" || workflowMode === "PICKING";

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 pb-16" onClick={focusInput}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <section className={`${CARD} px-5 py-4`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.15em] text-slate-400">
              {lang === "zh" ? "扫码站" : "Scanner Station"}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-100">
              {lang === "zh" ? "实时扫码入出库" : "Live Barcode Scanning"}
            </h1>

            {/* Live session counter */}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span>{lang === "zh" ? "今日：" : "Today:"}</span>
              <span className="text-slate-200 font-medium">{todayScans} {lang === "zh" ? "条" : "scans"}</span>
              <span className="text-emerald-300">+{todayIn} {lang === "zh" ? "入" : "in"}</span>
              <span className="text-red-300">−{todayOut} {lang === "zh" ? "出" : "out"}</span>
            </div>
          </div>

          {/* Right: summary controls + realtime pill */}
          <div className="flex flex-wrap items-center gap-3">
            <input type="date" value={summaryDate}
              onChange={e => setSummaryDate(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-cyan-400" />
            <button type="button" onClick={() => void handleSummary()}
              className="rounded-xl border border-violet-400/40 bg-violet-500/15 px-4 py-2 text-sm font-medium text-violet-200 hover:bg-violet-500/25 transition-colors">
              {lang === "zh" ? "班次总结" : "Shift Summary"}
            </button>
            <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5">
              <span className={`h-2 w-2 rounded-full ${
                realtimeStatus === "live"  ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] animate-pulse" :
                realtimeStatus === "error" ? "bg-red-400" : "bg-amber-400 animate-pulse"}`} />
              <span className="text-xs text-slate-300">
                {realtimeStatus === "live"  ? (lang === "zh" ? "实时" : "LIVE") :
                 realtimeStatus === "error" ? (lang === "zh" ? "连接失败" : "ERROR") :
                 (lang === "zh" ? "连接中" : "…")}
              </span>
            </div>
          </div>
        </div>

        {/* ── Workflow mode tabs ─────────────────────────────────────────── */}
        <div className="mt-4 flex flex-wrap gap-2">
          <ModeTab mode="STANDARD"  active={workflowMode === "STANDARD"}  icon="📦"
            label={lang === "zh" ? "标准模式" : "Standard"}  onClick={() => switchMode("STANDARD")} />
          <ModeTab mode="RECEIVING" active={workflowMode === "RECEIVING"} icon="🚚"
            label={lang === "zh" ? "收货模式" : "Receiving"} onClick={() => switchMode("RECEIVING")} />
          <ModeTab mode="STOCKTAKE" active={workflowMode === "STOCKTAKE"} icon="📋"
            label={lang === "zh" ? "盘点模式" : "Stocktake"} onClick={() => switchMode("STOCKTAKE")} />
          <ModeTab mode="PICKING"   active={workflowMode === "PICKING"}   icon="🛒"
            label={lang === "zh" ? "拣货模式" : "Picking"}   onClick={() => switchMode("PICKING")} />
        </div>
      </section>

      {/* ── Workflow reference inputs (RECEIVING / PICKING) ─────────────── */}
      {(workflowMode === "RECEIVING" || workflowMode === "PICKING") && (
        <section className={`${CARD} px-5 py-3`}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-slate-300">
              {workflowMode === "RECEIVING"
                ? (lang === "zh" ? "采购单号 PO：" : "PO Reference:")
                : (lang === "zh" ? "订单号：" : "Order Reference:")}
            </span>
            <input
              value={workflowMode === "RECEIVING" ? poReference : orderReference}
              onChange={e => workflowMode === "RECEIVING" ? setPoReference(e.target.value) : setOrderReference(e.target.value)}
              placeholder={workflowMode === "RECEIVING"
                ? (lang === "zh" ? "输入或扫描采购单号…" : "Type or scan PO number…")
                : (lang === "zh" ? "输入或扫描订单号…" : "Type or scan order number…")}
              className="w-64 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400"
            />
            {workflowMode === "RECEIVING" && !poReference && (
              <span className="text-xs text-amber-400">
                {lang === "zh" ? "⚠ 请先输入采购单号再开始扫码" : "⚠ Enter PO number before scanning"}
              </span>
            )}
            {workflowMode === "PICKING" && !orderReference && (
              <span className="text-xs text-amber-400">
                {lang === "zh" ? "⚠ 请先输入订单号再开始扫码" : "⚠ Enter order number before scanning"}
              </span>
            )}
          </div>
        </section>
      )}

      {/* ── Scan area ────────────────────────────────────────────────────── */}
      <div className={`grid gap-4 ${
        (workflowMode === "RECEIVING" && sessionItems.length > 0) ||
        (workflowMode === "PICKING"   && pickList.size > 0) ||
        (workflowMode === "STOCKTAKE" && stocktakeRows.length > 0)
          ? "lg:grid-cols-[1fr_360px]" : "grid-cols-1"
      }`}>

        {/* Scan zone */}
        <section className={`${CARD} flex flex-col items-center justify-center gap-4 p-6`}>
          <div
            className={`relative flex w-full max-w-xl flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-8 transition-all duration-300 ${
              scanFlash        ? "border-emerald-400 bg-emerald-500/10" :
              isActive         ? "border-cyan-400/70 bg-cyan-500/5" :
              workflowMode === "RECEIVING" ? "border-emerald-400/30" :
              workflowMode === "STOCKTAKE" ? "border-amber-400/30"   :
              workflowMode === "PICKING"   ? "border-red-400/30"     :
              "border-slate-700 bg-slate-950/50"
            }`}
            onClick={e => { e.stopPropagation(); focusInput(); }}
          >
            <div className={`text-5xl ${lookupLoading ? "animate-pulse opacity-30" : ""}`}>
              {workflowMode === "RECEIVING" ? "🚚" :
               workflowMode === "STOCKTAKE" ? "📋" :
               workflowMode === "PICKING"   ? "🛒" : "📦"}
            </div>

            <p className="text-center text-sm text-slate-400">
              {lookupLoading
                ? (lang === "zh" ? "正在查询…" : "Looking up…")
                : workflowMode === "STOCKTAKE"
                ? (lang === "zh" ? "扫码后自动计数，无需确认" : "Scans count silently — no confirmation needed")
                : (lang === "zh" ? "对准此处扫描，或手动输入条码 / SKU" : "Point scanner here or type barcode / SKU")}
            </p>

            <input
              ref={inputRef}
              type="text"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={handleInputKeyDown}
              onFocus={() => setIsActive(true)}
              onBlur={() => setIsActive(false)}
              placeholder={lang === "zh" ? "条码 / SKU …" : "Barcode / SKU …"}
              className="w-full max-w-sm rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-center text-base font-mono text-slate-100 outline-none focus:border-cyan-400 placeholder:text-slate-600"
              autoComplete="off" autoCorrect="off" spellCheck={false}
            />

            <button type="button"
              onClick={e => { e.stopPropagation(); void handleScan(inputVal); }}
              disabled={!inputVal.trim() || lookupLoading}
              className="rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-5 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40 transition-colors">
              {lang === "zh" ? "确认查询" : "Look Up"}
            </button>
          </div>

          {/* Stocktake count + end button */}
          {workflowMode === "STOCKTAKE" && (
            <div className="flex w-full max-w-xl items-center justify-between rounded-xl border border-amber-400/20 bg-amber-500/5 px-4 py-2">
              <span className="text-sm text-amber-200">
                {lang === "zh"
                  ? `已扫 ${stocktakeMap.size} 个 SKU，共 ${Array.from(stocktakeMap.values()).reduce((s, v) => s + v, 0)} 件`
                  : `${stocktakeMap.size} SKUs scanned, ${Array.from(stocktakeMap.values()).reduce((s, v) => s + v, 0)} units total`}
              </span>
              <button type="button"
                disabled={stocktakeMap.size === 0}
                onClick={() => void handleEndCount()}
                className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/25 disabled:opacity-40 transition-colors">
                {lang === "zh" ? "结束盘点 →" : "End Count →"}
              </button>
            </div>
          )}
        </section>

        {/* ── Side panel: session / pick / stocktake live list ──────────── */}
        {workflowMode === "RECEIVING" && sessionItems.length > 0 && (
          <aside className={`${CARD} p-4`}>
            <p className="mb-3 text-xs uppercase tracking-[0.12em] text-slate-400">
              {lang === "zh" ? "本次收货清单" : "This Receiving Session"}
            </p>
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
              {sessionItems.map(item => {
                const over = item.scanned_qty > 500;
                return (
                  <div key={item.sku} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                    over ? "border-red-400/30 bg-red-500/10" : "border-slate-800 bg-slate-900/50"}`}>
                    <span className="font-medium text-slate-100 truncate">{item.sku}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="tabular-nums text-emerald-300">+{item.scanned_qty}</span>
                      {over && <span className="text-xs text-red-300">{lang === "zh" ? "超量" : "High"}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        {workflowMode === "PICKING" && pickList.size > 0 && (
          <aside className={`${CARD} p-4`}>
            <p className="mb-3 text-xs uppercase tracking-[0.12em] text-slate-400">
              {lang === "zh" ? "本次拣货清单" : "Pick List"}
            </p>
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
              {Array.from(pickList.entries()).map(([sku, qty]) => (
                <div key={sku} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-100 truncate">{sku}</span>
                  <span className="tabular-nums text-red-300 shrink-0">−{qty}</span>
                </div>
              ))}
            </div>
            {orderReference && (
              <p className="mt-3 text-xs text-slate-500">
                {lang === "zh" ? "订单：" : "Order: "}{orderReference}
              </p>
            )}
          </aside>
        )}

        {workflowMode === "STOCKTAKE" && stocktakeRows.length > 0 && (
          <aside className={`${CARD} p-4`}>
            <p className="mb-3 text-xs uppercase tracking-[0.12em] text-slate-400">
              {lang === "zh" ? "盘点计数" : "Count Progress"}
            </p>
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
              {stocktakeRows.slice(0, 20).map(row => (
                <div key={row.sku} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-100 truncate">{row.sku}</span>
                  <span className="tabular-nums text-amber-300 shrink-0">×{row.scanned}</span>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>

      {/* ── Live activity feed ──────────────────────────────────────────── */}
      <section className={`${CARD} p-4`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">
            {lang === "zh" ? "实时流水" : "Live Activity Feed"}
          </h2>
          <button type="button" onClick={() => void loadFeed()}
            className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors">
            {lang === "zh" ? "刷新" : "Refresh"}
          </button>
        </div>
        {feedLoading ? (
          <div className="space-y-2 animate-pulse">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 rounded-xl border border-slate-800 bg-slate-800/40" />
            ))}
          </div>
        ) : feed.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            {lang === "zh" ? "暂无记录，扫码后将在此实时显示" : "No records yet — scans appear here in real time"}
          </p>
        ) : (
          <div className="space-y-1.5">
            {feed.map(e => <FeedRow key={e.id} entry={e} lang={lang} />)}
          </div>
        )}
      </section>

      {/* ── Confirm Modal ───────────────────────────────────────────────── */}
      {showModal && lookupResult?.found && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4" onClick={closeModal}>
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-start justify-between border-b border-slate-800 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.1em] text-slate-400">
                  {lang === "zh" ? "扫码结果" : "Scan Result"}
                </p>
                <h3 className="mt-0.5 text-xl font-bold text-slate-100">{lookupResult.sku}</h3>
                {lookupResult.label && lookupResult.label !== lookupResult.sku && (
                  <p className="text-sm text-slate-400">{lookupResult.label}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2">
                  <span className="text-xs text-slate-400">{lang === "zh" ? "当前库存" : "Stock"}</span>
                  <span className="text-lg font-bold text-emerald-300">
                    {lookupResult.currentStock != null ? lookupResult.currentStock.toLocaleString() : "—"}
                  </span>
                </div>
                {workflowMode === "RECEIVING" && poReference && (
                  <span className="text-xs text-slate-500">PO: {poReference}</span>
                )}
                {workflowMode === "PICKING" && orderReference && (
                  <span className="text-xs text-slate-500">{lang === "zh" ? "订单：" : "Order: "}{orderReference}</span>
                )}
              </div>
            </div>

            {/* Recent movements mini-list */}
            {lookupResult.recentMovements && lookupResult.recentMovements.length > 0 && (
              <div className="border-b border-slate-800 px-6 py-3">
                <p className="mb-2 text-xs uppercase tracking-[0.1em] text-slate-500">
                  {lang === "zh" ? "最近动态" : "Recent Activity"}
                </p>
                <div className="space-y-1">
                  {lookupResult.recentMovements.slice(0, 3).map(m => {
                    const meta = TYPE_META[m.movement_type];
                    const isIn  = m.movement_type === "IN_PURCHASE" || m.movement_type === "IN_RETURN";
                    const isOut = m.movement_type === "OUT_SALES"   || m.movement_type === "OUT_DAMAGED";
                    return (
                      <div key={m.id} className="flex items-center gap-2 text-xs text-slate-400">
                        <span className={`inline-flex rounded border px-1.5 py-0.5 ${meta.bgClass} ${meta.colorClass}`}>
                          {lang === "zh" ? meta.labelZh : meta.labelEn}
                        </span>
                        <span className={`font-medium tabular-nums ${isIn ? "text-emerald-300" : isOut ? "text-red-300" : "text-amber-300"}`}>
                          {meta.sign}{Math.abs(m.qty)}
                        </span>
                        <span>{m.movement_date}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Stock warning */}
            {stockWarning.level && (
              <div className={`mx-6 mt-3 rounded-xl border px-3 py-2 text-sm ${
                stockWarning.level === "red"
                  ? "border-red-400/40 bg-red-500/15 text-red-200"
                  : "border-amber-400/40 bg-amber-500/15 text-amber-200"
              }`}>
                {stockWarning.msg}
              </div>
            )}

            {/* Form */}
            <div className="space-y-3 px-6 py-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm text-slate-300">
                  {lang === "zh" ? "类型" : "Type"} <span className="text-red-400">*</span>
                  <select value={confirmType}
                    onChange={e => setConfirmType(e.target.value as MovementType)}
                    disabled={isTypeLocked}
                    className={`mt-1 ${INPUT_CLS} ${isTypeLocked ? "opacity-60 cursor-not-allowed" : ""}`}>
                    {(Object.keys(TYPE_META) as MovementType[]).map(t => (
                      <option key={t} value={t}>{lang === "zh" ? TYPE_META[t].labelZh : TYPE_META[t].labelEn}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-slate-300">
                  {lang === "zh" ? "数量" : "Qty"} <span className="text-red-400">*</span>
                  <input type="number" value={confirmQty}
                    onChange={e => setConfirmQty(e.target.value)}
                    autoFocus className={`mt-1 ${INPUT_CLS}`} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm text-slate-300">
                  {lang === "zh" ? "参考号" : "Reference No."}
                  <input value={confirmRef} onChange={e => setConfirmRef(e.target.value)}
                    placeholder={workflowMode === "RECEIVING" ? poReference || "PO" : workflowMode === "PICKING" ? orderReference || "Order" : (lang === "zh" ? "可选" : "Optional")}
                    disabled={isTypeLocked && !!confirmRef}
                    className={`mt-1 ${INPUT_CLS}`} />
                </label>
                <label className="block text-sm text-slate-300">
                  {lang === "zh" ? "备注" : "Notes"}
                  <input value={confirmNotes} onChange={e => setConfirmNotes(e.target.value)}
                    placeholder={lang === "zh" ? "可选" : "Optional"}
                    className={`mt-1 ${INPUT_CLS}`} />
                </label>
              </div>
            </div>

            {submitError && (
              <p className="mx-6 mb-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {submitError}
              </p>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-800 px-6 py-4">
              <button type="button" onClick={closeModal}
                className="rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors">
                {lang === "zh" ? "取消" : "Cancel"}
              </button>
              <button type="button" onClick={() => void handleConfirm()} disabled={submitting}
                className="rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-5 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-60 transition-colors">
                {submitting ? (lang === "zh" ? "保存中…" : "Saving…") : (lang === "zh" ? "✓ 确认记录" : "✓ Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Stocktake Diff Modal ─────────────────────────────────────────── */}
      {showDiffModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.1em] text-slate-400">
                  {lang === "zh" ? "盘点差异" : "Stocktake Discrepancies"}
                </p>
                <h3 className="mt-0.5 text-lg font-semibold text-slate-100">
                  {lang === "zh" ? "审核并批准调整" : "Review & Approve Adjustments"}
                </h3>
              </div>
              <button type="button" onClick={() => setShowDiffModal(false)}
                disabled={approvingDiff}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800 disabled:opacity-40">
                {lang === "zh" ? "放弃" : "Discard"}
              </button>
            </div>

            <div className="max-h-[50vh] overflow-y-auto px-6 py-4">
              {/* Select all */}
              <div className="mb-3 flex items-center gap-2">
                <input type="checkbox" id="select-all"
                  checked={selectedDiffs.size === diffRows.filter(r => r.diff !== 0 && r.diff !== null).length}
                  onChange={e => {
                    if (e.target.checked) setSelectedDiffs(new Set(diffRows.filter(r => r.diff !== 0).map(r => r.sku)));
                    else setSelectedDiffs(new Set());
                  }}
                  className="accent-cyan-400" />
                <label htmlFor="select-all" className="text-xs text-slate-400">
                  {lang === "zh" ? "全选差异项" : "Select all with discrepancies"}
                </label>
              </div>

              <div className="overflow-auto rounded-xl border border-slate-800">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-900/95 text-xs uppercase tracking-[0.08em] text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-left w-8"></th>
                      <th className="px-3 py-2 text-left">SKU</th>
                      <th className="px-3 py-2 text-right">{lang === "zh" ? "盘点" : "Counted"}</th>
                      <th className="px-3 py-2 text-right">{lang === "zh" ? "系统库存" : "DB Stock"}</th>
                      <th className="px-3 py-2 text-right">{lang === "zh" ? "差异" : "Diff"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffRows.map(row => {
                      const hasDiff = row.diff !== 0 && row.diff !== null;
                      return (
                        <tr key={row.sku} className="border-t border-slate-800 text-slate-200">
                          <td className="px-3 py-2">
                            {hasDiff && !row.loading && (
                              <input type="checkbox"
                                checked={selectedDiffs.has(row.sku)}
                                onChange={e => {
                                  setSelectedDiffs(prev => {
                                    const next = new Set(prev);
                                    e.target.checked ? next.add(row.sku) : next.delete(row.sku);
                                    return next;
                                  });
                                }}
                                className="accent-cyan-400" />
                            )}
                          </td>
                          <td className="px-3 py-2 font-medium">{row.sku}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.scanned}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                            {row.loading ? "…" : row.dbStock ?? "—"}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                            row.loading ? "text-slate-500" :
                            row.diff === 0 ? "text-slate-500" :
                            (row.diff ?? 0) > 0 ? "text-emerald-300" : "text-red-300"
                          }`}>
                            {row.loading ? "…" : row.diff === null ? "—" : row.diff === 0 ? "✓" : `${(row.diff ?? 0) > 0 ? "+" : ""}${row.diff}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-800 px-6 py-4">
              <span className="text-xs text-slate-400">
                {lang === "zh"
                  ? `已选 ${selectedDiffs.size} 项将创建调整记录`
                  : `${selectedDiffs.size} adjustments will be created`}
              </span>
              <button type="button" onClick={() => void handleApproveSelected()}
                disabled={selectedDiffs.size === 0 || approvingDiff}
                className="rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-5 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-50 transition-colors">
                {approvingDiff ? (lang === "zh" ? "提交中…" : "Submitting…") : (lang === "zh" ? "✓ 批准选中" : "✓ Approve Selected")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Session Summary Modal ────────────────────────────────────────── */}
      {summaryOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4"
          onClick={() => { if (!summaryLoading) setSummaryOpen(false); }}>
          <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.1em] text-slate-400">
                  {lang === "zh" ? "AI 班次总结" : "AI Shift Summary"}
                </p>
                <h3 className="mt-0.5 text-lg font-semibold text-slate-100">{summaryDate}</h3>
              </div>
              {!summaryLoading && (
                <button type="button" onClick={() => setSummaryOpen(false)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors">
                  {lang === "zh" ? "关闭" : "Close"}
                </button>
              )}
            </div>
            <div className="max-h-[65vh] overflow-y-auto px-6 py-5">
              {summaryLoading ? (
                <div className="flex flex-col items-center gap-4 py-12">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-violet-400" />
                  <p className="text-sm text-slate-400">
                    {lang === "zh" ? "AI 正在分析并校对报告…" : "AI is drafting and refining the report…"}
                  </p>
                </div>
              ) : summaryError ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {summaryError}
                </div>
              ) : summaryReport ? (
                <div className="prose prose-invert prose-sm max-w-none text-slate-200 leading-relaxed"
                  dangerouslySetInnerHTML={{
                    __html: summaryReport
                      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                      .replace(/\n/g, "<br />"),
                  }} />
              ) : null}
            </div>
            {!summaryLoading && summaryReport && (
              <div className="flex justify-end border-t border-slate-800 px-6 py-3">
                <button type="button" onClick={() => void handleSummary()}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors">
                  {lang === "zh" ? "重新生成" : "Regenerate"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Duplicate scan toast ─────────────────────────────────────────── */}
      {dupToast && (
        <div className="fixed bottom-16 left-1/2 z-[60] -translate-x-1/2 rounded-xl border border-amber-400/40 bg-amber-500/20 px-5 py-3 text-sm font-medium text-amber-200 shadow-xl">
          {dupToast}
        </div>
      )}

      {/* ── Success / error toast ────────────────────────────────────────── */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl border px-5 py-3 text-sm font-medium shadow-xl ${
          toast.type === "success"
            ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-200"
            : "border-red-400/40 bg-red-500/20 text-red-200"
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
