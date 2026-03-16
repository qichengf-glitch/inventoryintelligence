"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Next.js throws this when the browser holds JavaScript from a previous
    // deployment and tries to call a Server Action ID that no longer exists.
    // Force a hard reload to pick up the new build assets.
    if (error?.message?.includes("Failed to find Server Action")) {
      window.location.reload();
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          fontFamily: "system-ui, sans-serif",
          gap: "12px",
        }}
      >
        <h2 style={{ margin: 0 }}>Something went wrong</h2>
        <button
          onClick={reset}
          style={{
            padding: "8px 16px",
            borderRadius: "6px",
            border: "1px solid #ccc",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
