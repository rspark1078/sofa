import { afterEach, expect, test, vi } from "vitest";

import { extractModelPicks } from "../src/creator-pick-model";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function respond(picks: unknown[]) {
  vi.stubEnv("CREATOR_PICK_MODEL", "test-model");
  const mock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ done: true, message: { content: JSON.stringify({ picks }) } })),
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
    positive,
    { ...positive, title: "Other", evidence: "I recommend Other." },
    { ...positive, evidence: "I do not recommend Challengers." },
  ]);
  expect(
    await extractModelPicks(positive.evidence + " I do not recommend Challengers.", "Reviews"),
  ).toEqual([positive]);
});
test("does not attach unrelated generic praise to a movie", async () => {
  respond([
    { title: "Challengers", year: 2024, evidence: "It is my favorite film.", startSeconds: null },
  ]);
  expect(await extractModelPicks("Challengers. It is my favorite film.", "Review")).toEqual([]);
});
test("rejects invalid model output and connection failures without inventing picks", async () => {
  const mock = respond([]);
  mock.mockReset().mockResolvedValueOnce(new Response("offline", { status: 503 }));
  await expect(extractModelPicks("source", "Review")).rejects.toThrow(
    "Local recommendation model unavailable",
  );
});

test("independent verification rejects other people’s recommendations", async () => {
  const mock = respond([
    {
      title: "Challengers",
      year: null,
      evidence: "A listener recommends Challengers.",
      startSeconds: 999,
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
      evidence: "[12] I recommend Challengers.",
      startSeconds: 999,
    },
  ]);
  const result = await extractModelPicks("[12] I recommend Challengers.", "Review");
  expect(result?.[0].startSeconds).toBe(12);
});
