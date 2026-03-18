"use client";

import { useEffect } from "react";

const CURRENT_DEPLOYMENT_ID = process.env.NEXT_PUBLIC_DEPLOYMENT_ID || "unknown";
const VERSION_CHECK_INTERVAL_MS = 60_000;

async function fetchDeploymentId(signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(`/api/version?ts=${Date.now()}`, {
      cache: "no-store",
      signal,
      headers: {
        "cache-control": "no-store",
      },
    });

    if (!response.ok) return null;
    const data = (await response.json()) as { deploymentId?: string };
    return typeof data.deploymentId === "string" ? data.deploymentId : null;
  } catch {
    return null;
  }
}

export default function DeploymentVersionGuard() {
  useEffect(() => {
    let reloading = false;

    const reloadIfStale = async () => {
      if (reloading || typeof window === "undefined") return;

      const controller = new AbortController();
      const serverDeploymentId = await fetchDeploymentId(controller.signal);
      controller.abort();

      if (
        serverDeploymentId &&
        serverDeploymentId !== CURRENT_DEPLOYMENT_ID
      ) {
        reloading = true;
        window.location.reload();
      }
    };

    void reloadIfStale();

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void reloadIfStale();
      }
    };

    window.addEventListener("focus", reloadIfStale);
    document.addEventListener("visibilitychange", onVisible);
    const intervalId = window.setInterval(() => {
      void reloadIfStale();
    }, VERSION_CHECK_INTERVAL_MS);

    return () => {
      window.removeEventListener("focus", reloadIfStale);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(intervalId);
    };
  }, []);

  return null;
}
