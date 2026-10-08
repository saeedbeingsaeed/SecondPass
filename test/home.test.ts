import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { homePage } from "../src/app.js";

function call(method: string, url: string) {
  const end = vi.fn();
  const writeHead = vi.fn(() => ({ end }));
  const handled = homePage(
    { method, url } as IncomingMessage,
    { writeHead } as unknown as ServerResponse,
  );
  return { handled, writeHead, end };
}

describe("homePage", () => {
  it("answers GET / with a status message", () => {
    const { handled, writeHead, end } = call("GET", "/");
    expect(handled).toBe(true);
    expect(writeHead).toHaveBeenCalledWith(200, expect.anything());
    expect(end.mock.calls[0]![0]).toContain("SecondPass is running");
  });

  it("leaves every other route to the next handler", () => {
    expect(call("GET", "/ping").handled).toBe(false);
    expect(call("POST", "/").handled).toBe(false);
    expect(call("GET", "/api/github/webhooks").handled).toBe(false);
  });
});
