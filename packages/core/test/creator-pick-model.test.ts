import { afterEach, expect, test, vi } from "vitest";

import { extractModelPicks } from "../src/creator-pick-model";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function respond(movies: unknown[]) {
  vi.stubEnv("CREATOR_PICK_MODEL", "test-model");
  const mock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ done: true, message: { content: JSON.stringify({ movies }) } }),
      ),
    )
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          done: true,
          message: {
            content: JSON.stringify({
              decisions: [{ index: 0, approved: true, reason: "Direct recommendation" }],
            }),
          },
        }),
      ),
    );
  vi.stubGlobal("fetch", mock);
  return mock;
}
test("keeps source-grounded positive picks and rejects fabricated or negative evidence", async () => {
  const positive = {
    title: "Challengers",
    year: 2024,
    evidence: "I recommend Challengers, one of my favorite films of 2024.",
    startSeconds: null,
  };
  respond([
    { title: "Challengers", year: 2024, assessment: "recommended", lineStart: 0, lineEnd: 0 },
    { title: "Other", year: 2024, assessment: "recommended", lineStart: 0, lineEnd: 0 },
    { title: "Negative", year: 2024, assessment: "recommended", lineStart: 1, lineEnd: 1 },
  ]);
  expect(
    await extractModelPicks(positive.evidence + "\nI do not recommend Negative.", "Reviews"),
  ).toEqual([positive]);
});
test("does not attach unrelated generic praise to a movie", async () => {
  respond([
    { title: "Challengers", year: 2024, assessment: "recommended", lineStart: 1, lineEnd: 1 },
  ]);
  expect(await extractModelPicks("Challengers.\nIt is my favorite film.", "Review")).toEqual([]);
});
test("rejects invalid model output and connection failures without inventing picks", async () => {
  const mock = respond([]);
  mock.mockReset().mockResolvedValueOnce(new Response("offline", { status: 503 }));
  await expect(extractModelPicks("source", "Review")).rejects.toThrow("model_unavailable");
});

test("independent verification rejects other people’s recommendations", async () => {
  const mock = respond([
    {
      title: "Challengers",
      year: null,
      assessment: "recommended",
      lineStart: 0,
      lineEnd: 0,
    },
  ]);
  mock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        done: true,
        message: {
          content: JSON.stringify({
            decisions: [{ index: 0, approved: false, reason: "Listener opinion" }],
          }),
        },
      }),
    ),
  );
  expect(await extractModelPicks("A listener recommends Challengers.", "Listener lists")).toEqual(
    [],
  );
});
test("uses source timestamps rather than model-generated timestamps", async () => {
  respond([
    {
      title: "Challengers",
      year: null,
      assessment: "recommended",
      lineStart: 0,
      lineEnd: 0,
    },
  ]);
  const result = await extractModelPicks("[12] I recommend Challengers.", "Review");
  expect(result?.[0].startSeconds).toBe(12);
});

test("truncated output has a distinct retryable error code", async () => {
  const mock = respond([]);
  mock
    .mockReset()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ done: true, done_reason: "length", message: { content: "{" } }),
      ),
    );
  await expect(extractModelPicks("source", "Review")).rejects.toMatchObject({
    code: "model_truncated",
  });
});
