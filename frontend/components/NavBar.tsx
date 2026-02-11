// frontend/components/NavBar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import { strings } from "@/i18n/strings";
import { useTheme } from "./ThemeProvider";
import { useEffect, useState } from "react";

export default function NavBar() {
  const pathname = usePathname();
  const { lang, toggleLang } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const navLinks = [
    { href: "/", label: strings.navHome[lang] },
    { href: "/inventory", label: strings.navInventory[lang] },
    { href: "/dataset", label: strings.navDataset[lang] },
    // ✅ 新增 search 页面（你要的话）
    { href: "/search", label: lang === "zh" ? "库存搜索" : "Search" },
  ];

  return (
    <header className="w-full border-b bg-white/90 backdrop-blur dark:bg-slate-900 dark:border-slate-700">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="font-extrabold text-xl text-blue-700 italic tracking-wide dark:text-blue-300">
          Inventory Intelligence
        </div>

        <nav className="flex items-center gap-3 text-sm">
          {navLinks.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded-full border transition ${
                  active
                    ? "bg-blue-600 text-white border-blue-600 shadow"
                    : "bg-white text-slate-700 hover:bg-blue-50 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {link.label}
              </Link>
            );
          })}

          <button
            onClick={toggleLang}
            className="px-3 py-1.5 rounded-full border border-slate-300 text-xs text-slate-700 hover:bg-slate-100 transition dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700"
          >
            {lang === "zh" ? "中文 / EN" : "EN / 中文"}
          </button>

          {/* ✅ 主题切换：延迟到 mounted 后渲染，避免 hydration mismatch */}
          <button
            onClick={toggleTheme}
            className="px-3 py-1.5 rounded-full border border-slate-300 text-xs text-slate-700 hover:bg-slate-100 transition flex items-center gap-1 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700"
            suppressHydrationWarning
          >
            {!mounted ? (
              // mounted 前不要输出具体内容（或输出固定占位）
              <span className="opacity-70">Theme</span>
            ) : theme === "light" ? (
              <>
                <span>🌙</span>
                <span>Dark</span>
              </>
            ) : (
              <>
                <span>☀️</span>
                <span>Light</span>
              </>
            )}
          </button>
        </nav>
      </div>
    </header>
  );
}
