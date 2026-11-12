# Project Explainer

A plain-English tour of the **Global Fleet Telemetrics & Predictive Maintenance Hub**. Read it top to bottom in
about ten minutes. For deeper detail see [docs/DEEP_DIVE.md](docs/DEEP_DIVE.md); to run the project see
[HOW_TO_RUN.md](HOW_TO_RUN.md).

---

## 1. What is this project?

A website for a fleet of vehicles. Every vehicle has sensors (engine temperature, speed, battery, brakes...) that
send readings all day. The website lets staff:

- **See a vehicle's readings** on a chart and in tables.
- **Search past failures by meaning.** Type "overheating engines in BMWs" and get the most similar past failures,
  even if they were written with different words.
- **Spot risky readings.** A card flags readings that look like past failures.
- **Manage maintenance tickets** (add, edit, delete). Admins can change things; viewers can only look.

The data is 1,970 sensor readings from 50 vehicles, and 35 of them are recorded failures.

---

## 2. The big picture

```
   Browser  ──────►  Next.js website  ──────►  MySQL   (the facts)
  (what you see)    (the "brain" in the        └─ vehicles, readings,
                     middle: checks login,        tickets, users, history
                     talks to databases)
                          │
                          └────────────────►  Qdrant  (the "meaning" index)
                                               └─ one list of numbers per ticket,
                                                  used to find similar tickets
```

Four pieces, each with one job:

| Piece | Its job, in one line |
|---|---|
| **Browser** | Shows pages. It never touches a database. |
| **Next.js** (runs on Node.js) | The middle layer. Checks who you are, fetches data, saves changes. |
| **MySQL** | Stores all the real records. It is the single source of truth. |
| **Qdrant** | Finds tickets that are similar in meaning to a sentence. |

---

## 3. Why two databases?

Because they answer two different kinds of questions.

- **MySQL is like a filing cabinet.** Great at exact questions: "show me vehicle VEH0026's readings", "who edited
  ticket 7?". It also protects the data (rules, history, who may change what).
- **Qdrant is like a librarian who understands meaning.** Great at fuzzy questions: "find failures like this
  one". A normal database can only match exact words.

### What each one stores

| MySQL stores | Qdrant stores |
|---|---|
| Vehicles (50) | One entry per ticket (35) |
| Sensor readings (1,970) | A list of 384 numbers that captures the ticket's *meaning* |
| Maintenance tickets with their full text (35) | A few labels: brand, vehicle, failure type |
| Users and a change history (audit) | **Not** the ticket text |

### How they are linked

Each ticket has a number (`ticket_id`). The same number is used as the id in Qdrant. So a search works in two
steps: Qdrant says "tickets 10, 11 and 31 are the closest", then MySQL supplies the full text of those tickets.

---

## 4. How it works, step by step

### Logging in
1. You type a username and password.
2. The website looks you up in MySQL and checks the password (stored scrambled, never in plain text).
3. It gives your browser a signed cookie saying who you are and whether you are an **admin** or **viewer**.

### Opening the Telemetry page
1. The website checks your cookie.
2. It asks MySQL for the vehicle's latest readings and daily summary.
3. The browser draws the chart and tables.

### Searching for similar failures
1. You type a sentence.
2. The website spots a brand if you mention one ("BMWs").
3. It turns your sentence into 384 numbers (this is called an *embedding*) using a small model running on your PC.
4. Qdrant returns the closest tickets, only from that brand if one was named.
5. MySQL supplies the readable details of those tickets, and you see the results.

### Adding, editing or deleting a ticket (admin)
The website updates **both** databases, always in the same order:

1. **MySQL first.** Save the change. (A built-in trigger automatically records who changed what.)
2. **Then Qdrant.** Re-create the ticket's numbers (or remove them if it was deleted).

If something fails halfway, MySQL is right and Qdrant is just out of date. Running `npm run db:seed` rebuilds
Qdrant from MySQL.

---

## 5. How the "prediction" works

Honest summary: it **compares recent readings with past failures**. It is not a trained forecasting model.

1. Take a vehicle's last 200 readings.
2. Mark readings that look unusual using simple rules (for example engine temperature above 104 °C, or battery
   voltage below 11.5 V). Normal readings stop here.
3. Describe each unusual reading in a sentence, turn it into numbers, and ask Qdrant for the 3 most similar past
   failures.
4. Turn the best similarity into a level: **normal, low, medium or high**.

**How reliable is it?** In a test, real failures scored clearly higher than normal readings, but about half of the
"high" flags were not real failures. Treat it as a hint about where to look first, not a forecast. The data is also
small (35 failures) and synthetic.

