import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import type { z } from "zod";

import type { CreatorVideoPickCheck } from "@sofa/api/schemas";
import { i18n } from "@sofa/i18n";
import { formatDate } from "@sofa/i18n/format";

import { CreatorCheckStatus } from "./creator-check-status";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
function render(check: z.infer<typeof CreatorVideoPickCheck> | null) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <I18nProvider i18n={i18n}>
        <CreatorCheckStatus check={check} />
      </I18nProvider>,
    ),
  );
  return container.textContent ?? "";
}
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

test.each([
  ["youtube_rate_limited", "YouTube requests are temporarily paused"],
  ["captions_rate_limited", "YouTube temporarily limited caption requests"],
  ["captions_unavailable", "Captions were unavailable"],
  ["video_evidence_unavailable", "text could not be retrieved"],
  ["model_unavailable", "local recommendation model was unavailable"],
  ["model_truncated", "model response was incomplete"],
  ["model_invalid_output", "model response could not be validated"],
  ["movie_lookup_failed", "Movie identity lookup was unavailable"],
  ["interrupted", "interrupted by a server restart"],
])("renders safe diagnostic for %s", (code, expected) => {
  const text = render({ state: "failed", picksAdded: 0, reason: "PRIVATE RAW ERROR", code });
  expect(text).toContain(expected);
  expect(text).not.toContain("PRIVATE RAW ERROR");
});

test("shows counts, partial coverage and future retry eligibility for added partial results", () => {
  const retryAt = "2099-01-01T00:00:00Z";
  const text = render({
    state: "added",
    picksAdded: 1,
    reason: "private",
    code: "captions_rate_limited",
    sourceKind: "description",
    moviesDiscussed: 5,
    moviesRecommended: 2,
    sourceCharacters: 30000,
    analyzedCharacters: 24000,
    retryAt,
  });
  expect(text).toContain("Verified recommendations saved");
  expect(text).toContain("Checked the description only");
  expect(text).toContain("Part of the available text was omitted");
  expect(text).toContain("Movies discussed: 5");
  expect(text).toContain("Endorsements detected: 2");
  expect(text).toContain("Verified picks added: 1");
  expect(text).toContain("Eligible for retry after");
  expect(text).toContain(formatDate(retryAt, { hour: "numeric", minute: "2-digit" }));
});

test("due retries remain eligible rather than claiming they already ran", () => {
  const text = render({
    state: "review",
    picksAdded: 0,
    reason: "",
    retryAt: "2000-01-01T00:00:00Z",
    sourceKind: "captions",
    sourceCharacters: 100,
    analyzedCharacters: 100,
  });
  expect(text).toContain("Retry is eligible on the next refresh");
  expect(text).toContain("Checked available captions and description");
  expect(text).not.toContain("omitted");
});

test("legacy checks do not invent coverage or counts", () => {
  const text = render({ state: "review", picksAdded: 0, reason: "Legacy private reason" });
  expect(text).toContain("Recommendation review required");
  expect(text).not.toContain("Movies discussed");
  expect(text).not.toContain("Eligible");
  expect(text).not.toContain("Legacy private reason");
});

test("unknown codes use a generic translated message", () => {
  const text = render({
    state: "failed",
    picksAdded: 0,
    reason: "PRIVATE REASON",
    code: "PRIVATE UNKNOWN CODE",
  });
  expect(text).toContain("Check details are unavailable");
  expect(text).not.toContain("PRIVATE");
});

test("unchecked videos show their pending status", () => {
  expect(render(null)).toBe("Awaiting recommendation check");
});
