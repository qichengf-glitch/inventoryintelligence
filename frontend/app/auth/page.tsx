"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type AuthMode = "login" | "signup";

function normalizeAuthError(message: string) {
  const lowered = message.toLowerCase();
  if (lowered.includes("invalid login credentials")) {
    return "邮箱或密码错误，请检查后重试。";
  }
  if (lowered.includes("email not confirmed")) {
    return "邮箱尚未验证，请先完成邮箱验证。";
  }
  if (lowered.includes("user already registered")) {
    return "该邮箱已注册，请直接登录。";
  }
  if (lowered.includes("password should be at least")) {
    return "密码强度不足，请使用更长或更复杂的密码。";
  }
  return message;
}

function normalizeCallbackError(error: string | null, description: string | null) {
  const combined = `${error ?? ""} ${description ?? ""}`.toLowerCase();
  if (!combined.trim()) return "";
  if (combined.includes("otp_expired") || combined.includes("expired")) {
    return "验证链接已过期，请在登录页重新触发注册并使用最新邮件链接。";
  }
  if (combined.includes("access_denied")) {
    return "邮箱验证失败（access denied），请使用最新验证邮件重试。";
  }
  if (combined.includes("invalid")) {
    return "验证链接无效，请重新获取验证邮件。";
  }
  return description || error || "邮箱验证失败，请重试。";
}

type ProfileSeed = {
  id: string;
  email: string;
  name?: string;
};

function getEmailRedirectTo() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (siteUrl) return `${siteUrl}/auth/callback`;
  if (typeof window !== "undefined") return `${window.location.origin}/auth/callback`;
  return undefined;
}

export default function AuthPage() {
  const router = useRouter();
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);

  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [resendPending, setResendPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [profileWarning, setProfileWarning] = useState("");
  const [showResend, setShowResend] = useState(false);

  useEffect(() => {
    setSupabase(createBrowserSupabaseClient());
  }, []);

  const upsertProfile = async ({ id, email: profileEmail, name: profileName }: ProfileSeed) => {
    if (!supabase) {
      throw new Error("Supabase client is not ready yet.");
    }

    return supabase.from("user_profiles").upsert(
      {
        id,
        email: profileEmail,
        name: profileName?.trim() || null,
      },
      { onConflict: "id" }
    );
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const callbackError = normalizeCallbackError(
      params.get("error"),
      params.get("error_description")
    );
    if (callbackError) {
      setErrorMessage(callbackError);
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;

    let active = true;

    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (active && session) {
        router.replace("/home");
      }
    };

    checkSession();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        router.replace("/home");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setErrorMessage("");
    setSuccessMessage("");
    setProfileWarning("");

    if (!supabase) {
      setErrorMessage("认证服务初始化中，请稍后重试。");
      setPending(false);
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    try {
      if (mode === "signup") {
        const emailRedirectTo = getEmailRedirectTo();
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            ...(cleanName ? { data: { name: cleanName } } : {}),
            ...(emailRedirectTo ? { emailRedirectTo } : {}),
          },
        });

        if (error) {
          setErrorMessage(normalizeAuthError(error.message));
          return;
        }

        const user = data.user;
        if (user && data.session) {
          const { error: upsertError } = await upsertProfile({
            id: user.id,
            email: user.email ?? cleanEmail,
            name: cleanName || undefined,
          });

          if (upsertError) {
            setProfileWarning(
              `账号已创建，但个人资料初始化失败。你稍后可在个人中心重试保存。(${upsertError.message})`
            );
          }
        }

        if (data.session) {
          router.replace("/home");
          return;
        }

        setSuccessMessage("注册成功，请前往邮箱完成验证后登录。首次登录后将自动初始化个人资料。");
        setShowResend(true);
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        setErrorMessage(normalizeAuthError(error.message));
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { error: upsertError } = await upsertProfile({
          id: user.id,
          email: user.email ?? cleanEmail,
          name:
            typeof user.user_metadata?.name === "string"
              ? (user.user_metadata.name as string)
              : undefined,
        });
        if (upsertError) {
          // Do not block login on profile sync failure.
          console.warn("[auth] profile upsert after login failed:", upsertError.message);
        }
      }

      router.replace("/home");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "认证请求失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  };

  const handleResendVerification = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || resendPending) return;
    if (!supabase) {
      setErrorMessage("认证服务初始化中，请稍后重试。");
      return;
    }

    setResendPending(true);
    setErrorMessage("");

    try {
      const emailRedirectTo = getEmailRedirectTo();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: cleanEmail,
        options: emailRedirectTo ? { emailRedirectTo } : undefined,
      });

      if (error) {
        setErrorMessage(normalizeAuthError(error.message));
        setResendPending(false);
        return;
      }

      setSuccessMessage("验证邮件已重新发送，请检查收件箱/垃圾箱，并点击最新邮件链接。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "重发失败，请稍后重试。");
    } finally {
      setResendPending(false);
    }
  };

  return (
    <section className="mx-auto flex min-h-screen w-full max-w-lg items-center px-4 py-10">
      <div className="w-full rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-400">INVENTORY ACCESS</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-100">登录 / 注册</h1>
        <p className="mt-2 text-sm text-slate-400">使用邮箱账号访问 Inventory Intelligence。</p>

        <div className="mt-6 grid grid-cols-2 rounded-xl border border-slate-800 bg-slate-950 p-1">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setErrorMessage("");
              setSuccessMessage("");
              setProfileWarning("");
            }}
            className={`rounded-lg px-3 py-2 text-sm transition ${
              mode === "login"
                ? "bg-cyan-500/20 text-cyan-100"
                : "text-slate-300 hover:text-slate-100"
            }`}
          >
            登录
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setErrorMessage("");
              setSuccessMessage("");
              setProfileWarning("");
            }}
            className={`rounded-lg px-3 py-2 text-sm transition ${
              mode === "signup"
                ? "bg-cyan-500/20 text-cyan-100"
                : "text-slate-300 hover:text-slate-100"
            }`}
          >
            注册
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {mode === "signup" && (
            <label className="block text-sm text-slate-300">
              姓名（可选）
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：张三"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition focus:border-cyan-400"
              />
            </label>
          )}

          <label className="block text-sm text-slate-300">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition focus:border-cyan-400"
            />
          </label>

          <label className="block text-sm text-slate-300">
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition focus:border-cyan-400"
            />
          </label>

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
          {showResend && mode === "signup" && (
            <button
              type="button"
              onClick={handleResendVerification}
              disabled={resendPending}
              className="inline-flex w-full items-center justify-center rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resendPending ? "重发中..." : "重新发送验证邮件"}
            </button>
          )}
          {profileWarning && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {profileWarning}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="inline-flex w-full items-center justify-center rounded-xl border border-cyan-300/50 bg-cyan-500/15 px-4 py-2.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "处理中..." : mode === "login" ? "登录" : "注册"}
          </button>
        </form>
      </div>
    </section>
  );
}
