/**
 * Pure mailto: URL builder.
 *
 * The no-config email fallback (ConsoleEmailProvider) hands the
 * user a tap-to-open mailto: URL via Telegram, pre-filled with the
 * PO subject/body/recipient. The user's native email app opens,
 * they review, they hit Send — no SMTP, no OAuth, no domain setup.
 *
 * Trimming rule: bodies get trimmed to ~1.8k characters because
 * many mobile mail apps silently drop anything past the ~2k URL
 * length limit (including the scheme + params overhead). Locking
 * that boundary in a pure function means a future refactor can't
 * silently raise it and break the zero-config path on iOS/Android.
 */

export function buildMailtoUrl(input: {
  to: string;
  subject: string;
  body: string;
}): string {
  const trimmedBody =
    input.body.length > 1800
      ? input.body.slice(0, 1790) + "\n…"
      : input.body;
  const params = new URLSearchParams({
    subject: input.subject,
    body: trimmedBody,
  });
  return `mailto:${encodeURIComponent(input.to)}?${params.toString()}`;
}
