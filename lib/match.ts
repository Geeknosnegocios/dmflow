import type { Rule } from "@/types/db";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function matchRule(comment: string, rule: Rule): boolean {
  const text = normalize(comment);
  const kw = normalize(rule.keyword ?? "");
  if (!text) return false;
  if (rule.match_mode === "any") return true;
  if (!kw) return false;
  switch (rule.match_mode) {
    case "exact":
      return text === kw;
    case "starts_with":
      return text.startsWith(kw);
    case "contains":
    default:
      return text.includes(kw);
  }
}

export function pickRule(comment: string, rules: Rule[]): Rule | null {
  const sorted = [...rules]
    .filter((r) => r.active)
    .sort((a, b) => b.priority - a.priority);
  for (const r of sorted) {
    if (matchRule(comment, r)) return r;
  }
  return null;
}
