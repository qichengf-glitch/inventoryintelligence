import type { ReactNode } from "react";

import Sidebar from "@/components/layout/Sidebar";

type AppShellProps = {
  children: ReactNode;
};

export default function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-50">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-x-hidden">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
