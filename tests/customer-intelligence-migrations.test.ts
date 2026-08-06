/**
 * CP-PHASE-02A structural migration guards.
 *
 * These tests read the SQL source of the three existing Customer Intelligence
 * migrations and prove at the source level that every one of them is:
 *
 *   - additive: a statement-level allowlist admits only CREATE TYPE / ALTER
 *     TYPE ... ADD VALUE / CREATE TABLE / ALTER TABLE restricted to ADD COLUMN
 *     and ADD CONSTRAINT / CREATE INDEX (including CREATE UNIQUE INDEX) /
 *     INSERT ... ON CONFLICT; UPDATE, MERGE, REPLACE, and non-additive ALTER
 *     TABLE forms (ALTER COLUMN, RENAME, DROP) are explicitly rejected;
 *   - idempotent where it writes data: every data INSERT carries an ON CONFLICT
 *     marker (DO NOTHING or DO UPDATE);
 *   - non-destructive: no DROP TABLE, TRUNCATE, DELETE FROM, or
 *     column/index/constraint/type drops, matched case-insensitively so
 *     lowercase destructive SQL cannot pass;
 *   - never rewriting legacy finance structures: none of the migrations
 *     references CashflowCustomer, CashflowLegalEntity, or the rest of the
 *     legacy Cashflow* table/enum family; and
 *   - tenant-scoped for bootstrap: the module entitlement and the operating
 *     company rows are created only for the approved `newl-group` tenant.
 *
 * The guard is deliberately data-driven. Renaming or removing a known
 * migration, adding a migration outside the three known folders that starts
 * referencing Customer Intelligence tables, or editing any migration to use a
 * destructive verb, an UPDATE, or any statement verb outside the additive
 * allowlist fails the suite. Phase-2 backfill migrations must pass the same
 * guards.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION_ROOT = "prisma/migrations";

const FOUNDATION = "20260805120000_add_customer_intelligence_foundation";
const CORRECTIONS = "20260805150000_customer_intelligence_corrections";
const IDENTITY_INTEGRITY = "20260805160000_customer_intelligence_identity_integrity";

/** The only migrations that may define or alter Customer Intelligence schema. */
const CI_MIGRATIONS = [FOUNDATION, CORRECTIONS, IDENTITY_INTEGRITY] as const;

/** Tenant-scoped Customer Intelligence tables (quoted Prisma identifiers). */
const CI_TABLES = [
  "OperatingCompany",
  "CompanyOperatingRelationship",
  "CustomerSourceAccount",
  "ContactPoint",
  "ContactEvidence",
  "CustomerIdentityMatch",
  "QuickBooksServiceMappingRule",
  "CustomerFxRate",
  "CustomerRevenueLine",
  "CustomerMonthlyFinancial"
] as const;

/**
 * Legacy finance structures that pre-date Customer Intelligence. The Customer
 * Intelligence foundation must never alter, rewrite, or delete any of them,
 * additively or otherwise.
 */
const LEGACY_CASHFLOW_STRUCTURES = [
  "CashflowCustomer",
  "CashflowCustomerAlias",
  "CashflowFile",
  "CashflowAccountingLine",
  "CashflowCustomerInvoice",
  "CashflowVendorBill",
  "CashflowCustomerSnapshot",
  "CashflowFollowUp",
  "CashflowAlert",
  "CashflowSettings",
  "CashflowLegalEntity",
  "CashflowBusinessLine",
  "CashflowCustomerTier",
  "CashflowFileStatus",
  "CashflowInvoiceStatus",
  "CashflowVendorBillStatus",
  "CashflowRiskTier",
  "CashflowPriority",
  "CashflowBillingTrigger",
  "CashflowFollowUpStatus",
  "CashflowAlertStatus",
  "CashflowAlertType",
  "CashflowAccountingLineKind"
] as const;

/**
 * Destructive SQL verbs that must never appear in an additive migration.
 * All patterns are case-insensitive so lowercase destructive SQL (e.g.
 * `drop table`, `delete from`) cannot pass the guard.
 */
