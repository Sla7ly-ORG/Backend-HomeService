# HomeServiceBackend

Express 5 + Prisma 7 + TypeScript, on PostgreSQL.

## Setup

Two ways in. Docker if you just want it running; local if you are writing code.

### Everything in Docker

`docker-compose.yml` on its own expects Postgres to already be running on the
host (see the comment at the top of that file) — that's how the deploy server
is set up, since it manages its own long-lived Postgres. On a fresh machine
without that, add the `docker-compose.local.yml` overlay, which brings up its
own Postgres container instead:

```bash
cp .env.example .env      # set DB_PASSWORD and JWT_SECRET
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

That brings up Postgres, applies the migrations in `prisma/migrations`, and
starts the API on <http://localhost:3000> — check
<http://localhost:3000/health/db>, and read the API at
<http://localhost:3000/docs>.

Everything comes from `.env` — `DB_PASSWORD` and `JWT_SECRET` are required,
and `PORT` only picks the *host* port (`PORT=8080` publishes the API on 8080).

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml logs -f app
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile seed run --rm seed # optional: fake data
docker compose -f docker-compose.yml -f docker-compose.local.yml down # add -v to drop the database too
```

If you already have Postgres running some other way, skip the overlay and
just run `docker compose up -d --build` with `DATABASE_URL` in `.env` pointed
at it instead.

### Locally, against a database in Docker

```bash
npm install
cp .env.example .env      # then edit DATABASE_URL, and set DB_PASSWORD/JWT_SECRET
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d postgres
npm run prisma:migrate    # create the schema + generate the client
npm run prisma:seed       # optional: fill the database with fake data
```

`JWT_SECRET` has no default on purpose — the server refuses to start without
one, because a shared or guessable signing key means anyone can mint an admin
token. Generate yours with:

```bash
node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
```

### Fake data

`npm run prisma:seed` (or `npx prisma db seed`) wipes every table and refills it
with a consistent dataset — categories with pricing bands, customers and
technicians at every stage of onboarding, service requests in every status with
their offers, estimations and reviews. The random generator is seeded, so every
run produces the same rows; edit `CONFIG` at the top of `prisma/seed.ts` to
change the volume. Three accounts always exist for manual testing:

| Phone | Who |
| --- | --- |
| `+201000000001` | admin |
| `+201000000002` | customer, ACTIVE |
| `+201000000003` | technician, VERIFIED |

## Run

```bash
npm run dev               # tsx watch, reloads on change
npm run typecheck         # run this before every commit
npm run build && npm start
```

## How the code is organised

Two ideas, and everything follows from them.

**1. Features are slices.** All the code for one feature lives in one folder
under `src/modules/`. To work on users you open `src/modules/users/` and stay
there. Nothing about users is scattered anywhere else.

**2. Routes are grouped by audience** — by *who each endpoint is for*.

| Prefix               | Audience         | Guard                                |
| -------------------- | ---------------- | ------------------------------------ |
| `/api/v1/public`     | anyone           | none — login, refresh, categories; `/uploads` is the one exception and needs a token |
| `/api/v1/me`         | the caller       | `requireAuth`                        |
| `/api/v1/customer`   | customer-facing  | `requireAuth` + `requireRole("CUSTOMER")` |
| `/api/v1/technician` | technician-facing | `requireAuth` + `requireRole("TECHNICIAN")` |
| `/api/v1/admin`      | back-office      | `requireAuth` + `requireRole("ADMIN")` |

That grouping is what makes access control a five-line file: the guards are
applied once per group in `src/api/index.ts`, and **no route, service, schema
or mapper checks permissions itself**. One place to read to know who can call
what, one place to get it wrong.

