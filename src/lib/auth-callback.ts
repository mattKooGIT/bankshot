/**
 * Where /auth/callback sends someone. Email links and Google return here with a
 * one-time `code`; Supabase's secure email change also sends the first of its two
 * confirmations here with only a `message` (no code), which is a success, not an error.
 */
export function callbackDestination(opts: {
  next: string;
  hadCode: boolean;
  exchangeOk: boolean;
  message?: string | null;
}): string {
  const withNotice = (path: string, notice: string) =>
    `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(notice)}`;

  if (opts.hadCode && opts.exchangeOk) return opts.next;
  if (!opts.hadCode && opts.message) return withNotice(opts.next, opts.message);
  if (opts.next === "/settings") {
    // The second email-change link's code only works in the browser that asked; the change still went through.
    return withNotice("/settings", "If you confirmed from both inboxes, your email has changed. Sign in again if needed.");
  }
  return `/login?error=${encodeURIComponent("That sign-in link is invalid or expired.")}`;
}
