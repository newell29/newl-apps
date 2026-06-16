import { handlePasswordLogin } from "@/server/auth/password-login";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handlePasswordLogin(request);
}
