import { readFileSync } from "node:fs";

import { testClient } from "@sofa/test/db";

export const creatorMigrationSql = readFileSync(
  new URL(
    "../../../db/drizzle/20261005165514_creator_recommendations/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const seedSql = creatorMigrationSql.split(
  "-- Creator starter catalog (one-time migration seed)",
)[1];
export function seedCreatorCatalog() {
  testClient.exec(seedSql);
}