```
src/
  index.ts                    starts the server, graceful shutdown
  app.ts                      express app: json, health, mounts /api/v1

  api/                        the URL map — which module answers which path
    index.ts                  ⭐ audience prefixes + the auth guards
    public.ts  me.ts  customer.ts  technician.ts  admin.ts

  docs/                       the /docs Swagger page
    openapi.ts                the document: one entry per endpoint
    openapi.components.ts     shared schemas + zod → JSON Schema
    docs.routes.ts            serves the page and /docs/openapi.json

  modules/                    the features
    users/                    ⭐ the reference — copy this one
      users.schema.ts         zod: every shape the API accepts
      users.service.ts        all database access + rules
      users.mapper.ts         database row → JSON response
      users.state.ts          which onboarding screen comes next
      users.admin.routes.ts   endpoints for the admin audience
      users.me.routes.ts      the caller's own account, incl. POST /me/signup
      users.customer.routes.ts   the customer profile page
    auth/                     phone + OTP login, and JWT
      auth.service.ts         codes, expiry, attempt limits, refresh
      auth.tokens.ts          signs and verifies the tokens
      auth.middleware.ts      ⭐ requireAuth / requireRole / currentUser
      auth.sms.ts             ⚠️ where a real SMS provider plugs in
    categories/               the fields a job can be in (task 1)
    technicians/              documents, and the admin approval queue
    uploads/
      uploads.storage.ts      where files go: limits, renaming, cleanup
      uploads.public.routes.ts   the standalone upload endpoint
    points/                   🔨 task 6 — the wallet the AI estimate spends
    requests/                 🔨 tasks 7, 8, 10 & 11 — the customer's problem
    ai/
      ai.client.ts            🔨 task 8 — ⚠️ the only file that knows the model
    offers/                   🔨 tasks 10 & 11 — fan-out, fees, choosing one

  realtime/                   🔨 task 9 — the live feed, over Socket.IO
    realtime.events.ts        ⭐ the event contract: names, rooms, payloads
    realtime.auth.ts          the handshake guard — requireAuth's twin
    realtime.server.ts        the io instance, sharing the HTTP port
    realtime.emit.ts          the only file the offer modules import

  core/                       shared plumbing, used by every module
    env.ts                    validated environment variables
    prisma.ts                 PrismaClient singleton
    fields.ts                 field rules shared by modules (phone, id)
    messages.ts               every sentence the API says, in Arabic
    zod-arabic.ts             Arabic wording for zod's own messages
    errors.ts                 ApiError
    error-handler.ts          turns any error into a JSON response
    pagination.ts             ?page= & ?limit= helpers
    geo.ts                    🔨 task 10 — how far away a technician is
    serialize.ts              lets JSON.stringify handle BigInt ids

  generated/prisma/           generated client (gitignored, don't edit)
prisma/schema.prisma          data model
scripts/socket-test.mjs       prints every socket event sent to one user
```

Inside a module each file has one job, and they call each other in one
direction only:

```
routes  →  service  →  database
   ↓
 mapper (shapes the response)
```

- **routes** — read the request, call a service, send a response. No SQL here.
- **service** — all Prisma queries and rules. No `req`/`res` here, which is
  what makes it reusable and easy to test.
- **schema** — validation. A route's first line is usually `schema.parse(...)`.
- **mapper** — decides which columns the outside world sees.

## Endpoints

