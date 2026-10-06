import { describe, expect, test } from "vitest";

import { DiscoverInput } from "@sofa/api/schemas";

import { getDiscoverParams } from "../src/discovery";
import { getDiscoveryProviderIds, getDiscoveryProviderTypes } from "../src/platforms";

describe("Discover provider types", () => {
  test("classifies free services separately from subscription flags", () => {
    expect(getDiscoveryProviderTypes([73])).toEqual(["free"]);
    expect(getDiscoveryProviderTypes([191])).toEqual(["free"]);
    expect(getDiscoveryProviderTypes([8, 1796])).toEqual(["paid"]);
    expect(getDiscoveryProviderTypes([])).toEqual([]);
  });

  test("keeps a mixed platform in both lists, with only matching provider IDs", () => {
    expect(getDiscoveryProviderTypes([188, 192])).toEqual(["free", "paid"]);
    expect(getDiscoveryProviderIds([188, 192], "free_or_ads")).toEqual([192]);
    expect(getDiscoveryProviderIds([188, 192], "paid")).toEqual([188]);
    expect(getDiscoveryProviderIds([188, 192])).toEqual([188, 192]);
  });

  test("OnDemandKorea supports free and paid offers under the same provider ID", () => {
    expect(getDiscoveryProviderTypes([575])).toEqual(["free", "paid"]);
    expect(getDiscoveryProviderIds([575], "free_or_ads")).toEqual([575]);
    expect(getDiscoveryProviderIds([575], "paid")).toEqual([575]);
    const params = getDiscoverParams(
      DiscoverInput.parse({ type: "movie", platformId: "odk", accessType: "free_or_ads" }),
      [575],
      "US",
    );
    expect(params.with_watch_providers).toBe("575");
    expect(params.with_watch_monetization_types).toBe("free|ads");
  });

  test("paid means subscription, rental or purchase in the US", () => {
    const params = getDiscoverParams(
      DiscoverInput.parse({ type: "movie", accessType: "paid", platformId: "provider" }),
      [188],
      "GB",
    );
    expect(params.with_watch_monetization_types).toBe("flatrate|rent|buy");
    expect(params.watch_region).toBe("US");
    expect(params.with_watch_providers).toBe("188");
  });
});

test("multiple platforms match any mapped provider and deduplicate IDs", () => {
  const params = getDiscoverParams(
    DiscoverInput.parse({
      type: "movie",
      platformIds: ["tubi", "odk"],
      accessType: "free_or_ads",
    }),
    [73, 575, 73],
  );
  expect(params.with_watch_providers).toBe("73|575");
  expect(params.watch_region).toBe("US");
  expect(params.with_watch_monetization_types).toBe("free|ads");
});

test("unmapped or incompatible provider selections do not silently search all providers", () => {
  const params = getDiscoverParams(
    DiscoverInput.parse({ type: "movie", platformIds: ["missing"] }),
    [],
  );
  expect(params.with_watch_providers).toBe("0");
});

test("an empty multi-selection matches all providers", () => {
  const params = getDiscoverParams(DiscoverInput.parse({ type: "movie", platformIds: [] }), []);
  expect(params.with_watch_providers).toBeUndefined();
});
