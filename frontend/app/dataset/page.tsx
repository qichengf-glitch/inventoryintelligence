"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DatasetPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/search");
  }, [router]);
  return null;
}
