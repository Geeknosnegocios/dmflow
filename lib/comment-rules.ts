export function instagramUsername(value?: string | null) {
  return value?.trim().replace(/^@/, "").toLowerCase() || null;
}

export function isOwnInstagramComment(author: { id?: string; username?: string } | undefined,
  account: { ig_business_id?: string | null; ig_page_id?: string | null; ig_username?: string | null }) {
  const username = instagramUsername(author?.username);
  return Boolean(
    (author?.id && [account.ig_business_id, account.ig_page_id].includes(author.id)) ||
    (username && username === instagramUsername(account.ig_username)),
  );
}

export function permitsTestComment(
  rule: { test_mode?: boolean; post_id?: string | null },
  author: { username?: string } | undefined,
  testers: string | undefined,
) {
  if (!rule.test_mode) return true;
  const username = instagramUsername(author?.username);
  return Boolean(rule.post_id && username && testers?.split(",").some((tester) => instagramUsername(tester) === username));
}

export function publicReplyFor(
  rule: { public_reply?: string | null; public_reply_variants?: string[] | null },
  commentId: string,
) {
  const choices = rule.public_reply_variants?.map((reply) => reply.trim()).filter(Boolean);
  if (!choices?.length) return rule.public_reply?.trim() || null;
  const index = [...commentId].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0);
  return choices[index % choices.length];
}
