export type ThreadableCorrespondenceMessage = {
  id: string;
  mailboxAddress: string;
  conversationId: string | null;
  messageAt: string;
};

export type CorrespondenceConversation<T extends ThreadableCorrespondenceMessage> = {
  key: string;
  latestMessageAt: string;
  messages: T[];
};

export function groupCorrespondenceMessages<T extends ThreadableCorrespondenceMessage>(
  messages: T[]
): Array<CorrespondenceConversation<T>> {
  const grouped = new Map<string, T[]>();

  for (const message of messages) {
    const mailbox = message.mailboxAddress.trim().toLowerCase();
    const conversationId = message.conversationId?.trim();
    const key = conversationId
      ? `conversation:${mailbox}:${conversationId}`
      : `message:${message.id}`;
    grouped.set(key, [...(grouped.get(key) ?? []), message]);
  }

  return Array.from(grouped, ([key, groupedMessages]) => {
    const sortedMessages = groupedMessages
      .slice()
      .sort((left, right) => messageTimestamp(left) - messageTimestamp(right));
    return {
      key,
      latestMessageAt: sortedMessages.at(-1)?.messageAt ?? "",
      messages: sortedMessages
    };
  }).sort((left, right) => {
    const timeDifference = Date.parse(right.latestMessageAt) - Date.parse(left.latestMessageAt);
    return timeDifference || left.key.localeCompare(right.key);
  });
}

function messageTimestamp(message: ThreadableCorrespondenceMessage) {
  const timestamp = Date.parse(message.messageAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
