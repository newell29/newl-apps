"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function WorkboardRefresh() {
  const router = useRouter();
  useEffect(() => {
    // Do not reset an owner's in-progress reply or mission edits.
    const refresh = () => {
      if (document.visibilityState === "visible" && !document.querySelector("form:focus-within")) router.refresh();
    };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [router]);
  return null;
}
