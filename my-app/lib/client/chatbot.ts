type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

export type ChatbotResult =
  | { ok: true; answer: string }
  | { ok: false; error: string };

export async function requestChatbotAnswer(question: string): Promise<ChatbotResult> {
  try {
    const response = await fetch("/api/chatbot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });

    const payload: unknown = await response.json().catch(() => ({}));
    if (response.ok) {
      const answer = isJsonRecord(payload) && typeof payload.answer === "string" ? payload.answer.trim() : "";
      return { ok: true, answer };
    }

    const message = isJsonRecord(payload) && typeof payload.error === "string" ? payload.error : `Chat error (${response.status})`;
    return { ok: false, error: message };
  } catch {
    return { ok: false, error: "Network error while contacting the assistant." };
  }
}
