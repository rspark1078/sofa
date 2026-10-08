import { afterAll, beforeEach, expect, test, vi } from "vitest";

import { cronRuns } from "@sofa/db/schema";
import { clearAllTables, testDb } from "@sofa/test/db";

import { startJobs, stopJobs } from "../src/cron";

const mocks = vi.hoisted(() => ({
  callbacks: new Map<string, () => Promise<void>>(),
  refresh: vi.fn<() => Promise<void>>(),
}));
vi.mock("@sofa/core/creator-refresh", () => ({ refreshDueCreators: mocks.refresh }));
// Register the real server job wrapper without starting clock-driven timers.
vi.mock("croner", () => ({
  Cron: class {
    constructor(_pattern: string, options: { name: string }, handler: () => Promise<void>) {
      mocks.callbacks.set(options.name, handler);
    }
    stop() {}
  },
}));
vi.mock("@sofa/logger", () => ({
  createLogger: () => ({
    debug: vi.fn<() => void>(),
    info: vi.fn<() => void>(),
    warn: vi.fn<() => void>(),
    error: vi.fn<() => void>(),
  }),
}));
beforeEach(() => {
  clearAllTables();
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  startJobs();
});
afterAll(() => stopJobs());

test("the scheduled job records aggregate critic failures as failed, not successful", async () => {
  mocks.refresh.mockRejectedValue(
    new Error("Critic refresh incomplete: 2 of 2 scheduled account checks failed"),
  );
  await mocks.callbacks.get("refreshCreatorFeeds")!();
  const run = testDb.select().from(cronRuns).get()!;
  expect(run.jobName).toBe("refreshCreatorFeeds");
  expect(run.status).toBe("error");
  expect(run.errorMessage).toContain("2 of 2 scheduled account checks failed");
  expect(run.finishedAt).not.toBeNull();
});

test("successful or no-due-account evaluations still record successful jobs", async () => {
  await mocks.callbacks.get("refreshCreatorFeeds")!();
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(testDb.select().from(cronRuns).get()).toMatchObject({
    jobName: "refreshCreatorFeeds",
    status: "success",
    errorMessage: null,
  });
});
