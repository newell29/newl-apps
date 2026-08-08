import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real PostgreSQL regression for the behavior Prisma mocks cannot emulate.
 * The controller opts in with a dedicated isolated test/preview database; this
 * suite never falls back to DATABASE_URL and never prints its connection URL.
 */
const enabled = process.env.CUSTOMER_INTELLIGENCE_POSTGRES_TESTS === "1";
const databaseUrl = process.env.CUSTOMER_INTELLIGENCE_TEST_DATABASE_URL;
const describePostgres = enabled ? describe : describe.skip;
const tableName = `ci_identity_concurrency_${process.pid}_${Date.now()}`;

describePostgres("Customer Intelligence reconciliation on real PostgreSQL", () => {
  let first: PrismaClient;
  let second: PrismaClient;

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error("CUSTOMER_INTELLIGENCE_TEST_DATABASE_URL is required for the opt-in suite.");
    }
    const databaseName = new URL(databaseUrl).pathname.slice(1);
    if (!/(test|preview)/i.test(databaseName)) {
      throw new Error("The reconciliation PostgreSQL suite requires an isolated test/preview database.");
    }
    first = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await first.$executeRawUnsafe(`
      CREATE TABLE "${tableName}" (
        "id" text PRIMARY KEY,
        "tenantId" text NOT NULL,
        "kind" text NOT NULL,
        "sourceRecordKey" text NOT NULL,
        "status" text NOT NULL
      )
    `);
    await first.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "${tableName}_approved_source"
      ON "${tableName}" ("tenantId", "kind", "sourceRecordKey")
      WHERE "status" = 'APPROVED'
    `);
  });

  afterAll(async () => {
    if (first) {
      await first.$executeRawUnsafe(`DROP TABLE IF EXISTS "${tableName}"`);
      await first.$disconnect();
    }
    if (second) {
      await second.$disconnect();
    }
  });

  it("proves a caught unique violation still aborts the PostgreSQL transaction", async () => {
    await expect(
      first.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(
          `INSERT INTO "${tableName}" VALUES ('abort-a', 'tenant-a', 'QUICKBOOKS_ACCOUNT', 'realm:abort', 'APPROVED')`
        );
        try {
          await transaction.$executeRawUnsafe(
            `INSERT INTO "${tableName}" VALUES ('abort-b', 'tenant-a', 'QUICKBOOKS_ACCOUNT', 'realm:abort', 'APPROVED')`
          );
        } catch {
          // The next query must fail with PostgreSQL's aborted-transaction
          // state. This pins why reconciliation rereads only after rollback.
        }
        await transaction.$queryRawUnsafe(`SELECT 1 FROM "${tableName}" LIMIT 1`);
      })
    ).rejects.toBeDefined();

    const rows = await first.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "${tableName}" WHERE "sourceRecordKey" = 'realm:abort'`
    );
    expect(rows).toEqual([]);
  });

  it("allows one concurrent approval and an authoritative reread after the loser rolls back", async () => {
    await first.$executeRawUnsafe(`
      INSERT INTO "${tableName}" VALUES
        ('proposal-a', 'tenant-a', 'QUICKBOOKS_ACCOUNT', 'realm:1001', 'PROPOSED'),
        ('proposal-b', 'tenant-a', 'QUICKBOOKS_ACCOUNT', 'realm:1001', 'PROPOSED')
    `);

    const outcomes = await Promise.allSettled([
      first.$executeRawUnsafe(
        `UPDATE "${tableName}" SET "status" = 'APPROVED' WHERE "id" = 'proposal-a'`
      ),
      second.$executeRawUnsafe(
        `UPDATE "${tableName}" SET "status" = 'APPROVED' WHERE "id" = 'proposal-b'`
      )
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);

    const authoritative = await second.$queryRawUnsafe<Array<{ id: string }>>(`
      SELECT "id" FROM "${tableName}"
      WHERE "tenantId" = 'tenant-a'
        AND "kind" = 'QUICKBOOKS_ACCOUNT'
        AND "sourceRecordKey" = 'realm:1001'
        AND "status" = 'APPROVED'
    `);
    expect(authoritative).toHaveLength(1);
  });
});