---

## 6. Database features you can point to

| Feature | What it does, simply |
|---|---|
| **Partitions** | The readings table is split into one piece per month, so a query for one day only reads one piece. |
| **JSON column** | The 27 minor sensors (oil pressure, wheel speeds...) are kept together in one flexible column. |
| **View** | `daily_fleet_stats` is a saved query that shows max speed and average temperature per vehicle per day. |
| **Constraints** | Rules the database enforces itself: no negative speed, valid latitude, no blank ticket text. |
| **Triggers (4)** | Code that runs automatically: two keep data consistent, two write the change history. |
| **Procedures & function** | Stored code: resolve a ticket, summarise the fleet, add a partition, count a vehicle's tickets. |
| **Roles** | The database itself decides who can read or write (see below). |
| **Advanced queries** | The SQL Analytics page runs examples of CTEs, a recursive CTE, subqueries and window functions. |

---

## 7. Who can do what

Two kinds of login, and **MySQL enforces it, not just the website**.

| | Admin | Viewer |
|---|---|---|
| See dashboards, search, view tickets | Yes | Yes |
| Add / edit / delete tickets | Yes | No |
| See the change history | Yes | No |

The website connects to MySQL using a different database account for each role. A viewer's account has no write
permission, so even a bug in the website could not let a viewer change data. (The **Try a write as viewer** button
on the Tickets page shows MySQL refusing it.)

---

## 8. Where things are

| I want to find... | Look here |
|---|---|
| Tables, triggers, procedures, the view | `sql/schema.sql` |
| Roles and permissions | `scripts/migrate.ts` |
| Loading the data | `scripts/seed.ts` |
| Pages and buttons | `src/app/` and `src/components/` |
| Add / edit / delete ticket logic | `src/app/tickets-actions.ts` |
| Search | `src/app/api/search/route.ts` and `src/lib/search.ts` |
| Risk scoring | `src/lib/risk.ts` |
| Login and permissions checks | `src/lib/auth.ts` |
| Settings and passwords | `.env` |

To look inside the databases: MySQL Workbench (host `127.0.0.1`, port `3307`, user `root`) or
`npm run db:shell`; Qdrant at http://localhost:6333/dashboard. Recipes for changing things are in
[docs/DEEP_DIVE.md](docs/DEEP_DIVE.md) section 12.

---

## 9. Good to know (limitations)

- **The two databases are not one transaction.** A crash between the two saves can leave Qdrant slightly out of
  date; MySQL stays correct. Re-seeding fixes it.
- **Typing SQL by hand does not update Qdrant.** Use the website for ticket changes.
- **Prediction is a demonstration**, based on 35 examples.
- **The data covers two days**, so only one monthly partition is in use.
- **MySQL has no BRIN index** (that is a PostgreSQL feature), so a normal index on the timestamp is used.

---

## 10. Quick answers

**Why use Qdrant at all? Couldn't MySQL search for words?**
MySQL matches exact words. Qdrant matches meaning, so "engine running hot" finds "overheating engine".

**Which database is the "real" one?**
MySQL. Qdrant can always be rebuilt from it.

**What is an embedding?**
A list of numbers that represents the meaning of a sentence. Similar sentences get similar numbers.

**How do both databases stay in step?**
Same id in both, MySQL is saved first, Qdrant second, and a re-seed rebuilds Qdrant if needed.

**Where is access control enforced?**
In three places: the page redirects you to log in, the code checks your role, and MySQL itself refuses forbidden
statements.

**Is the prediction real machine learning?**
No. It measures similarity to past failures. It is useful for prioritising, not for forecasting.

**Why did you partition the readings table?**
So time-based queries only read the relevant month, and old months could be dropped cheaply. `EXPLAIN` proves it.

**What does Node.js do here?**
It runs the website's server code and the setup scripts. It is not a database and stores nothing permanently.

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **Primary key** | A column that uniquely identifies each row. |
| **Foreign key** | A column pointing at a row in another table. |
| **Trigger** | Code the database runs automatically when data changes. |
| **Stored procedure** | Code saved inside the database that you run on demand. |
| **View** | A saved query that behaves like a table. |
| **Partition** | One physical piece of a big table (here, one month). |
| **Embedding** | A list of numbers representing the meaning of text. |
| **Vector database** | A database that finds the closest embeddings (Qdrant). |
| **Payload** | The small labels (brand, vehicle...) stored next to a vector. |
| **Server Action** | A function a button can call that always runs on the server. |
| **API route** | A web address that returns data (here: `/api/search`). |
