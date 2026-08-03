# Forge — D1 migrations

Forge's database runs on Cloudflare D1 (SQLite-compatible) when deployed to
Cloudflare Workers, and on local SQLite for dev/VPS.

## Generating the initial D1 schema

The schema is generated from `prisma/schema.prisma` (provider = sqlite, which
is D1-compatible). Run:

    bun run db:gen:d1

This runs `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`
and writes the SQL to `prisma/d1-init.sql`.

## Applying to the D1 database

    bun run db:apply:d1

This runs `wrangler d1 execute forge-db --file prisma/d1-init.sql`, creating
all tables in the `forge-db` D1 database (database_id
0968a1bd-34e5-4524-8ed5-894fc98bd541).

## Notes

- Requires `prisma` and `wrangler` installed (bun install).
- Requires `wrangler` to be authenticated (wrangler login) or
  CLOUDFLARE_API_TOKEN set.
- The D1 binding name is `DB` (see wrangler.jsonc).
- For local dev, the regular `bun run db:push` against SQLite still works.
