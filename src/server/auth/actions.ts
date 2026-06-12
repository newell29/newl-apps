"use server";

import { signIn, signOut } from "@/server/auth";

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

export async function signInWithEntraAction(formData: FormData): Promise<void> {
  const callbackUrl = readCallbackUrl(formData.get("callbackUrl"));
  await signIn("microsoft-entra-id", { redirectTo: callbackUrl });
}

function readCallbackUrl(value: FormDataEntryValue | null): string {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/dashboard";
}
