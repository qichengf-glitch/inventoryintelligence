"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

type NavItem = {
  label: { zh: string; en: string };
  href: string;
  icon: string;
};

const NAV_ITEMS: NavItem[] = [
  { label: { zh: "首页", en: "Home" }, href: "/", icon: "🏠" },
  { label: { zh: "数据中心", en: "Data Center" }, href: "/data-center", icon: "🌐" },
  { label: { zh: "分析", en: "Analysis" }, href: "/analysis", icon: "🖲️" },
  { label: { zh: "精益策略", en: "Lean Strategy" }, href: "/lean-strategy", icon: "🚥" },
  { label: { zh: "出入库管理", en: "In/Out" }, href: "/inout", icon: "🚚" },
  { label: { zh: "设置", en: "Settings" }, href: "/settings", icon: "⚙️" },
];

function matchesRoute(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/" || pathname === "/home";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { lang, toggleLang } = useLanguage();
  const [collapsed, setCollapsed] = useState(false);
  const text = {
    language: lang === "zh" ? "语言" : "Language",
    account: lang === "zh" ? "账户" : "Account",
    loginProfile: lang === "zh" ? "登录 / 个人中心" : "Login / Profile",
    expand: lang === "zh" ? "展开" : "Expand",
    collapse: lang === "zh" ? "收起" : "Collapse",
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const saved = localStorage.getItem("ii:sidebar:collapsed");
    if (saved === "1") {
      setCollapsed(true);
    }
  }, [pathname]);

  const containerWidth = useMemo(() => {
    return collapsed ? "w-[88px]" : "w-[258px]";
  }, [collapsed]);

  const handleToggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        localStorage.setItem("ii:sidebar:collapsed", next ? "1" : "0");
      }
      return next;
    });
  };

  const handleProfileClick = () => {
    const currentLoginState =
      typeof window !== "undefined" && Boolean(localStorage.getItem("ii:mock-user"));
    router.push(currentLoginState ? "/profile" : "/login");
  };

  return (
    <aside
      className={`sticky top-0 h-screen shrink-0 border-r border-slate-800 bg-slate-950/95 backdrop-blur ${containerWidth}`}
    >
      <div className="flex h-full flex-col px-3 py-4">
        <div className="mb-6 flex items-start justify-between gap-2">
          <div className={`${collapsed ? "sr-only" : "block"}`}>
            <p className="text-lg font-bold italic uppercase leading-tight tracking-[0.12em] text-blue-400">
              Inventory
              <br />
              Intelligence
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggle}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-700 text-slate-300 transition hover:border-slate-500 hover:text-white"
            aria-label={collapsed ? text.expand : text.collapse}
            title={collapsed ? text.expand : text.collapse}
          >
            {collapsed ? "→" : "←"}
          </button>
        </div>

        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = matchesRoute(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                  active
                    ? "border border-cyan-400/40 bg-cyan-500/15 text-cyan-200"
                    : "border border-transparent text-slate-300 hover:border-slate-700 hover:bg-slate-900 hover:text-white"
                }`}
              >
                <span
                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold tracking-wide ${
                    active
                      ? "border-cyan-300/60 bg-cyan-300/20 text-cyan-100"
                      : "border-slate-700 bg-slate-900 text-slate-300 group-hover:border-slate-500"
                  }`}
                >
                  {item.icon}
                </span>
                {!collapsed && <span className="truncate">{item.label[lang]}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={toggleLang}
            className={`mb-2 flex w-full items-center rounded-xl border border-slate-700 bg-slate-900 text-left transition hover:border-slate-500 hover:bg-slate-800 ${
              collapsed ? "justify-center px-2 py-2" : "justify-between px-3 py-2"
            }`}
          >
            {collapsed ? (
              <span className="text-xs font-medium text-slate-100">
                {lang === "zh" ? "中/EN" : "EN/中"}
              </span>
            ) : (
              <>
                <span className="text-xs text-slate-400">{text.language}</span>
                <span className="text-sm font-medium text-slate-100">
                  {lang === "zh" ? "中文 / EN" : "EN / 中文"}
                </span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleProfileClick}
            className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-slate-900"
          >
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-slate-200">
              U
            </span>
            {!collapsed && (
              <span className="min-w-0">
                <span className="block truncate text-xs text-slate-400">{text.account}</span>
                <span className="block truncate text-sm text-slate-100">{text.loginProfile}</span>
              </span>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}
