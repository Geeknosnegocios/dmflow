import assert from "node:assert/strict";
import test from "node:test";
import { isOwnInstagramComment, permitsTestComment, publicReplyFor } from "../lib/comment-rules.ts";

test("test rules require a dedicated post and explicitly allowed commenter", () => {
  const rule = { test_mode: true, post_id: "123" };
  assert.equal(permitsTestComment(rule, { username: "agent_test" }, " @agent_TEST "), true);
  assert.equal(permitsTestComment(rule, { username: "someoneelse" }, "agent_test"), false);
  assert.equal(permitsTestComment({ ...rule, post_id: null }, { username: "agent_test" }, "agent_test"), false);
  assert.equal(permitsTestComment(rule, { username: "agent_test" }, undefined), false);
  assert.equal(permitsTestComment({}, undefined, undefined), true);
});

test("ignore the connected profile by ID or username", () => {
  const account = { ig_business_id: "42", ig_username: "Geek" };
  assert.equal(isOwnInstagramComment({ id: "42" }, account), true);
  assert.equal(isOwnInstagramComment({ username: "gEeK" }, account), true);
  assert.equal(isOwnInstagramComment({ username: "GeekTest" }, account), false);
});

test("rotate through four replies and preserve legacy reply text", () => {
  const rule = { public_reply: "Legacy", public_reply_variants: ["A", "B", "C", "D"] };
  assert.equal(new Set(["100", "101", "102", "103"].map((id) => publicReplyFor(rule, id))).size, 4);
  assert.equal(publicReplyFor({ public_reply: " Legacy " }, "1"), "Legacy");
});
