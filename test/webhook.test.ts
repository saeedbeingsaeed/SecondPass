import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Probot } from "probot";

// Probot (via @octokit/webhooks) must reject payloads whose signature does not
// match WEBHOOK_SECRET. This guards against someone upgrading or replacing the
// middleware and silently losing the check.
describe("webhook signature verification", () => {
  const secret = "test-secret";
  const probot = new Probot({ appId: 1, privateKey: "unused", secret, logLevel: "fatal" });
  const payload = JSON.stringify({ action: "opened" });
  const sign = (key: string) => `sha256=${createHmac("sha256", key).update(payload).digest("hex")}`;

  it("accepts a correctly signed payload", async () => {
    await expect(
      probot.webhooks.verifyAndReceive({
        id: "1",
        name: "pull_request",
        payload,
        signature: sign(secret),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a payload signed with the wrong secret", async () => {
    await expect(
      probot.webhooks.verifyAndReceive({
        id: "2",
        name: "pull_request",
        payload,
        signature: sign("attacker"),
      }),
    ).rejects.toThrow();
  });
});
