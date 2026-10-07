const databaseCode = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/;

function safeMessage(message: string): string {
  return message
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/\bBearer\s+\S+/gi, "Bearer [oculto]")
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[clave oculta]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[token oculto]",
    )
    .trim()
    .slice(0, 1200);
}

// Supabase normally returns plain error objects, not instances of Error.
// Only show their message and database code; details/hint may contain row data.
export function getErrorMessage(error: unknown, fallback: string): string {
  try {
    const source =
      typeof error === "object" && error !== null
        ? (error as { message?: unknown; code?: unknown })
        : null;
    const rawMessage = typeof error === "string" ? error : source?.message;
    const message =
      typeof rawMessage === "string" ? safeMessage(rawMessage) : "";
    const rawCode = source?.code;
    const code =
      typeof rawCode === "string" && databaseCode.test(rawCode) ? rawCode : "";
    return `${message || fallback}${code ? ` (código: ${code})` : ""}`;
  } catch {
    return fallback;
  }
}
