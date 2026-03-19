"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type ProfileForm = {
  name: string;
  phone: string;
  title: string;
  email: string;
};

const EMPTY_FORM: ProfileForm = {
  name: "",
  phone: "",
  title: "",
  email: "",
};

export default function ProfilePage() {
  const router = useRouter();
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);

  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    setSupabase(createBrowserSupabaseClient());
  }, []);

  useEffect(() => {
    if (!supabase) return;

    let active = true;

    const load = async () => {
      setLoading(true);
      setErrorMessage("");
      setSuccessMessage("");

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (!active) return;

      if (userError || !user) {
        router.replace("/auth");
        return;
      }

      setUserId(user.id);

      const { data: profile, error: profileError } = await supabase
        .from("user_profiles")
        .select("name, phone, title, email")
        .eq("id", user.id)
        .maybeSingle();

      if (!active) return;

      if (profileError) {
        setErrorMessage(`读取个人资料失败：${profileError.message}`);
        setForm((prev) => ({ ...prev, email: user.email ?? "" }));
        setLoading(false);
        return;
      }

      setForm({
        name: profile?.name ?? "",
        phone: profile?.phone ?? "",
        title: profile?.title ?? "",
        email: user.email ?? profile?.email ?? "",
      });
      setLoading(false);
    };

    load();

    return () => {
      active = false;
    };
  }, [router, supabase]);

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !userId) return;

    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

    if (!supabase) {
      setErrorMessage("认证服务初始化中，请稍后重试。");
      return;
    }

    const payload = {
      id: userId,
      email: form.email.trim() || null,
      name: form.name.trim() || null,
      phone: form.phone.trim() || null,
      title: form.title.trim() || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("user_profiles").upsert(payload, { onConflict: "id" });

    if (error) {
      setErrorMessage(`保存失败：${error.message}`);
      setSaving(false);
      return;
    }

    setSuccessMessage("个人资料已保存。");
    setSaving(false);
  };

  const handleSignOut = async () => {
    setErrorMessage("");
    setSuccessMessage("");

    if (!supabase) {
      setErrorMessage("认证服务初始化中，请稍后重试。");
      return;
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMessage(`退出登录失败：${error.message}`);
      return;
    }

    router.replace("/auth");
    router.refresh();
  };

  return (
    <section className="mx-auto w-full max-w-3xl py-2">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.15em] text-slate-400">Personal Center</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-100">个人中心</h1>
            <p className="mt-2 text-sm text-slate-400">管理账户资料，更新后将写入 Supabase。</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-100 transition hover:border-slate-400 hover:bg-slate-800"
          >
            退出登录
          </button>
        </div>

        {loading ? (
          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-6 text-sm text-slate-300">
            正在加载个人资料...
          </div>
        ) : (
          <form onSubmit={handleSave} className="mt-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm text-slate-300">
                姓名
                <input
                  type="text"
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition focus:border-cyan-400"
                />
              </label>

              <label className="block text-sm text-slate-300">
                手机
                <input
                  type="text"
                  value={form.phone}
                  onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition focus:border-cyan-400"
                />
              </label>

              <label className="block text-sm text-slate-300">
                职位
                <input
                  type="text"
                  value={form.title}
                  onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition focus:border-cyan-400"
                />
              </label>

              <label className="block text-sm text-slate-300">
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition focus:border-cyan-400"
                />
              </label>
            </div>

            {errorMessage && (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {errorMessage}
              </p>
            )}
            {successMessage && (
              <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                {successMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="inline-flex rounded-xl border border-cyan-300/50 bg-cyan-500/15 px-5 py-2.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "保存中..." : "保存资料"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
