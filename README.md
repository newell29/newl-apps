# Newl Apps

Internal-first, SaaS-ready app platform for logistics operations.

## Purpose

Newl Apps will host internal Newl Group tools such as Apollo + TradeMining lead generation, UPS calculators, transit time lookup, invoice verification, QuickBooks posting, and future sales, finance, and operations modules.

The platform must be multi-tenant from day one so individual modules can later be offered to other logistics companies as SaaS products.

## Initial Foundation

- `AGENTS.md` contains project instructions for future coding sessions.
- `reference/OPENCLAW_LEAD_GEN_SPEC.md` documents the current OpenClaw, Google Sheets, Apollo, and TradeMining workflow.
- `reference/MIGRATION_PLAN.md` contains the first migration path from the current workflow to Newl Apps.
- `.env.example` lists expected environment variable names with placeholders only.

## Architecture Principles

- Every major business table includes `tenantId`.
- Newl Group is the first seeded tenant, not a hardcoded business logic assumption.
- Modules are separated by entitlement so tenants can enable only the apps they need.
- Integration credentials are tenant-scoped.
- Permissions support Admin, Manager, Sales, Operations, Finance, and Read Only roles.
- All queries must be tenant-safe.

## Status

Repository foundation only. Application code will be added after GitHub setup.
