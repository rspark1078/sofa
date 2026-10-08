import { beforeEach, describe, expect, test } from "vitest";

import { user } from "@sofa/db/schema";
import { clearAllTables, eq, insertUser, testDb } from "@sofa/test/db";

import {
  getCriticPreferences,
  updateCriticPreferences,
  claimInitialAdmin,
  getExplorePreferences,
  updateExplorePreferences,
  getSetting,
  getUserCount,
  isRegistrationOpen,
  setSetting,
} from "../src/settings";

beforeEach(() => {
  clearAllTables();
});

// ── getSetting / setSetting ─────────────────────────────────────────

describe("getSetting / setSetting", () => {
  test("returns null for missing key", () => {
    expect(getSetting("nonexistent")).toBeNull();
  });

  test("stores and retrieves a value", () => {
    setSetting("theme", "dark");
    expect(getSetting("theme")).toBe("dark");
  });

  test("upserts: overwrites existing value", () => {
    setSetting("theme", "dark");
    setSetting("theme", "light");
    expect(getSetting("theme")).toBe("light");
  });
});

// ── getUserCount ────────────────────────────────────────────────────

describe("getUserCount", () => {
  test("returns 0 when no users", () => {
    expect(getUserCount()).toBe(0);
  });

  test("returns correct count", () => {
    insertUser("user-1");
    insertUser("user-2");
    expect(getUserCount()).toBe(2);
  });
});

// ── isRegistrationOpen ──────────────────────────────────────────────

describe("isRegistrationOpen", () => {
  test("returns true when no users exist (first-run)", () => {
    expect(isRegistrationOpen()).toBe(true);
  });

  test("returns false when users exist and setting is not set", () => {
    insertUser();
    expect(isRegistrationOpen()).toBe(false);
  });

  test("returns true when users exist and setting is 'true'", () => {
    insertUser();
    setSetting("registrationOpen", "true");
    expect(isRegistrationOpen()).toBe(true);
  });

  test("returns false when users exist and setting is 'false'", () => {
    insertUser();
    setSetting("registrationOpen", "false");
    expect(isRegistrationOpen()).toBe(false);
  });
});

describe("claimInitialAdmin", () => {
  test("promotes the earliest user to admin and closes registration", () => {
    insertUser("user-1");
    insertUser("user-2");

    expect(claimInitialAdmin("user-2")).toBe(false);
    expect(claimInitialAdmin("user-1")).toBe(true);
    expect(claimInitialAdmin("user-1")).toBe(false);

    const firstUser = testDb.select().from(user).where(eq(user.id, "user-1")).get();
    const secondUser = testDb.select().from(user).where(eq(user.id, "user-2")).get();

    expect(firstUser?.role).toBe("admin");
    expect(secondUser?.role).toBe("user");
    expect(getSetting("registrationOpen")).toBe("false");
  });
});

describe("Explore preferences", () => {
  test("shows all optional sections by default", () => {
    expect(getExplorePreferences("user-1")).toEqual({
      trending: true,
      popularMovies: true,
      popularTv: true,
    });
  });

  test("persists visibility separately for each account", () => {
    const hidden = { trending: false, popularMovies: false, popularTv: false };
    expect(updateExplorePreferences("user-1", hidden)).toEqual(hidden);
    expect(getExplorePreferences("user-1")).toEqual(hidden);
    expect(getExplorePreferences("user-2").trending).toBe(true);
    updateExplorePreferences("user-1", { ...hidden, popularMovies: true });
    expect(getExplorePreferences("user-1").popularMovies).toBe(true);
  });

  test("recovers from malformed or invalid saved preferences", () => {
    for (const value of ["invalid JSON", '{"trending":"invalid"}']) {
      setSetting("user:user-1:explore", value);
      expect(getExplorePreferences("user-1").trending).toBe(true);
    }
  });
});

describe("Critic preferences", () => {
  test("defaults preserve all critics and daily checks", () => {
    expect(getCriticPreferences("user-1")).toEqual({
      creatorIds: null,
      refreshFrequency: "daily",
    });
  });
  test("persists personal selections without changing another account", () => {
    updateCriticPreferences("user-1", {
      creatorIds: ["jeremy-jahns", "jeremy-jahns"],
      refreshFrequency: "weekly",
    });
    expect(getCriticPreferences("user-1")).toEqual({
      creatorIds: ["jeremy-jahns"],
      refreshFrequency: "weekly",
    });
    expect(getCriticPreferences("user-2").creatorIds).toBeNull();
    updateCriticPreferences("user-1", { creatorIds: [], refreshFrequency: "manual" });
    expect(getCriticPreferences("user-1").creatorIds).toEqual([]);
  });
  test("recovers malformed data and rejects unsupported intervals", () => {
    setSetting("user:user-1:critics", "invalid");
    expect(getCriticPreferences("user-1").refreshFrequency).toBe("daily");
    expect(() =>
      updateCriticPreferences("user-1", { creatorIds: [], refreshFrequency: "seconds" as "daily" }),
    ).toThrow(/Invalid option/);
  });
});
