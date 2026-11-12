# How to Run

Everything runs locally on Windows. No Docker, no installers, no admin rights.

## 0. One-time prerequisites

- **Node.js 20 or newer** (check with `node -v`).
- The folder `tools/` must contain the two database programs (already there if you were handed this project):
  - `tools/mysql-8.4.11-winx64/` (MySQL, portable ZIP)
  - `tools/qdrant/qdrant.exe` (Qdrant, Windows build)
- An internet connection **the first time only** (npm packages and the ~25 MB embedding model).

## 1. First-time setup (do these once)

Open a terminal **in the project folder** and run the commands in order.

```bash
npm install            # 1. install packages
```

2. **Only if there is no `.env` file yet**, create one with `copy .env.example .env` and replace every `change_me`
   with a password you choose. **If `.env` already exists, do not run `copy` again**: it would overwrite your
   passwords with `change_me`, and the website would fail with "Access denied for user 'fleet_auth'".
   (If you ever change passwords in `.env`, run `npm run db:migrate` and `npm run db:seed` afterwards so MySQL
   and the logins pick them up.)

Then:

```bash
npm run db:up          # 3. start MySQL (port 3307) and Qdrant (port 6333)
npm run db:migrate     # 4. create the tables, triggers, procedures, view and database roles
npm run db:seed        # 5. load the CSV, create tickets, build the vectors in Qdrant, create the logins
npm run dev            # 6. start the website
```

Open **http://localhost:3000** and sign in:

| Username | Password | Can do |
|---|---|---|
| `admin` | value of `APP_ADMIN_PASSWORD` in `.env` (default dev value `admin123`) | everything, including add/edit/delete tickets |
| `viewer` | value of `APP_VIEWER_PASSWORD` in `.env` (default dev value `viewer123`) | read only |

Expected output of the seed step:

```
Read 1970 rows ...
Partitions ensured for: 2023-01
Inserted 50 fleet_assets
Inserted 1970 telemetry_logs
Inserted 35 maintenance_tickets
Upserted 35 vectors into Qdrant collection "failure_reports"
```

## 2. Every later session (databases already set up)

Your data is kept on disk, so you only start things again:

```bash
npm run db:up    # start MySQL + Qdrant
npm run dev      # start the website  ->  http://localhost:3000
```

When finished:

```bash
npm run db:down  # stop MySQL + Qdrant   (Ctrl+C stops the website)
```

## 3. Quick demo path (what to click)

1. **Telemetry**: pick a vehicle, see the **Failure risk** card (nearest-neighbour similarity to past failures;
   try `VEH0026` for several HIGH rows), the chart, the daily-stats table and the latest readings.
2. **Predictive Maintenance Search**: search `Search for overheating engines in BMWs`. The result header shows
   `Brand filter: BMW`.
3. **Tickets** (as admin): add a ticket, edit its text, click **Vector** to see its Qdrant point, click **Resolve**,
   then **Delete**. The audit table at the bottom fills in by itself.
4. **SQL Analytics**: click **Run** on each card (recursive CTE, correlated subquery, window function, procedure...).
5. Log out, sign in as `viewer`: no edit buttons. Click **Try a write as viewer** to see MySQL refuse it.

## 3b. Open the database and make changes

```bash
npm run db:shell                                   # MySQL prompt (root); type SQL ending in ;  and  exit  to leave
npm run db:shell -- -Query "SHOW TRIGGERS"         # run one statement
npm run db:shell -- -File my_changes.sql           # run a .sql file
npm run db:shell -- -Role viewer                   # log in as the read-only account
```

To look at the vectors, open **http://localhost:6333/dashboard** (Qdrant's web UI) and go to
Collections, `failure_reports`. For the MySQL tables use MySQL Workbench: host `127.0.0.1`, port `3307`, user `root`.

Which file holds which table, trigger, procedure or query, and step-by-step recipes for changing them, are in
`docs/DEEP_DIVE.md` section 12.

## 4. Reset everything

```bash
npm run db:reset   # drops and rebuilds the MySQL database and roles
npm run db:seed    # reload data and vectors
```

## 5. Checks

```bash
npm run typecheck  # TypeScript check
npm run lint
npm run build      # production build
```

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| Website shows a database error or redirects oddly | Databases are not running: `npm run db:up` |
| `db:up` says MySQL did not start | Read `%USERPROFILE%\fleet-hub-db\mysql\error.log` |
| `ECONNREFUSED 127.0.0.1:3307` | Same as above: run `npm run db:up` |
| Port 3000 already in use | Stop the other app, or run `npx next dev -p 3001` |
| Port 3307 or 6333 in use | Change `MYSQL_PORT` in `.env` (Qdrant's port is fixed at 6333) |
| `Access denied for user` | `.env` passwords changed after the first migrate: run `npm run db:reset` then `npm run db:seed` |
| Search returns an error | Qdrant is down or not seeded: `npm run db:up`, then `npm run db:seed` |
| Seed is slow the first time | It is downloading the embedding model once; later runs are fast |
| Login says invalid password | You changed `.env` after seeding: run `npm run db:seed` again |

Notes: another MySQL may already be installed on this PC on port 3306. This project uses port **3307** and does not
touch it. MySQL's data lives in `%USERPROFILE%\fleet-hub-db` (not inside the project) because MySQL will not start
from a folder path that contains spaces.
