"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useLanguage } from "@/components/LanguageProvider";

export default function LoginPage() {
  const router = useRouter();
  const { lang } = useLanguage();
  const [name, setName] = useState("Inventory User");
  const [email, setEmail] = useState("user@example.com");

  const handleMockLogin = () => {
    if (typeof window === "undefined") return;

    localStorage.setItem(
      "ii:mock-user",
      JSON.stringify({
        name: name.trim() || "Inventory User",
        email: email.trim() || undefined,
      })
    );

    router.push("/profile");
  };

  return (
    <section className="max-w-xl space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4">
      <p className="text-xs uppercase tracking-[0.15em] text-slate-400">
        {lang === "zh" ? "登录" : "Login"}
      </p>
      <h1 className="text-2xl font-semibold text-slate-100">{lang === "zh" ? "登录" : "Login"}</h1>
      <p className="text-sm text-slate-400">
        {lang === "zh"
          ? "登录占位页，后续可接入真实认证。"
          : "Placeholder login page. Existing auth can be wired in here later."}
      </p>

      <div className="space-y-3">
        <label className="block text-sm text-slate-300">
          {lang === "zh" ? "姓名" : "Name"}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
        </label>

        <label className="block text-sm text-slate-300">
          Email
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={handleMockLogin}
        className="inline-flex rounded-md border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/20"
      >
        {lang === "zh" ? "继续（模拟登录）" : "Continue (mock)"}
      </button>
    </section>
  );
}
