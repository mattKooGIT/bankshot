import { test } from "node:test";
import assert from "node:assert/strict";
import { callbackDestination } from "./auth-callback";

test("successful code exchange goes to next", () => {
  assert.equal(callbackDestination({ next: "/join/abc", hadCode: true, exchangeOk: true }), "/join/abc");
});

test("first email-change confirmation (message, no code) goes to next with a notice", () => {
  const to = callbackDestination({ next: "/settings", hadCode: false, exchangeOk: false,
    message: "Confirmation link accepted. Please proceed to confirm link sent to the other email" });
  assert.match(to, /^\/settings\?notice=/);
  assert.match(decodeURIComponent(to), /Confirmation link accepted/);
});

test("failed exchange from settings explains the email change may already be done", () => {
  const to = callbackDestination({ next: "/settings", hadCode: true, exchangeOk: false });
  assert.match(decodeURIComponent(to), /^\/settings\?notice=If you confirmed from both inboxes, your email has changed\./);
});

test("failed sign-in link goes to login with an error", () => {
  const to = callbackDestination({ next: "/market", hadCode: true, exchangeOk: false });
  assert.match(decodeURIComponent(to), /^\/login\?error=That sign-in link is invalid or expired\./);
});
