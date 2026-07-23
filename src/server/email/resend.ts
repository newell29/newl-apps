type SendEmailInput = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string | null;
  replyTo?: string | null;
  attachments?: Array<{
    filename: string;
    content: Buffer;
  }>;
};

type SendEmailResult = {
  sent: boolean;
  skipped?: boolean;
  error?: string;
};

export async function sendResendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const recipients = input.to.map((recipient) => recipient.trim()).filter(Boolean);

  if (!apiKey || recipients.length === 0 || !input.from.trim()) {
    return { sent: false, skipped: true };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: input.from,
        to: recipients,
        subject: input.subject,
        text: input.text,
        html: input.html || undefined,
        reply_to: input.replyTo || undefined,
        attachments: input.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content.toString("base64")
        }))
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
      error: error instanceof Error ? error.message : "Unknown email send error"
    };
  }
}

export function parseEmailRecipients(value?: string | null) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
