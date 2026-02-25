"use client";

import type { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-slate-950 text-slate-50">{children}</div>;
}
