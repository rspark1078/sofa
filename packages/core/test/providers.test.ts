import { expect, test } from "vitest";

import { generateProviderUrl, getProviderWatchLink } from "../src/providers";

test("provider search links preserve titles as a single encoded parameter", () => {
  const url = generateProviderUrl("https://example.com/search?q={title}", "A & B / Korean 영화");
  expect(new URL(url!).searchParams.get("q")).toBe("A & B / Korean 영화");
});
test.each([
  null,
  "javascript:alert(1)",
  "file:///etc/passwd",
  "https://user:pass@example.com",
  "invalid",
])("rejects unsafe provider templates: %s", (template) =>
  expect(generateProviderUrl(template, "Movie")).toBeNull(),
);

test("uses verified official title links only for the exact movie and provider", () => {
  const options = {
    tmdbId: 581528,
    type: "movie" as const,
    providerIds: [73],
    titleName: "The Gangster, the Cop, the Devil",
    urlTemplate: "https://tubitv.com/search/{title}",
  };
  expect(getProviderWatchLink(options)).toEqual({
    watchUrl: "https://tubitv.com/movies/585846/the-gangster-the-cop-the-devil",
    linkType: "title",
  });
  expect(getProviderWatchLink({ ...options, tmdbId: 123 }).linkType).toBe("search");
  expect(getProviderWatchLink({ ...options, type: "tv" }).linkType).toBe("search");
  expect(getProviderWatchLink({ ...options, providerIds: [575] }).watchUrl).toContain(
    "ondemandkorea.com/en/player/vod/",
  );
  expect(
    getProviderWatchLink({ ...options, providerIds: [], urlTemplate: "https://example.com/" })
      .linkType,
  ).toBe("landing");
});
