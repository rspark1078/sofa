import { beforeEach, expect, test } from "vitest";

import { listCreatorMoviePicks } from "@sofa/db/queries/creator-recommendations";
import { clearAllTables } from "@sofa/test/db";

import { addCritic, getRecommendationCreators } from "../src/creator-recommendations";
import { seedCreatorCatalog } from "./fixtures/creator-catalog";
beforeEach(() => {
  clearAllTables();
  seedCreatorCatalog();
});
const channelUrl = "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv";
test("adds a persistent catalog source without inventing movie picks", () => {
  const creator = addCritic({ name: "  New critic  ", channelUrl: channelUrl + "/" });
  expect(creator.name).toBe("New critic");
  expect(creator.channelUrl).toBe(channelUrl);
  expect(getRecommendationCreators()).toContainEqual(creator);
  expect(listCreatorMoviePicks()).toHaveLength(11);
  expect(() => addCritic({ name: "Different name", channelUrl })).toThrow(/./);
});
test("rejects unsafe and unsupported channel URLs", () => {
  for (const url of [
    "https://evil.test/channel/UCabcdefghijklmnopqrstuv",
    "https://www.youtube.com/@critic",
    channelUrl + "?x=1",
    "https://user@www.youtube.com/channel/UCabcdefghijklmnopqrstuv",
  ]) {
    expect(() => addCritic({ name: "Critic", channelUrl: url })).toThrow(/./);
  }
  expect(() => addCritic({ name: " ", channelUrl })).toThrow(/./);
});
test("caps the catalog at the scheduler's 50-channel limit", () => {
  for (let index = 0; index < 47; index++) {
    addCritic({
      name: `Critic ${index}`,
      channelUrl: `https://www.youtube.com/channel/UC${String(index).padStart(22, "0")}`,
    });
  }
  expect(getRecommendationCreators()).toHaveLength(50);
  expect(() => addCritic({ name: "Overflow", channelUrl })).toThrow(/./);
  expect(getRecommendationCreators()).toHaveLength(50);
});
