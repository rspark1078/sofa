import { beforeEach, describe, expect, test } from "vitest";

import { clearAllTables } from "@sofa/test/db";

import {
  deleteDiscoveryPreset,
  getDiscoveryPresets,
  saveDiscoveryPreset,
} from "../src/discovery-presets";

beforeEach(() => clearAllTables());

describe("saved Discover presets", () => {
  test("loads, updates and deletes a compound preset without changing another account", () => {
    const filters = {
      type: "movie" as const,
      originCountry: "KR",
      language: "ko",
      ratingMin: 7,
      certification: "PG-13" as const,
      platformIds: ["tubi", "odk"],
      accessType: "free_or_ads" as const,
    };
    const [preset] = saveDiscoveryPreset("user-1", { name: " Free Korean movies ", filters });
    expect(preset.name).toBe("Free Korean movies");
    expect(getDiscoveryPresets("user-1")[0].filters).toEqual(filters);
    expect(getDiscoveryPresets("user-2")).toEqual([]);
    expect(() => saveDiscoveryPreset("user-2", { ...preset, name: "Hijack" })).toThrow(
      /not found/i,
    );
    expect(deleteDiscoveryPreset("user-2", preset.id)).toEqual([]);
    expect(getDiscoveryPresets("user-1")).toHaveLength(1);
    saveDiscoveryPreset("user-1", {
      ...preset,
      name: "Updated",
      filters: { ...filters, ratingMin: 8 },
    });
    expect(getDiscoveryPresets("user-1")).toHaveLength(1);
    expect(getDiscoveryPresets("user-1")[0].filters.ratingMin).toBe(8);
    expect(deleteDiscoveryPreset("user-1", preset.id)).toEqual([]);
  });
  test("rejects invalid names/filters and limits an account to 50 presets", () => {
    expect(() => saveDiscoveryPreset("user-1", { name: " ", filters: {} })).toThrow(/name/);
    expect(() =>
      saveDiscoveryPreset("user-1", { name: "Invalid", filters: { ratingMin: 11 } }),
    ).toThrow(/ratingMin/);
    for (let index = 0; index < 50; index++)
      saveDiscoveryPreset("user-1", { name: "Preset " + index, filters: {} });
    expect(() => saveDiscoveryPreset("user-1", { name: "Overflow", filters: {} })).toThrow(
      /bad request/i,
    );
    const first = getDiscoveryPresets("user-1")[0];
    expect(saveDiscoveryPreset("user-1", { ...first, name: "Updated" })).toHaveLength(50);
  });
});