const DESTRUCTIVE_PATTERNS = [
  { label: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i },
  { label: "TRUNCATE", pattern: /\bTRUNCATE\b/i },
  { label: "DELETE FROM (data deletion)", pattern: /\bDELETE\s+FROM\b/i },
  { label: "DROP COLUMN", pattern: /\bDROP\s+COLUMN\b/i },
  { label: "DROP INDEX", pattern: /\bDROP\s+INDEX\b/i },
  { label: "DROP CONSTRAINT", pattern: /\bDROP\s+CONSTRAINT\b/i },
  { label: "DROP TYPE", pattern: /\bDROP\s+TYPE\b/i },
  {
    label: "DROP VIEW / FUNCTION / TRIGGER / SEQUENCE / SCHEMA",
    pattern: /\bDROP\s+(VIEW|FUNCTION|TRIGGER|SEQUENCE|SCHEMA)\b/i
  }
] as const;

function migrationSql(name: string): string {
  return readFileSync(`${MIGRATION_ROOT}/${name}/migration.sql`, "utf8");
}

function migrationFolderNames(): string[] {
  return readdirSync(MIGRATION_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/**
 * Split a migration file into top-level SQL statements on semicolons. Full-line
 * `--` comments are removed before splitting so comment prose that contains a
 * semicolon (the corrections migration's "well; this index is ..." prose is the
 * CP-PHASE-02A confirmed regression case) can never be parsed as a phantom
 * statement.
 */
function sqlStatements(sql: string): string[] {
  return stripCommentLines(sql)
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** Remove full-line `--` SQL comments from a migration file. */
function stripCommentLines(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

/** Strip leading `--` comment lines from a statement chunk. */
function stripLeadingComments(statement: string): string {
  return statement
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"))
    .join(" ");
}

/**
 * The leading SQL verb of a statement. `CREATE UNIQUE INDEX` is normalized to
 * `CREATE INDEX` because both are additive index creation. Unknown or
 * non-allowlisted verbs (e.g. `UPDATE`, `COMMENT`, `SELECT`) are returned
 * verbatim so the statement allowlist can reject them.
 */
function leadingSqlVerb(statement: string): string {
  const core = stripLeadingComments(statement).replace(
    /^CREATE\s+UNIQUE\s+INDEX\b/i,
    "CREATE INDEX"
  );
  const match = core.match(
    /^(CREATE\s+(?:TYPE|TABLE|INDEX)|ALTER\s+(?:TYPE|TABLE)|INSERT\s+INTO|[A-Z_]+)/i
  );
  return (match?.[1] ?? "UNKNOWN").toUpperCase();
}

/** Capture the body of a CREATE TABLE block (between the table name and `);`). */
function tableBlock(sql: string, table: string): string | null {
  const match = sql.match(new RegExp(`CREATE TABLE "${table}" \\(([\\s\\S]*?)\\)\\s*;`));
  return match?.[1] ?? null;
}

describe("Customer Intelligence migration inventory", () => {
  it("covers exactly the three known migrations, each with migration.sql and migration_lock.toml", () => {
    const folders = migrationFolderNames();
    for (const name of CI_MIGRATIONS) {
      expect(folders, `${name} must exist under ${MIGRATION_ROOT}`).toContain(name);
      expect(readdirSync(`${MIGRATION_ROOT}/${name}`).sort()).toEqual([
        "migration.sql",
        "migration_lock.toml"
      ]);
    }
  });

  it("confines Customer Intelligence table references to exactly the three known migrations", () => {
    const referencing = migrationFolderNames().filter((name) => {
      const sql = migrationSql(name);
      return CI_TABLES.some((table) => sql.includes(`"${table}"`));
    });
    expect(referencing.sort()).toEqual([...CI_MIGRATIONS].sort());
  });
});

describe("migration structural guard: additive and non-destructive", () => {
  it("contains no data-loss or destructive statements in any of the three migrations", () => {
    for (const name of CI_MIGRATIONS) {
      const sql = migrationSql(name);
      for (const { label, pattern } of DESTRUCTIVE_PATTERNS) {
        expect(sql, `${name} must not contain ${label}`).not.toMatch(pattern);
      }
    }
  });

  it("adds only additive verbs to existing structures", () => {
    for (const name of CI_MIGRATIONS) {
      const sql = migrationSql(name);
      expect(sql, `${name} must never drop a column`).not.toMatch(/ALTER TABLE[\s\S]*?\bDROP\b/i);
    }
  });
});

describe("migration structural guard: statement allowlist", () => {
  const additiveStatementVerbs = [
    "CREATE TYPE",
    "CREATE TABLE",
    "CREATE INDEX",
    "ALTER TYPE",
    "ALTER TABLE",
    "INSERT INTO"
  ] as const;

  it("permits only additive statement verbs in any of the three migrations", () => {
    for (const name of CI_MIGRATIONS) {
      const statements = sqlStatements(migrationSql(name));
      expect(statements.length, `${name} must contain at least one SQL statement`).toBeGreaterThan(0);
      for (const statement of statements) {
        const verb = leadingSqlVerb(statement);
        expect(
          additiveStatementVerbs,
          `${name} uses a statement verb outside the additive allowlist ("${verb}") in: ${statement.slice(0, 100)}`
        ).toContain(verb);
      }
    }
  });

  it("regression: comment prose containing semicolons never becomes a phantom statement", () => {
    // CP-PHASE-02A confirmed failure: the corrections migration comment
    // "well; this index is the database-backed backstop ..." contains a
    // semicolon. A splitter that splits on ";" before stripping "--" comment
    // lines parsed the fragment "well" as a phantom statement whose verb was
    // UNKNOWN, failing the additive allowlist. Comment lines are now removed
    // before splitting, so every parsed statement must carry a real verb.
    for (const name of CI_MIGRATIONS) {
      for (const statement of sqlStatements(migrationSql(name))) {
        expect(
          leadingSqlVerb(statement),
          `${name} parsed a phantom statement from comment prose: "${statement.slice(0, 80)}"`
        ).not.toBe("UNKNOWN");
      }
    }
  });

  it("never issues UPDATE, MERGE, or REPLACE statements in any of the three migrations", () => {
    for (const name of CI_MIGRATIONS) {
      for (const statement of sqlStatements(migrationSql(name))) {
        expect(leadingSqlVerb(statement), `${name} must not rewrite rows`).not.toMatch(
          /^(UPDATE|MERGE|REPLACE)$/
        );
      }
    }
  });

  it("restricts ALTER TABLE to ADD COLUMN and ADD CONSTRAINT in any of the three migrations", () => {
    for (const name of CI_MIGRATIONS) {
      for (const statement of sqlStatements(migrationSql(name))) {
        if (leadingSqlVerb(statement) !== "ALTER TABLE") continue;
        expect(statement, `${name} must not alter a column type or nullability`).not.toMatch(
          /\bALTER COLUMN\b/i
        );
        expect(statement, `${name} must not rename tables, columns, or indexes`).not.toMatch(
          /\bRENAME\b/i
        );
        expect(statement, `${name} must not drop anything inside ALTER TABLE`).not.toMatch(/\bDROP\b/i);
        expect(statement, `${name} ALTER TABLE must add a column or a constraint`).toMatch(
          /\bADD\s+(?:COLUMN|CONSTRAINT)\b/i
        );
      }
    }
  });

  it("restricts ALTER TYPE to ADD VALUE in any of the three migrations", () => {
    for (const name of CI_MIGRATIONS) {
      for (const statement of sqlStatements(migrationSql(name))) {
        if (leadingSqlVerb(statement) !== "ALTER TYPE") continue;
        expect(statement, `${name} ALTER TYPE must only add an enum value`).toMatch(/\bADD VALUE\b/i);
      }
    }
  });

  it("gives every data INSERT an idempotency marker (ON CONFLICT) in any of the three migrations", () => {
    for (const name of CI_MIGRATIONS) {
      for (const statement of sqlStatements(migrationSql(name))) {
        if (leadingSqlVerb(statement) !== "INSERT INTO") continue;
        expect(statement, `${name} every INSERT must carry ON CONFLICT`).toMatch(/ON CONFLICT/i);
      }
    }
  });
});

describe("migration structural guard: legacy cashflow untouched", () => {
  it("never references any legacy cashflow structure in any of the three migrations", () => {
    for (const name of CI_MIGRATIONS) {
      const sql = migrationSql(name);
      for (const structure of LEGACY_CASHFLOW_STRUCTURES) {
        expect(sql, `${name} must never reference ${structure}`).not.toContain(structure);
      }
    }
  });

  it("never rewrites CashflowCustomer or CashflowLegalEntity in any of the three migrations", () => {
    for (const name of CI_MIGRATIONS) {
      const sql = migrationSql(name);
      expect(sql, `${name} must never touch CashflowCustomer`).not.toContain("CashflowCustomer");
      expect(sql, `${name} must never touch CashflowLegalEntity`).not.toContain("CashflowLegalEntity");
    }
  });
});

describe("foundation migration (20260805120000_add_customer_intelligence_foundation)", () => {
  it("creates the additive Customer Intelligence table family with a tenantId on every table", () => {
    const sql = migrationSql(FOUNDATION);
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(CI_TABLES.length);
    for (const table of CI_TABLES) {
      const block = tableBlock(sql, table);
      expect(block, `foundation migration must declare CREATE TABLE "${table}"`).not.toBeNull();
      expect(block!.includes('"tenantId" TEXT NOT NULL'), `${table} must be tenant-scoped`).toBe(
        true
      );
    }
  });

  it("creates the Customer Intelligence enum family additively and extends ModuleKey by ADD VALUE", () => {
    const sql = migrationSql(FOUNDATION);
    const ciEnums = [
      "CustomerIntelligenceServiceLine",
      "CustomerLifecycle",
      "CompanyOperatingRelationshipStatus",
      "CustomerSourceAccountStatus",
      "ContactPointType",
      "ContactPointVerificationStatus",
      "ContactEvidenceSourceType",
      "ContactEvidenceReviewStatus",
      "CustomerIdentityMatchKind",
      "CustomerIdentityMatchStatus",
      "QuickBooksServiceMappingDimension",
      "CustomerFxRateStatus",
      "CustomerFinancialPeriodStatus"
    ];
    expect(sql.match(/CREATE TYPE/g)).toHaveLength(ciEnums.length);
    for (const enumName of ciEnums) {
      expect(sql).toContain(`CREATE TYPE "${enumName}" AS ENUM`);
    }
    expect(sql).toContain(`ALTER TYPE "ModuleKey" ADD VALUE 'CUSTOMER_INTELLIGENCE'`);
    expect(sql).not.toMatch(/ALTER TYPE[\s\S]*?\bDROP VALUE\b/);
  });
});

describe("corrections migration (20260805150000_customer_intelligence_corrections)", () => {
  it("is additive: adds only columns, indexes, constraints, and idempotent inserts", () => {
    const sql = migrationSql(CORRECTIONS);
    expect(sql).toContain('ADD COLUMN     "conflictingValue" TEXT');
    expect(sql).toContain('ADD COLUMN     "operatingCompanyId" TEXT');
    expect(sql).toContain('ADD COLUMN     "cadOpenAr"');
    expect(sql).toContain('ADD COLUMN     "nativeOpenAr"');
    expect(sql).not.toMatch(/CREATE TABLE/);
    expect(sql).not.toMatch(/CREATE TYPE/);
  });

  it("gives every data INSERT an idempotency marker (ON CONFLICT)", () => {
    const sql = migrationSql(CORRECTIONS);
    const inserts = sqlStatements(sql).filter((statement) => /^INSERT INTO/m.test(statement));
    // Module catalog + TenantModuleAccess entitlement + three OperatingCompany rows.
    expect(inserts.length).toBeGreaterThanOrEqual(5);
    for (const statement of inserts) {
      expect(statement, "every bootstrap INSERT must carry ON CONFLICT").toMatch(/ON CONFLICT/);
    }
  });

  it("bootstraps module, entitlement, and operating companies for the newl-group tenant only", () => {
    const sql = migrationSql(CORRECTIONS);
    const inserts = sqlStatements(sql).filter((statement) => /^INSERT INTO/m.test(statement));

    // The Module catalog row is global metadata (not tenant data) and does not
    // read from Tenant. Every tenant-scoped bootstrap (one TenantModuleAccess
    // entitlement + three OperatingCompany rows) must read from Tenant filtered
    // to the approved newl-group tenant only.
    const tenantScopedInserts = inserts.filter((statement) => /FROM "Tenant"/.test(statement));
    expect(tenantScopedInserts).toHaveLength(4);

    for (const statement of tenantScopedInserts) {
      expect(statement).toMatch(/ON CONFLICT/);
      const tenantFilters = statement.match(/t\."slug" = '[^']+'/g) ?? [];
      expect(tenantFilters, "the only tenant filter allowed is newl-group").toEqual([
        't."slug" = \'newl-group\''
      ]);
    }

    // Defense in depth: any INSERT that targets a tenant-scoped table must carry
    // the newl-group tenant filter and an idempotency marker, even if it does
    // not read FROM Tenant directly.
    for (const statement of inserts) {
      for (const table of ["TenantModuleAccess", "OperatingCompany"]) {
        if (statement.includes(`INSERT INTO "${table}"`)) {
          expect(statement, `INSERT INTO ${table} must be newl-group scoped`).toMatch(
            /t\."slug" = 'newl-group'/
          );
          expect(statement, `INSERT INTO ${table} must be idempotent`).toMatch(/ON CONFLICT/);
        }
      }
    }

    // The specific bootstrap rows are still present and unscoped to any other
    // tenant: the module catalog id, the newl-group entitlement target, and the
    // three operating-company ids.
    expect(sql).toContain("'module_customer_intelligence'");
    expect(sql).toContain("'oc_newl_worldwide'");
    expect(sql).toContain("'oc_newl_usa'");
    expect(sql).toContain("'oc_newells_express'");
  });
});

describe("identity-integrity migration (20260805160000_customer_intelligence_identity_integrity)", () => {
  it("adds only non-destructive tenant-scoped constraints with ON DELETE NO ACTION", () => {
    const sql = migrationSql(IDENTITY_INTEGRITY);
    expect(sql).toContain(
      'ADD CONSTRAINT "CustomerIdentityMatch_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE NO ACTION'
    );
    expect(sql).toContain(
      'ADD CONSTRAINT "CustomerIdentityMatch_tenantId_candidateCompanyId_fkey" FOREIGN KEY ("tenantId", "candidateCompanyId") REFERENCES "Company"("tenantId", "id") ON DELETE NO ACTION'
    );
    expect(sql).toContain('ADD CONSTRAINT "CustomerIdentityMatch_approved_requires_company"');
    expect(sql).toContain(
      'ADD CONSTRAINT "CustomerIdentityMatch_qb_approved_requires_operating_company"'
    );
    expect(sql).toContain('CHECK ("status" <> \'APPROVED\' OR "companyId" IS NOT NULL)');
    expect(sql).toContain(
      "CHECK (\"status\" <> 'APPROVED' OR \"kind\" <> 'QUICKBOOKS_ACCOUNT' OR \"operatingCompanyId\" IS NOT NULL)"
    );
    // No data writes, no table creation, no index drops.
    expect(sql).not.toContain("INSERT INTO");
    expect(sql).not.toMatch(/CREATE TABLE/);
  });

  it("preserves the one-approved-per-source partial unique index created by the corrections migration", () => {
    const sql = migrationSql(IDENTITY_INTEGRITY);
    expect(sql).not.toContain('DROP INDEX "CustomerIdentityMatch_one_approved_per_source_key"');
    expect(sql).not.toContain(
      'CREATE UNIQUE INDEX "CustomerIdentityMatch_one_approved_per_source_key"'
    );
    // The migration must reference the preserved index by its real identifier
    // (documenting that it is left untouched) rather than only describing it in
    // free-form prose that is brittle to comment-wording drift.
    expect(sql).toContain('CustomerIdentityMatch_one_approved_per_source_key');
    const corrections = migrationSql(CORRECTIONS);
    expect(corrections).toContain(
      'CREATE UNIQUE INDEX "CustomerIdentityMatch_one_approved_per_source_key"'
    );
  });
});
