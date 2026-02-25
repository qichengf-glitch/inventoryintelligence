"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";

type MockUser = {
  name: string;
  email?: string;
};

export default function ProfilePage() {
  const { lang } = useLanguage();
  const [user, setUser] = useState<MockUser | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const raw = localStorage.getItem("ii:mock-user");
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as MockUser;
      if (parsed?.name) {
        setUser(parsed);
      }
    } catch {
      setUser(null);
    }
  }, []);

  const handleLogout = () => {
    if (typeof window === "undefined") return;
    localStorage.removeItem("ii:mock-user");
    setUser(null);
  };

  return (
    <section className="max-w-2xl space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4">
      <p className="text-xs uppercase tracking-[0.15em] text-slate-400">
        {lang === "zh" ? "个人中心" : "Profile"}
      </p>
      <h1 className="text-2xl font-semibold text-slate-100">
        {lang === "zh" ? "个人中心" : "Profile"}
      </h1>
      {user ? (
        <>
          <p className="text-sm text-slate-300">{lang === "zh" ? "姓名" : "Name"}: {user.name}</p>
          {user.email && <p className="text-sm text-slate-300">Email: {user.email}</p>}
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            {lang === "zh" ? "退出登录（模拟）" : "Logout (mock)"}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-400">
            {lang === "zh" ? "当前未登录，请先登录。" : "No active session. Please sign in first."}
          </p>
          <Link
            href="/login"
            className="inline-flex rounded-md border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/20"
          >
            {lang === "zh" ? "前往登录" : "Go to login"}
          </Link>
        </>
      )}
    </section>
  );
}