Everything outside `/public` needs `Authorization: Bearer <accessToken>`, which
you get from `verify-otp`. See [Authentication](#authentication) below.

**Start the server and open <http://localhost:3000/docs>** — a Swagger page with
every endpoint, its exact request body, its responses, and a **Try it out**
button that calls the real API. Log in with `request-otp` + `verify-otp`, press
**Authorize**, paste the access token, and the rest of the page works.

The OpenAPI 3.1 document behind it is at `/docs/openapi.json`: point Postman,
Insomnia or a client generator at that URL instead of writing requests by hand.
Request bodies and query strings are generated from the same zod schemas the
routes validate with, so the page cannot drift from the code — see
[`src/docs/`](src/docs/). 🔨 marks an endpoint that is scaffolded but not
implemented yet.

Three written docs, three audiences:

| Doc | For | Contains |
| --- | --- | --- |
| [`docs/APP-FLOW.md`](docs/APP-FLOW.md) | the app team | every screen, the call it makes, what to do with the answer — signup, then ordering a service, then the socket events |
| [`docs/INTERN-TASKS.md`](docs/INTERN-TASKS.md) | whoever is writing endpoints | the 67 items still to implement, in 6 tasks, with acceptance tests |
| [`docs/ONBOARDING-FLOW.md`](docs/ONBOARDING-FLOW.md) | anyone changing the design | why the flow works the way it does |

**Phone login** — how a user signs up and signs in.

| Method | Path                              | Auth | Description                              |
| ------ | --------------------------------- | ---- | ---------------------------------------- |
| POST   | `/api/v1/public/auth/request-otp` | —    | `{ phone }` → sends a 6-digit code       |
| POST   | `/api/v1/public/auth/verify-otp`  | —    | `{ phone, otpCode }` → the user + `accountState` + **tokens** |
| POST   | `/api/v1/public/auth/refresh`     | —    | `{ refreshToken }` → a fresh pair of tokens |
| GET    | `/api/v1/me`                      | any  | who am I + `accountState` (+ technician profile) |
| PATCH  | `/api/v1/me/role`                 | any  | `{ role }` → customer or technician branch |
| POST   | `/api/v1/me/signup`               | any  | the whole of onboarding in one `multipart/form-data` call |

These return an `accountState` telling the app which screen comes next:
`COMPLETE_PROFILE` (customer → profile page), `SUBMIT_DOCUMENTS` (technician →
national ID + criminal record form), `WAITING_FOR_APPROVAL`,
`VERIFICATION_REJECTED`, `READY`, `BLOCKED`, `SUSPENDED`.

The code is valid 5 minutes, single use; 60s between resends; 5 wrong guesses
locks the phone for 15 minutes. There's no SMS provider yet, so the code is
printed in the `npm run dev` terminal and returned as `devOtpCode` (never in
production).

**After the code, two ways to finish the account** — both supported, both
ending in the same rows:

- *Step by step*: `PATCH /me/role`, then `POST /customer/profile` or
  `POST /technician/profile` (which takes URLs from `POST /public/uploads`).
- *All at once*: `POST /me/signup`, one `multipart/form-data` request carrying
  the profile, the role, and — for a technician — `categoryId`, the 14-digit
  `nationalId` as text, plus the `criminalRecordFile` / `profileImage` **files
  themselves**. A customer sends no files, so plain JSON works for them too.

Uploads are JPEG, PNG or PDF, at most 5 MB, renamed by the server and written
to `UPLOAD_DIR` (default `uploads/`), then served back under `/uploads/…` with
`nosniff` (and `Content-Disposition: attachment` for PDFs). The rules live in
one place, `src/modules/uploads/uploads.storage.ts`.

Two limits worth knowing before this carries real identity documents: the URL
is the only thing guarding a file, and nothing is ever deleted — see
[`docs/ONBOARDING-FLOW.md`](docs/ONBOARDING-FLOW.md#what-the-upload-path-does-and-does-not-protect-against).

`docs/ONBOARDING-FLOW.md` has the field-by-field table for both routes.

**Users** — admin only, so every call needs an admin's token.

| Method | Path                            | Description                            |
| ------ | ------------------------------- | -------------------------------------- |
| GET    | `/api/v1/admin/users`           | List users (paginated + filters)       |
| GET    | `/api/v1/admin/users/:id`       | One user                               |
| POST   | `/api/v1/admin/users`           | Create a user                          |
| PATCH  | `/api/v1/admin/users/:id`       | Update name / phone / city / address / location |
| PATCH  | `/api/v1/admin/users/:id/status`| Activate / block / suspend             |
| DELETE | `/api/v1/admin/users/:id`       | Soft delete (204)                      |

`GET /admin/users` accepts `?page=` `?limit=` (max 100) `?role=` `?status=`
`?city=` and `?search=` (matches full name or phone).

Health checks sit outside the API: `GET /health` and `GET /health/db`.

### Responses

Success — a single object under `data`, lists add `meta`:

```jsonc
{ "data": { "id": "2", "fullName": "Mona Ali", "role": "CUSTOMER", ... } }

{ "data": [ ... ], "meta": { "page": 1, "limit": 20, "total": 3, "totalPages": 1 } }
```

Errors — always the same shape, so the mobile app can handle them in one place:

```jsonc
{ "error": { "code": "validation_error", "message": "...", "details": [ ... ] } }
```

`400` invalid body/query · `401` missing/expired token · `403` wrong role or a
blocked account · `404` missing · `409` duplicate phone · `500` bug.

`message` is Egyptian Arabic and ready to show to the user as-is — the app ships
in Egypt, so there is one locale and no switcher. `code` is English and stable:
switch on it, never on the wording, which is free to change. Same split inside
`details`, where `field` is the English JSON field name and `message` is Arabic.
All of the copy lives in `src/core/messages.ts` — reword it there, not at the
`throw`.

### Try it

Log in as the seeded admin first — the code is printed by `npm run dev` and
also comes back as `devOtpCode`:

```bash
API=localhost:3000/api/v1

curl -X POST $API/public/auth/request-otp \
  -H 'content-type: application/json' -d '{"phone":"+201000000001"}'

TOKEN=$(curl -s -X POST $API/public/auth/verify-otp \
  -H 'content-type: application/json' \
  -d '{"phone":"+201000000001","otpCode":"PASTE-THE-CODE"}' \
  | jq -r .data.tokens.accessToken)
```

Then every other call carries it:

```bash
curl $API/me -H "Authorization: Bearer $TOKEN"

curl "$API/admin/users?role=TECHNICIAN&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"

curl -X POST $API/admin/users -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"fullName":"Mona Ali","phone":"+201112223334","role":"CUSTOMER",
       "city":"Giza","address":"12 Nile St","latitude":30.0131,"longitude":31.2089}'

curl -X PATCH $API/admin/users/1/status -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"status":"ACTIVE"}'
```

## Authentication

Phone + OTP gets you in; a JWT keeps you in.

```
POST /public/auth/verify-otp   →  { user, accountState, tokens }
                                     tokens.accessToken   15 min, sent on every call
                                     tokens.refreshToken  30 days, only sent to /refresh
```

Every call outside `/api/v1/public` carries the access token:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs…
```

When it expires (`401`), `POST /public/auth/refresh` with the refresh token
returns a fresh pair. When *that* expires, the user logs in with a new SMS.
Both lifetimes are configurable — `ACCESS_TOKEN_TTL_MINUTES`,
`REFRESH_TOKEN_TTL_DAYS`.

### The three pieces

| File | Job |
| ---- | --- |
| `modules/auth/auth.tokens.ts` | signs and verifies tokens. No database, no `req` |
| `modules/auth/auth.middleware.ts` | `requireAuth`, `requireRole`, `currentUser(req)` |
| `api/index.ts` | applies them, once per audience group |

**Reading the caller inside a route** — never from the body, never from the URL:

```ts
import { currentUser } from "../auth/auth.middleware.js";

techniciansTechnicianRoutes.post("/", async (req, res) => {
  const body = createTechnicianProfileBody.parse(req.body);
  await techniciansService.createTechnicianProfile(currentUser(req).id, body);
});
```

`currentUser(req)` returns the full `User` row and is never null on a route
behind `requireAuth`. That is why no endpoint takes a `userId` field: it would
let a caller act as somebody else.

### Design notes

- **The token carries only `sub` (the user id).** No role, no status. Both
  change *during* a session — a user picks TECHNICIAN minutes after logging in,
  an admin blocks someone mid-session — so `requireAuth` re-reads the user row
  on every request. One extra query, and the guards are never stale.
- **Blocking works immediately.** `BLOCKED`/`SUSPENDED` is rejected on every
  request and on refresh, so a blocked account cannot renew its session.
- **PENDING users get tokens too.** Onboarding itself is authenticated
  (`PATCH /me/role`, `POST /customer/profile`, `POST /me/signup`), so the
  session has to start before the profile is finished. Only the role guards
  apply there — which is why signup is on `/me`, the one group without one:
  the role it sets cannot also be the role it checks.
- **There is no session table, so an access token cannot be revoked before it
  expires** — that is why it is short. Changing `JWT_SECRET` invalidates
  everything at once, which is the only "log everyone out" button today. If
  per-device revocation is ever needed, store refresh tokens and check them in
  `refreshSession`.

## Adding a new feature

Say you're adding categories:

1. `mkdir src/modules/categories`
2. Write `categories.schema.ts`, `categories.service.ts`, `categories.mapper.ts`.
3. Add a routes file per audience that needs it —
   `categories.admin.routes.ts` (manage), `categories.public.routes.ts` (browse).
4. Mount each one in its audience file: `adminRouter.use("/categories", ...)`
   in `src/api/admin.ts`.
5. Add an entry per endpoint to `src/docs/openapi.ts` — reuse the zod schema for
   the request (`fromZod(createCategoryBody)`) so it can never disagree with
   what the route accepts.
6. `npm run typecheck`.

Copy the `users` module — it is the reference implementation.

## Things worth knowing

- **Ids are `BigInt`** and are sent as **strings** in JSON, because they don't
  fit in a JavaScript number. In code they're `bigint`, so write `1n` not `1`.
- **Users are soft-deleted.** `DELETE` sets `deleted_at`; the row stays. Every
  query must therefore filter `deletedAt: null` — the service does this with a
  shared `notDeleted` constant. Forgetting it leaks deleted users.
- **Never `try`/`catch` in a route.** Express 5 forwards rejected promises to
  the error handler, which already knows how to turn `ZodError`, `ApiError` and
  Prisma errors into the right status code. Just `throw`.
- **Money is `Decimal`**, never a float. Send it as a string.
- Prisma 7 connects through a **driver adapter** (`@prisma/adapter-pg`), set up
  in `src/core/prisma.ts`. The `datasource` block has no `url`; the connection
  string is read from `DATABASE_URL` at runtime.
- Prisma 7 doesn't load `.env` itself — `core/env.ts` and `prisma.config.ts` do
  it, and `core/env.ts` exits with a clear message if a variable is missing.
- **`sslmode` is read differently by the two halves of Prisma.** The CLI and
  Studio follow libpq (`require` = encrypt, don't verify); node-postgres, which
  the driver adapter runs on, reads `require` as `verify-full` and rejects a
  self-signed certificate. `DATABASE_URL` is written the libpq way, and
  `src/core/db-url.ts` translates it for the adapter. Symptom if it goes wrong:
  the app fails with `self-signed certificate`, or Studio shows "Could not load
  schema metadata".
