import { describe, expect, test } from "vitest";

import { providerFirefoxUrl } from "./provider-link";

describe("Firefox provider links", () => {
  test("encodes a complete provider URL without losing query parameters", () => {
    const url = "https://example.com/search?q=Oldboy%20%26%20friends&lang=ko#watch";
    const link = providerFirefoxUrl(url)!;
    expect(link.startsWith("sofa-firefox:")).toBe(true);
    expect(decodeURIComponent(link.slice("sofa-firefox:".length))).toBe(url);
  });
  test.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:password@example.com",
    "invalid",
  ])("rejects unsupported or credential-bearing URLs: %s", (url) => {
    expect(providerFirefoxUrl(url)).toBeNull();
  });
});
