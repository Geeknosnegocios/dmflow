/**
 * Interpolate dynamic placeholders in DM messages.
 * Supported:
 *   {username}      → "andreyweslley" (no @)
 *   {@username}     → "@andreyweslley"
 *   {first_name}    → "Andrey" (best-effort from username, fallback username)
 *   {hour_greeting} → "Bom dia" / "Boa tarde" / "Boa noite" (pt-BR)
 */
export function interpolate(
  message: string,
  ctx: { username?: string | null; timezone?: string } = {}
): string {
  if (!message) return message;
  const username = ctx.username ?? "";
  const mention = username ? `@${username}` : "";
  const firstName = username
    ? username
        .replace(/[._-]+/g, " ")
        .split(/\s+/)[0]
        .replace(/(?:^|\s)\S/g, (c) => c.toUpperCase())
    : "";
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  return message
    .replace(/\{@username\}/g, mention || "você")
    .replace(/\{username\}/g, username || "você")
    .replace(/\{first_name\}/g, firstName || "você")
    .replace(/\{hour_greeting\}/g, greeting);
}

export function hasPlaceholders(s: string | null | undefined): boolean {
  if (!s) return false;
  return /\{(?:@?username|first_name|hour_greeting)\}/.test(s);
}
