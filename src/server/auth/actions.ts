"use server";

import { signIn, signOut } from "@/server/auth";
import { MICROSOFT_GRAPH_DELEGATED_SCOPE_STRING } from "@/server/integrations/microsoft-graph-account";

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

export async function signInWithEntraAction(formData: FormData): Promise<void> {
  const callbackUrl = readCallbackUrl(formData.get("callbackUrl"));
  await signIn("microsoft-entra-id", { redirectTo: callbackUrl });
}

export async function connectMicrosoftGraphAction(formData: FormData): Promise<void> {
  const callbackUrl = readMicrosoftCallbackUrl(formData.get("callbackUrl"));

  await signIn(
    "microsoft-entra-id",
    { redirectTo: callbackUrl },
    {
      prompt: "consent",
      scope: MICROSOFT_GRAPH_DELEGATED_SCOPE_STRING
    }
  );
}

function readCallbackUrl(value: FormDataEntryValue | null): string {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/dashboard";
}

function readMicrosoftCallbackUrl(value: FormDataEntryValue | null): string {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  return "/settings#microsoft-365";
}
