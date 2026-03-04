"use client";

import { useRouter } from "next/navigation";

export default function LandingPage() {
  const router = useRouter();

  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.14),transparent_42%),radial-gradient(circle_at_80%_72%,rgba(59,130,246,0.2),transparent_38%)]" />
      <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center text-center">
        <p className="text-5xl font-semibold uppercase tracking-[0.22em] text-slate-100 md:text-7xl">
          INVENTORY
        </p>
        <p className="mt-2 text-3xl font-semibold uppercase tracking-[0.26em] text-cyan-300 md:text-5xl">
          INTELLIGENCE
        </p>
        <button
          type="button"
          onClick={() => router.push("/auth")}
          className="mt-12 inline-flex items-center rounded-xl border border-cyan-300/50 bg-cyan-500/10 px-10 py-3 text-base font-semibold text-cyan-100 transition hover:border-cyan-200 hover:bg-cyan-500/20"
        >
          开始
        </button>
      </div>
    </section>
  );
}
