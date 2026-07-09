type DatabaseIdentity = {
  host: string;
  port: string;
  database: string;
  signature: string;
};

const VALID_DATABASE_ENVIRONMENTS = new Set(["production", "preview", "development", "local", "test"]);

function parseDatabaseIdentity(rawUrl: string | undefined, label: string): DatabaseIdentity | null {
  if (!rawUrl) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || "(none)";
    const port = parsed.port || defaultPortForProtocol(parsed.protocol);
    const host = parsed.hostname || "(none)";

    return {
      host,
      port,
      database,
      signature: `${host}:${port}/${database}`.toLowerCase()
    };
  } catch {
    throw new Error(`${label} is not a valid database URL.`);
  }
}

function defaultPortForProtocol(protocol: string) {
  if (protocol === "postgres:" || protocol === "postgresql:") {
    return "5432";
  }

  return "";
}

function printIdentity(label: string, identity: DatabaseIdentity | null) {
  if (!identity) {
    console.log(`${label}: not set`);
    return;
  }

  console.log(`${label}: host=${identity.host} port=${identity.port || "(default)"} database=${identity.database}`);
}

function readProductionSignatures() {
  const signatures = new Set<string>();
  const rawSignature = process.env.PRODUCTION_DATABASE_SIGNATURE;
  if (rawSignature) {
    signatures.add(rawSignature.trim().toLowerCase());
  }

  const productionDatabase = parseDatabaseIdentity(process.env.PRODUCTION_DATABASE_URL, "PRODUCTION_DATABASE_URL");
  if (productionDatabase) {
    signatures.add(productionDatabase.signature);
  }

  return signatures;
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function warn(message: string) {
  console.warn(`WARNING: ${message}`);
}

const args = new Set(process.argv.slice(2));
const requirePreviewDb = args.has("--require-preview-db");
const requireProductionDb = args.has("--require-production-db");
const database = parseDatabaseIdentity(process.env.DATABASE_URL, "DATABASE_URL");
const postgres = parseDatabaseIdentity(process.env.POSTGRES_URL, "POSTGRES_URL");
const productionSignatures = readProductionSignatures();
const previewSignature = process.env.PREVIEW_DATABASE_SIGNATURE?.trim().toLowerCase();
const databaseEnvironment = process.env.DATABASE_ENVIRONMENT?.trim().toLowerCase();
const vercelEnv = process.env.VERCEL_ENV ?? "(not set)";

console.log("Database safety check");
console.log(`VERCEL_ENV: ${vercelEnv}`);
console.log(`DATABASE_ENVIRONMENT: ${databaseEnvironment ?? "(not set)"}`);
printIdentity("DATABASE_URL", database);
printIdentity("POSTGRES_URL", postgres);

if (requirePreviewDb && requireProductionDb) {
  fail("Use either --require-preview-db or --require-production-db, not both.");
}

if (!database) {
  fail("DATABASE_URL is required.");
}

if (databaseEnvironment && !VALID_DATABASE_ENVIRONMENTS.has(databaseEnvironment)) {
  fail(
    `DATABASE_ENVIRONMENT must be one of ${Array.from(VALID_DATABASE_ENVIRONMENTS).join(", ")}. Got ${databaseEnvironment}.`
  );
}

if (postgres && postgres.signature !== database.signature) {
  warn("DATABASE_URL and POSTGRES_URL resolve to different host/database pairs. Verify both point to the same environment.");
}

if (process.env.VERCEL_ENV === "preview" || requirePreviewDb) {
  if (process.env.PRODUCTION_DATABASE_URL && process.env.DATABASE_URL === process.env.PRODUCTION_DATABASE_URL) {
    fail("DATABASE_URL exactly matches PRODUCTION_DATABASE_URL.");
  }

  if (databaseEnvironment !== "preview") {
    fail("Preview migrations require DATABASE_ENVIRONMENT=preview.");
  }
}

if (requireProductionDb) {
  if (databaseEnvironment !== "production") {
    fail("Production migrations require DATABASE_ENVIRONMENT=production.");
  }

  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    fail(`Production migrations cannot run when VERCEL_ENV=${process.env.VERCEL_ENV}.`);
  }

  if (productionSignatures.size > 0 && !productionSignatures.has(database.signature)) {
    fail(
      `DATABASE_URL resolves to ${database.signature}, but it does not match the configured production database identity.`
    );
  }

  if (productionSignatures.size === 0) {
    warn("No PRODUCTION_DATABASE_URL or PRODUCTION_DATABASE_SIGNATURE is set; relying on DATABASE_ENVIRONMENT=production.");
  }
}

if (productionSignatures.has(database.signature)) {
  const message = "DATABASE_URL matches the configured production database identity.";
  warn(message);
  warn("Host/database signatures can be identical for separate Prisma Postgres databases; DATABASE_ENVIRONMENT is authoritative.");
}

if (process.env.VERCEL_ENV === "preview" || requirePreviewDb) {
  if (previewSignature) {
    if (database.signature !== previewSignature) {
      const message = `Preview DATABASE_URL resolves to ${database.signature}, but PREVIEW_DATABASE_SIGNATURE expects ${previewSignature}.`;
      if (requirePreviewDb) {
        fail(message);
      }

      warn(message);
    }
  } else {
    warn("PREVIEW_DATABASE_SIGNATURE is not set; relying on DATABASE_ENVIRONMENT=preview.");
  }
}

console.log(`Current database signature: ${database.signature}`);
console.log("Database safety check passed.");
