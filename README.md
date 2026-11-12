# Global Fleet Telemetrics & Predictive Maintenance Hub

Next.js (App Router) + Tailwind, Drizzle ORM on **MySQL 8.4**, **Qdrant** for semantic vector search.
No Docker needed: portable MySQL and Qdrant binaries are started by a script.

## Setup (Windows)

1. Put the unzipped binaries in `tools/`:
   - `tools/mysql-8.4.x-winx64/` (MySQL Community ZIP from dev.mysql.com)
   - `tools/qdrant/qdrant.exe` (Windows build from github.com/qdrant/qdrant/releases)
2. `copy .env.example .env` and set the passwords.
3. Run:

```bash
npm install
npm run db:up        # starts MySQL (port 3307) and Qdrant (port 6333)
npm run db:migrate   # schema, triggers, routines, view, roles/users   (db:reset = rebuild from scratch)
npm run db:seed      # 1,970 telemetry rows, tickets, embeddings -> Qdrant, web users
npm run dev          # http://localhost:3000
npm run db:down      # stop both databases
```

Logins (from `.env`): `admin` / `APP_ADMIN_PASSWORD` (can write) and `viewer` / `APP_VIEWER_PASSWORD` (read-only).
MySQL data is kept in `%USERPROFILE%\fleet-hub-db` (mysqld will not start from a path containing spaces).
The first seed downloads the local embedding model (`Xenova/all-MiniLM-L6-v2`, ~25 MB). Set
`EMBEDDING_PROVIDER=openai` and `OPENAI_API_KEY` to use `text-embedding-3-small` instead (re-seed afterwards).

## Rubric map

| Rubric item | Where |
|---|---|
| ER diagram, relational schema, constraints, technology justification | `docs/ER_DIAGRAM.md` |
| SQL DDL with constraints | `sql/schema.sql` (PK/FK/UNIQUE/CHECK/ENUM, RANGE partitioning, JSON) |
| Vector DB creation | `scripts/seed.ts` (Qdrant collection, cosine, `brand` payload index) |
| DML | Tickets page: INSERT / UPDATE / DELETE (`src/app/tickets-actions.ts`), seeding |
| Nested / correlated / recursive queries, joins | `src/lib/analytics-queries.ts`, shown live on the **SQL Analytics** page |
| Procedure / function / trigger / CTE | `sql/schema.sql`: `sp_resolve_ticket`, `sp_fleet_summary`, `ensure_telemetry_partition`, `fn_failure_count`, 4 triggers, CTEs in analytics |
| Vector feature with RUD | Create/update/delete ticket re-embeds / removes the Qdrant point; **Vector** button reads the point; search page does filtered similarity search |
| Next.js interface | `src/app/**`, `src/components/**` |
| Backend/API + DB integration | Server Actions (`src/app/*-actions.ts`), `POST /api/search` |
| Authentication + two roles + RBAC in the database | `/login`, signed session cookie, MySQL roles `fleet_admin_role` / `fleet_viewer_role` / `fleet_auth_role` (`scripts/migrate.ts`) |

## Notes and deviations from the original brief

- The brief's PostgreSQL features were replaced because the SQL database is MySQL: RANGE partitioning is kept;
  BRIN does not exist in MySQL, so a B-tree index on `timestamp` is used; JSONB became `JSON`.
- MySQL cannot put foreign keys on a partitioned table, so `telemetry_logs.asset_id` is checked by a trigger.
- The dataset covers 2023-01-01 to 2023-01-02, so all rows land in one monthly partition (`p202301`).
  `ensure_telemetry_partition()` splits `pmax` to add later months.
- `telemetry_logs` has `engine_temp_c`, `engine_rpm` and `odometer` as real columns (the daily-stats view uses them).
- Tickets are created for the 35 rows whose `failure_type` is not `No Failure`.
- A brand named in the search query (e.g. "BMWs") becomes a Qdrant payload filter.
