# Deployment

Newl Apps uses separate databases for Production and Vercel Preview deployments.
Production deploys serve the live internal platform. Preview deploys are for testing
pull requests before merge and must never migrate or write to the production
database.

## Vercel Environments

Configure these variables separately in Vercel Project Settings -> Environment
Variables:

| Vercel environment | `DATABASE_URL` / `POSTGRES_URL` target |
| --- | --- |
| Production | Production database |
| Preview | Preview/staging database |
| Development | Local or developer-owned database |

Use different database instances, or at minimum different PostgreSQL databases, for
Production and Preview. Do not point Preview `DATABASE_URL` or `POSTGRES_URL` at
the production database.

Required non-secret safety variable:

| Variable | Environment | Purpose |
| --- | --- | --- |
| `DATABASE_ENVIRONMENT` | Production | Must be `production`. Labels the connected database as production. |
| `DATABASE_ENVIRONMENT` | Preview | Must be `preview`. Preview builds require this exact value before running migrations. |

Optional non-secret diagnostics:

| Variable | Environment | Purpose |
| --- | --- | --- |
| `PREVIEW_DATABASE_SIGNATURE` | Preview | Expected preview database identity in `host:port/database` format. Useful when the provider exposes distinct host/database names. |
| `PRODUCTION_DATABASE_SIGNATURE` | Preview and Production | Production database identity in `host:port/database` format. Useful when the provider exposes distinct host/database names. |

Prisma Postgres may show the same public signature for separate databases, such
as `db.prisma.io:5432/postgres`. In that case, signatures are only diagnostics;
`DATABASE_ENVIRONMENT` is the authoritative safety label.

You can print the current label and visible database identity with:

```bash
npm run db:safety-check
```

The script prints the database host and database name only; it does not print
credentials.

## Build Behavior

Vercel uses `npm run vercel-build`.

The build does this for every deployment:

```bash
npm run prisma:generate
next build
```

For Vercel Preview deployments only, the build also runs:

```bash
npm run db:safety-check -- --require-preview-db
npm run prisma:migrate:deploy
npm run preview:provision-teamship-user
```

Preview migrations run only after the safety check confirms
`DATABASE_ENVIRONMENT=preview`. Production deployments do not run Prisma
migrations automatically.

`preview:provision-teamship-user` is a no-op unless
`PREVIEW_TEAMSHIP_USER_EMAIL` is configured. When enabled, it requires
`PREVIEW_TEAMSHIP_ENTRA_TENANT_ID` and `PREVIEW_TEAMSHIP_ENTRA_OBJECT_ID`, and it
fails closed unless both `VERCEL_ENV` and `DATABASE_ENVIRONMENT` are `preview`.
It upserts only that passwordless Preview user, stable Teams identity, and a
least-privilege `READ_ONLY` membership when no membership exists. It never changes
an existing membership role. Never configure these variables for Production.

## Production Migrations

Production migrations are intentional. Before deploying application code that
depends on a new schema, run production migrations from a controlled environment
with the production `DATABASE_URL` set:

```bash
npm run db:safety-check
npm run prisma:migrate:deploy
```

Confirm `DATABASE_ENVIRONMENT=production` and verify the printed host and
database name before continuing. For Prisma Postgres, the visible host/database
may be shared across environments, so also confirm the credential source in the
database provider or Vercel environment.

## Create Or Reset The Preview Database

Create the preview database in the same provider as production, but keep it as a
separate instance or separate database. Name it clearly, for example
`newl_apps_preview` or `newl-apps-staging`.

To reset Preview:

1. Back up any preview data you need to keep.
2. Drop and recreate the preview database using the database provider's console
   or CLI.
3. Re-enter Preview `DATABASE_URL` and `POSTGRES_URL` in Vercel if the provider
   generated new connection strings.
4. Set Preview `DATABASE_ENVIRONMENT=preview`.
5. Optionally set `PREVIEW_DATABASE_SIGNATURE` to the printed
   `host:port/database` value.

Never reuse the production database URL when resetting Preview.

## Run Preview Migrations

For Vercel Preview deployments, migrations run during the build after the safety
check passes.

To run them manually against Preview:

```bash
npm run db:safety-check -- --require-preview-db
npm run prisma:migrate:deploy
```

If the safety check fails, fix the Preview environment variables before running
migrations.

## Seed Preview

After migrations have run, seed the preview database from a controlled shell with
Preview `DATABASE_URL` set:

```bash
npm run db:safety-check -- --require-preview-db
SEED_ADMIN_PASSWORD="preview-only-password" npm run prisma:seed
```

Use preview-only credentials and integration settings. Do not seed production
secrets, API keys, refresh tokens, or customer credentials into Preview.

## Test A Pull Request

1. Open the Vercel Preview URL for the PR.
2. Sign in using a provisioned preview test user.
3. Exercise the changed screens and workflows.
4. Confirm any new data appears only in the preview database.
5. Run any relevant smoke checks against the Preview URL or preview database.

If a Preview page errors after a schema change, check the Vercel build log for
the database safety check and Prisma migration output first.

## Hard Warning

Never point Preview `DATABASE_URL` or `POSTGRES_URL` to production. Preview builds
are allowed to run `prisma migrate deploy` after safety checks; a production URL
in Preview would risk migrating or writing to live data.
