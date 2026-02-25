// frontend/app/layout.tsx

import type { Metadata } from "next";
import "./globals.css";

import AppShell from "@/components/layout/AppShell";
import { LanguageProvider } from "@/components/LanguageProvider";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "Inventory Intelligence",
  description: "AI-powered inventory management dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ThemeProvider>
          <LanguageProvider>
            <AppShell>{children}</AppShell>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
