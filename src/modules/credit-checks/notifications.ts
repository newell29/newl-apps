import type { CreditCheck } from "@prisma/client";

type NotificationResult = {
  sent: boolean;
  skipped?: boolean;
  error?: string;
};

export async function sendCreditCheckNotification(creditCheck: Pick<
  CreditCheck,
  | "id"
  | "company"
  | "legalCompanyName"
  | "operatingName"
  | "primaryContactName"
  | "primaryContactEmail"
  | "accountsPayableEmail"
  | "requestedCreditLimit"
  | "pageUrl"
>): Promise<NotificationResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const recipients = parseRecipients(
    process.env.CREDIT_CHECK_NOTIFICATION_TO ??
      "maria.salvador@newl.ca,alex.newell@newl.ca"
  );
  const from =
    process.env.CREDIT_CHECK_NOTIFICATION_FROM ??
    process.env.INBOUND_EMAIL_FROM ??
    "Newl Apps <notifications@newlgroup.com>";

  if (!apiKey || recipients.length === 0) {
    return { sent: false, skipped: true };
  }

  const companyName = creditCheck.company ?? creditCheck.legalCompanyName ?? creditCheck.operatingName ?? "New customer";
  const subject = `New account setup credit check: ${companyName}`;
  const text = [
    "A new account setup form was submitted and a credit check is ready in Newl Apps.",
    "",
    `Company: ${companyName}`,
    `Primary contact: ${creditCheck.primaryContactName ?? "Not provided"}`,
    `Primary email: ${creditCheck.primaryContactEmail ?? "Not provided"}`,
    `AP email: ${creditCheck.accountsPayableEmail ?? "Not provided"}`,
    `Requested credit limit: ${creditCheck.requestedCreditLimit ?? "Not provided"}`,
    `Source page: ${creditCheck.pageUrl ?? "Not provided"}`,
    "",
    `Open Newl Apps: https://newl-apps.vercel.app/finance/credit-checks?search=${encodeURIComponent(companyName)}`,
    `Credit check ID: ${creditCheck.id}`
  ].join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        text
      })
    });

    if (!response.ok) {
      const body = await response.text();
      return { sent: false, error: body || `Resend returned ${response.status}` };
    }

    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      error: error instanceof Error ? error.message : "Unknown notification error"
    };
  }
}

function parseRecipients(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
