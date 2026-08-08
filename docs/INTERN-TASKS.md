# What to build

98 items, 11 tasks — tasks 1 to 5 are done, so 67 are left, all in the second half.

**Every task is scaffolded.** The files exist, they are plugged into the API,
and each function has a `throw ApiError.notImplemented()` where your code goes
above a `TODO(task N)` comment naming the Prisma calls and the traps. Nothing
needs creating or wiring: open the file, delete the throw, write the body.

**Tasks 1–5 get a user into the app.** **Tasks 6–11 are the app itself** —
ordering a service.

Every URL in this document already answers `501 not_implemented` today, so the
app team can wire their screens up against them before you have written a line.

| Task | What | Items | Who |
| ---- | ---- | ----- | --- |
| 1 | Categories | 13 | ✅ done |
| 2 | Customer profile | 3 | ✅ done |
| 3 | Technician profile | 5 | ✅ done |
| 4 | File upload | 3 | ✅ done |
| 5 | Admin approval | 7 | ✅ done |
| 6 | Points wallet | 15 | |
| 7 | Service request + past orders | 15 | |
| 8 | AI estimation | 7 | |
| 9 | The live channel (Socket.IO) | 6 | |
| 10 | Publish + the technician's feed | 18 | |
| 11 | Choosing a technician | 6 | |

Order: **6 → 7 → 8 → 9 → 10 → 11.** Tasks 1 to 5 are finished; read them as the
worked examples — `src/modules/users/` for the shape, task 5 for a two-row
transaction, task 4 for a file. The rest is a chain: 8 spends what 6 built, 10
publishes what 7 created and pushes it down the socket 9 opened, 11 finishes
what 10 started.

Task 9 is the one that can be done out of order — it is a channel with no
opinions about what goes through it, so it can be built alongside 7 and 8 by a
second person. Tasks 10 and 11 both depend on it.

## Setup

```bash
npm install
cp .env.example .env      # set JWT_SECRET, any 32+ random characters
docker compose up -d
npm run prisma:migrate
npm run prisma:seed       # gives you the three test accounts below
npm run dev
```

### Getting a token

Every endpoint outside `/public` needs one. Two calls — the code is printed by
`npm run dev` and also comes back as `devOtpCode`:

```bash
API=localhost:3000/api/v1
PHONE=+201000000001      # the seeded admin; …02 customer, …03 technician

curl -X POST $API/public/auth/request-otp \
  -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}"

ADMIN_TOKEN=$(curl -s -X POST $API/public/auth/verify-otp \
  -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"otpCode\":\"PASTE-THE-CODE\"}" \
  | jq -r .data.tokens.accessToken)
```

It lasts 15 minutes; after that you get `401` and either refresh
(`POST /public/auth/refresh`) or repeat the two calls above.

## Copy this

**`src/modules/users/`** is the finished example. Keep it open next to your work.

```
routes  →  service  →  database
   ↓
 mapper
```

| File | Job | Never has |
| ---- | --- | --------- |
| `*.schema.ts` | what the API accepts (zod) | logic |
| `*.service.ts` | Prisma queries | `req`, `res` |
| `*.mapper.ts` | row → JSON | queries |
| `*.routes.ts` | request in, response out | SQL |

## Rules

- No `try`/`catch` in routes. Just `throw ApiError.notFound("…")`.
- Never take a `userId` from the body or the URL. `currentUser(req).id` — the
  guards in `src/api/index.ts` already know who is calling.
- Let Prisma throw. Duplicate → 409, missing → 404, bad FK → 409. Don't pre-check.
- IDs are BigInt. Parse with `idParams`, return with `.toString()`.
- Money → string, never a float.
- Reading users? Filter `deletedAt: null`.
- Never hardcode an `accountState` — call `resolveAccountState()`.
- **Never `await` an HTTP call inside a `$transaction`.** It holds a Postgres
  connection open for as long as somebody else's server takes to answer.
- **Emit after the commit, never inside it**, and never let a failed emit fail a
  request that already succeeded.
- `npm run typecheck` must pass.

---

# Task 1 — Categories ✅ done

The list of fields (plumbing, electrical…) shown on screen 3, plus admin
management. Start here.

**`categories.schema.ts`**

- [x] `createCategoryBody` — `name` (2–100), `homeVisitBasePrice` (positive, 2dp)
- [x] `updateCategoryBody` — both optional, reject `{}`. Copy `updateUserBody`.

**`categories.service.ts`**

- [x] `listCategories()` — all, ordered by name. No pagination.
- [x] `getCategoryById(id)` — or `throw ApiError.notFound("Category not found")`
- [x] `createCategory(data)` — `name` is unique, duplicates 409 by themselves
- [x] `updateCategory(id, data)` — missing row 404s by itself
- [x] `deleteCategory(id)` — real delete. In use → 409, which is correct.

**`categories.mapper.ts`**

- [x] `toCategoryResponse(category)` — id as string, price as string

**`categories.public.routes.ts`**

- [x] `GET /` → `{ data: [...] }`, no `meta`

**`categories.admin.routes.ts`**

- [x] `GET /:id` → 200
- [x] `POST /` → 201
- [x] `PATCH /:id` → 200
- [x] `DELETE /:id` → 204, empty

The price is capped at `99999999.99` to match the `Decimal(10, 2)` column, so an
oversized price is a 400 rather than a 500. The Swagger bodies for these two
endpoints are generated from the zod schemas with `fromZod`, so the constraints
above only need changing in one place.

### Test it

```bash
curl -X POST localhost:3000/api/v1/admin/categories \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"Plumbing","homeVisitBasePrice":150}'      # 201
curl localhost:3000/api/v1/public/categories             # 200, array (no token)
# repeat the POST                                        → 409
curl localhost:3000/api/v1/admin/categories/9999 \
  -H "Authorization: Bearer $ADMIN_TOKEN"                # 404
```

Price must come back as `"150.00"`. If you see `150`, fix the mapper.

---

# Task 2 — Customer profile ✅ done

Screen 5a. Fills in the blanks left after OTP and flips the user to `ACTIVE`.

> It does **not** create a user — that row already exists.

**`users.schema.ts`** (add to the existing file)

- [x] `createCustomerProfileBody` — just the exported `profileFields`
      (fullName, city, address, latitude, longitude). Reuse them, don't retype.
      No `userId`: it comes from the token.

**`users.service.ts`** (add to the existing file)

- [x] `completeCustomerProfile(userId, data)` — write the fields **and**
      `status: "ACTIVE"` in one update. Reuse `updateUserFields`. 409 if the
      user isn't `PENDING` — copy `selectRole`.

**`users.customer.routes.ts`**

- [x] `POST /` → 201 `{ data: { user, accountState, message } }`.
      State from `resolveAccountState(user, null)`, id from
      `currentUser(req).id` (`modules/auth/auth.middleware.js`).

### Test it

```bash
# TOKEN comes from verify-otp — see "Getting a token" at the top.
curl -X POST localhost:3000/api/v1/customer/profile \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"fullName":"Mona Ali","city":"Giza",
       "address":"12 Nile St","latitude":30.0131,"longitude":31.2089}'
```

201 with `"accountState":"READY"`. Same call again → 409. Log in again → `READY`.
No token → 401. A technician's token → 403.

---

# Task 3 — Technician profile ✅ done

Screen 5b. Personal details **and** documents in one form. Already written —
read it before starting task 2, it is the same job with a bigger payload.

**`technicians.schema.ts`**

- [x] `createTechnicianProfileBody` — `profileFields` (imported from
      `users.schema.ts`), `categoryId`, `nationalId` (the 14 digits as text —
      `nationalIdField` from `core/national-id.ts` checks them), optional
      `criminalRecordFile` and `profileImage`. No `userId` — the route passes
      `currentUser(req).id` to the service.

**`technicians.service.ts`**

- [x] `createTechnicianProfile(userId, data)` — **one `prisma.$transaction`**:
      1. `tx.user.update` — profile fields + `role: "TECHNICIAN"`
      2. `tx.technicianProfile.create` — `verificationStatus: "PENDING"`

      Leave `status` as `PENDING`. Return the user **and** the profile.
- [x] `findTechnicianProfileByUserId(userId)` — row or `null`

**`technicians.mapper.ts`**

- [x] `toTechnicianProfileResponse(profile)` — ids as strings, rating as string.
      **No `nationalId`, no `criminalRecordFile`** — admin-only, task 5.

**`technicians.technician.routes.ts`**

- [x] `POST /` → 201 with the profile + `accountState` + `message`

### Test it

```bash
curl -X PATCH localhost:3000/api/v1/me/role \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"role":"TECHNICIAN"}'

curl -X POST localhost:3000/api/v1/technician/profile \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"fullName":"Karim","city":"Cairo","address":"5 Tahrir",
       "latitude":30.0444,"longitude":31.2357,"categoryId":"1",
       "nationalId":"29805150101234"}'
```

201 with `WAITING_FOR_APPROVAL`. Log in again → still `WAITING_FOR_APPROVAL`,
never `COMPLETE_PROFILE`. Response must not contain `nationalId`.

---

# Task 4 — File upload ✅ done

The app uploads each document, gets a URL, sends those URLs with task 3's form.

**Most of this is already done.** `POST /me/signup` needed to store files, so
multer is installed and the whole storage layer exists in
**`uploads.storage.ts`** — the configured instance, the jpeg/png/pdf filter, the
5 MB limit, the renaming, `publicUrlFor`, and `discardUploads`. `app.ts` already
serves the folder and `core/error-handler.ts` already turns a `MulterError`
into a 400.

What is left is the standalone endpoint, for clients that upload before they
submit a form rather than with it.

**`uploads.public.routes.ts`**

- [x] `POST /` — `multipart/form-data`, field `file` → 201
      `{ data: { url: "/uploads/…" } }`

      Import `upload` and `publicUrlFor` from `./uploads.storage.js`; do **not**
      configure a second multer, or the two upload paths will drift apart. Add
      `upload.single("file")` as route middleware, then
      `res.status(201).json({ data: { url: publicUrlFor(req.file!) } })`.

- [x] Decide what an empty request does. `upload.single` leaves `req.file`
      undefined when no file was sent, and that has to be a 400, not a crash.

**`src/api/public.ts`**

- [x] Worth moving behind `requireAuth` while you are in there — see the note in
      that file. Everyone who uploads has a token by the time they do.

### Test it

```bash
curl -X POST localhost:3000/api/v1/public/uploads -F 'file=@photo.jpg'  # 201
curl localhost:3000/uploads/THE-RETURNED-NAME                           # the file
curl -X POST localhost:3000/api/v1/public/uploads -F 'file=@big.zip'    # 400
curl -X POST localhost:3000/api/v1/public/uploads                       # 400, no file
```

---

# Task 5 — Admin approval ✅ done

Until an admin does this, every technician sits on the waiting screen.

**`technicians.schema.ts`**

- [x] `updateVerificationBody` — `VERIFIED` or `REJECTED` only (not `PENDING`)
- [x] `listTechniciansQuery` — add an optional `verificationStatus` filter.
      Copy `listUsersQuery`.

**`technicians.service.ts`**

- [x] `listTechnicians(query)` — one page + total, `include: { user, category }`.
      Copy `listUsers`.
- [x] `setVerificationStatus(profileId, data)` — **one `prisma.$transaction`**:
      - `VERIFIED` → profile VERIFIED **and** `user.status = "ACTIVE"`.
        Both, or the technician is stuck waiting forever.
      - `REJECTED` → profile REJECTED, user stays `PENDING` so they can resubmit.

**`technicians.mapper.ts`**

- [x] `toTechnicianProfileAdminResponse(profile)` — the same fields **plus**
      `nationalId` and `criminalRecordFile`. Two functions, not one with a flag.

**`technicians.admin.routes.ts`**

- [x] `GET /` → `{ data, meta }`
- [x] `PATCH /:id/verification` → 200

### Test it

```bash
curl "localhost:3000/api/v1/admin/technicians?verificationStatus=PENDING" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
curl -X PATCH localhost:3000/api/v1/admin/technicians/1/verification \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"verificationStatus":"VERIFIED"}'
```

That technician logs in again → `READY`. Sending `"PENDING"` → 400.

---

# Ordering a service — tasks 6 to 11

Everything above gets a user *into* the app. This half is what they came for:
the customer describes a problem, either pays points to have an AI size it up or
asks straight for a consultation, broadcasts it live to the technicians in that
field, and picks one of the fees that come back.

Six modules, all scaffolded the same way tasks 1–5 are:

```
src/modules/points/     task 6     schema · service · mapper · customer+admin routes
src/modules/requests/   tasks 7,8,10,11  schema · service · mapper · customer routes
src/modules/ai/         task 8     the AI client, one file
src/realtime/           task 9     events · auth · server · emit · admin ping route
src/modules/offers/     tasks 10,11 schema · service · mapper · technician routes
src/core/geo.ts         task 10    haversine + bounding box
```

Every function in them throws `notImplemented` over a `TODO(task N)` comment
that repeats the relevant part of this document at the place you need it. Keep
copying `src/modules/users/` for the patterns themselves.

The client half of this is [`APP-FLOW.md`](APP-FLOW.md) — the exact JSON each
screen expects. When the two disagree, they are both wrong; fix them together.

## The flow

```
 Profile screen
   ├── tokens balance          GET  /customer/points              task 6
   ├── past orders             GET  /customer/requests            task 7
   └── "say your problem"
         │
         ▼
   Pick a service              GET  /public/categories            done (task 1)
         │
         ▼
   "How do you want to fix it?"  — two buttons, no call
         │
    ┌────┴────────────────────────────┐
    ▼                                 ▼
 "Describe it with AI"        "Order a consultation"
  photo + description          photo + description
    │                                 │
    │  POST /customer/requests        │  POST /customer/requests        task 7
    │  AI_ESTIMATION → DRAFT          │  CONSULTATION → DRAFT
    ▼                                 │
  POST …/:id/ai-estimation   task 8   │
  −50 points, one charge ever         │
  → severity + summary + range        │
    │                                 │
    └────────────┬────────────────────┘
                 ▼  the "Send" button
   Publish                     POST /customer/requests/:id/publish  task 10
   → status WAITING_FOR_TECHNICIAN
   → one PENDING offer row per nearby technician in that category
   → socket `job:new` to each of them                              task 9
                 │
                 ▼
   Technician's job feed       GET  /technician/jobs               task 10
   → problem, photos, AI range, customer's first name + distance
   → POST /technician/jobs/:id/offer  { consultationFee }
     (or /decline)
   → socket `offer:new` to the customer                            task 9
   → the 5th fee closes the rest: they vanish from every other feed
                 │
                 ▼
   Customer picks              GET  /customer/requests/:id/offers  task 11
   → who answered, nearest first, with photo, rating, past orders, fee
   → POST /customer/requests/:id/offers/:offerId/accept
   → request TECHNICIAN_SELECTED, visitFee frozen from that offer,
     the rest closed, socket `job:closed` to the losers and
     `job:selected` to the winner
```

Six rules hold this together, and every task below leans on one of them:

1. **A request is a draft until it is published.** `RequestStatus.PENDING` means
   "the customer is still filling this in"; `WAITING_FOR_TECHNICIAN` means it is
   out there. Nothing fans out to technicians until `publish`.
2. **The AI does not price anything.** It returns a `Severity`, a confidence and
   a sentence for the customer to read. The price range is read out of
   `category_pricing`, which `prisma/seed-categories.ts` already fills for every
   (category, severity) pair. A price the AI invented could not be audited or
   corrected; a severity can.
3. **The technician names the fee, not us.** An offer is a price for *coming
   out* — the consultation or home visit — chosen by the technician within
   bounds derived from `Category.homeVisitBasePrice`. The AI's range is a guess
   at the eventual repair and binds nobody. Two different numbers, and the
   mappers must never merge them.
4. **Points are spent inside the same transaction that writes what they bought.**
   Never charge, then call something, then write. If the write fails the charge
   rolls back with it.
5. **Money and identity are revealed late.** A technician sees a first name, a
   city and a distance. The phone number and the exact address appear only once
   the customer has accepted their offer.
6. **The socket delivers, the database decides.** Every write is an HTTP call in
   a transaction; the socket only announces what already happened, always
   *after* the commit. No client event ever changes a row. Get this backwards
   and you have a second, unguarded API.

New constants — each one named, in one place, never typed inline:

| Constant | Value | Where |
| -------- | ----- | ----- |
| `AI_ESTIMATION_POINTS_COST` | 50 | `core/env.ts` |
| `FANOUT_RADIUS_KM` | 25 | `modules/offers/offers.service.ts` |
| `FANOUT_MAX_TECHNICIANS` | 50 | same |
| `MAX_OFFERS_PER_REQUEST` | 5 | same |
| `OFFER_FEE_MIN_MULTIPLIER` | 0.5 | same |
| `OFFER_FEE_MAX_MULTIPLIER` | 3 | same |

## Every schema change in this half, in one place

Four tasks touch `prisma/schema.prisma`. Each one migrates on its own — this
table is only so you can see where it ends up.

| Task | Change | Why |
| ---- | ------ | --- |
| 6 | `User.pointsBalance`, new `PointsTransaction` + enum | the wallet |
| 7 | `ServiceRequest.title` | the AI needs one, the past-orders row shows one |
| 7 | `RequestType.HOME_VISIT` → **`CONSULTATION`** | the button is called "order a consultation"; nothing reads the old name yet |
| 8 | `AiEstimation.summary` | the customer reads the AI's answer, not just a severity |
| 10 | `TechnicianOffer.consultationFee`, `submittedAt` | the fee the technician is asking |
| 10 | `OfferStatus.ACCEPTED` → **`SUBMITTED`** | "accepted" now means the customer's side of it; the technician *submits* a fee |

Both enum renames are `ALTER TYPE … RENAME VALUE`, and both are free today: no
code reads either value yet, because the modules that would are the ones you are
about to write.

**One column changes meaning without changing name: `Category.homeVisitBasePrice`.**
It used to be the price of a visit. Now that the technician names their own fee,
it is the *reference* price for that field — the number a technician's fee input
is prefilled with, and the one the accepted range is derived from. It is not
renamed because task 1 shipped it, the categories module reads it, the admin
screens edit it and `/public/categories` returns it; a rename would touch five
files to improve one word. Put the new definition in a comment on the column
instead, so the next person reads it there rather than guessing from the name.

---

# Task 6 — Points wallet

The number on the profile screen, and the thing an AI estimation spends. Top-up
with a card is **not** in this task — see *Recharging* at the end of it.

> **The screen says "tokens", the API says "points".** The designs call them
> tokens or credits; every column, endpoint and type below says points. Pick one
> word per layer and never mix them inside a layer — a `tokenBalance` next to a
> `pointsBalance` is how you end up with two of them. It is also worth keeping
> the word "token" for JWTs, which is what the rest of this codebase means by it.

**`prisma/schema.prisma`**

- [ ] `User.pointsBalance` — `Int @default(0) @map("points_balance")`
- [ ] `PointsTransaction` + a `PointsTransactionType` enum:

      ```prisma
      enum PointsTransactionType {
        TOPUP        // bought with money — task for later
        SPEND        // an AI estimation
        REFUND       // we failed, give it back
        ADMIN_GRANT  // support, and how you test this today
      }

      model PointsTransaction {
        id               BigInt   @id @default(autoincrement())
        userId           BigInt   @map("user_id")
        type             PointsTransactionType
        amount           Int      // signed: +100 top-up, -50 spend
        balanceAfter     Int      @map("balance_after")
        reason           String?  @db.VarChar(255)
        serviceRequestId BigInt?  @map("service_request_id")
        createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

        user User @relation(fields: [userId], references: [id], onDelete: Cascade)

        @@index([userId, createdAt])
        @@map("points_transactions")
      }
      ```

      Both a column **and** a ledger, on purpose. The column is what every read
      needs and what the conditional decrement below locks on; the ledger is
      what answers "where did my 50 points go" and is the row a payment webhook
      will one day write. A balance with no history is unauditable; a history
      with no balance costs a `SUM` on every request.

- [ ] `npm run prisma:migrate -- --name points_wallet`

**`src/core/errors.ts`** and **`src/core/messages.ts`**

- [ ] `ApiError.paymentRequired()` → `402 insufficient_points`, and
      `ApiError.serviceUnavailable()` → `503 service_unavailable` (task 8 needs
      the second one). Add a `messages.points` block —
      `notEnough: "رصيد نقاطك مش كفاية. اشحن نقاط وحاول تاني."` — and the new
      field labels (`points`, `amount`, `title`, `description`, `images`).

**`src/modules/points/points.schema.ts`**

- [ ] `listPointsQuery` — `paginationQuery` plus an optional `type` filter
- [ ] `grantPointsBody` — `amount` (int, 1…100000), `reason` (optional, ≤255).
      Admin only. No `userId` — it is the `:id` in the URL.

**`src/modules/points/points.service.ts`**

```ts
getPointsBalance(userId: bigint): Promise<number>
listPointsTransactions(userId: bigint, query: ListPointsQuery): Promise<{ transactions: PointsTransaction[]; total: number }>
spendPoints(tx: Prisma.TransactionClient, userId: bigint, amount: number, meta: { reason?: string; serviceRequestId?: bigint }): Promise<number>
creditPoints(tx: Prisma.TransactionClient, userId: bigint, amount: number, meta: { type: PointsTransactionType; reason?: string }): Promise<number>
```

- [ ] `getPointsBalance` — one `select: { pointsBalance: true }`, 404 if the user
      is gone or soft-deleted.
- [ ] `listPointsTransactions` — a page + a total, newest first. Copy `listUsers`.
- [ ] `spendPoints` — **takes a transaction client, never `prisma` directly.** It
      is always part of a bigger write. The guard is one conditional update, not
      a read-then-write:

      ```ts
      const { count } = await tx.user.updateMany({
        where: { id: userId, deletedAt: null, pointsBalance: { gte: amount } },
        data: { pointsBalance: { decrement: amount } },
      });
      if (count === 0) throw ApiError.paymentRequired(messages.points.notEnough);
      ```

      That is the whole race-condition story: two estimations fired at once
      cannot both pass, because the second `updateMany` matches zero rows. A
      `findUnique` followed by an `if` would let both through. Then insert the
      `SPEND` row with the returned `balanceAfter` and return the new balance.
- [ ] `creditPoints` — the mirror image, `increment`, positive `amount`.

**`src/modules/points/points.mapper.ts`**

- [ ] `toPointsTransactionResponse(row)` — ids as strings, `amount` and
      `balanceAfter` as plain ints (points are whole numbers, not money — this
      is the one place the "money is a string" rule does not apply, and say so
      in a comment).

**`src/modules/users/users.mapper.ts`**

- [ ] Add `pointsBalance` to `toUserResponse`, so the profile screen gets it
      from `GET /me` without a second call.

**`src/modules/points/points.customer.routes.ts`**

- [ ] `GET /` → `{ data: { pointsBalance: 250 } }`
- [ ] `GET /transactions` → `{ data: [...], meta }`

**`src/modules/points/points.admin.routes.ts`**

- [ ] `POST /:id/points` → 201, grants points to any user. `ADMIN_GRANT`. This
      is how you get points to test task 8 with before payments exist.

**Wiring** — already done: `customerRouter.use("/points", …)` is in
`src/api/customer.ts`, and `adminRouter.use("/users", pointsAdminRoutes)` sits
next to `adminUsersRoutes` in `src/api/admin.ts` — same prefix, different file,
Express tries them in order.

### Recharging — what we will use

Not this task, but decide it before designing the top-up screen, because it
shapes the model above.

**Use Paymob.** It is the Egyptian default and the only one of these that covers
every way an Egyptian customer actually pays in one integration: Visa/Mastercard,
Meeza, Vodafone Cash and the other wallets, Fawry reference codes, and ValU
instalments. Settlement is in EGP against an Egyptian merchant account. The
alternatives, briefly: **Fawry** has the best cash coverage but a weaker card
flow, **Kashier** and **Geidea** are fine and slightly simpler, and
**Stripe/PayPal cannot acquire locally in EGP at all** — do not design around
them.

Three rules for whoever builds it:

- **The webhook is what credits the wallet, not the app.** Paymob's callback to
  the client can be replayed, dropped or forged. The server-to-server webhook is
  HMAC-signed; verify it, then `creditPoints(..., { type: "TOPUP" })`.
- **The packages live on the server.** `POST /customer/points/topup { packageId }`,
  never `{ amount }`. A client that names its own price will eventually name 0.
- **Idempotency comes from the provider's reference.** Add
  `providerRef String? @unique` to `PointsTransaction` when you get there; a
  webhook that arrives twice then fails on the unique index instead of doubling
  someone's balance.

One thing to check early: Apple and Google require in-app purchase for *digital*
goods only. Points that buy a real technician who comes to your flat are a
real-world service and are exempt — but the review teams argue about it, so
confirm before the first store submission.

### Test it

```bash
curl -X POST localhost:3000/api/v1/admin/users/2/points \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"amount":100,"reason":"testing"}'                       # 201

curl localhost:3000/api/v1/customer/points -H "Authorization: Bearer $TOKEN"
# { "data": { "pointsBalance": 100 } }
curl localhost:3000/api/v1/customer/points/transactions -H "Authorization: Bearer $TOKEN"
```

---

# Task 7 — The customer's problem, and their past orders

Two screens: the list of everything they have ordered before, and the form
behind both "describe it with AI" and "order a consultation". The form only
creates a **draft** — nothing reaches a technician until task 10 publishes it.

**`prisma/schema.prisma`**

- [ ] `ServiceRequest.title` — `String @db.VarChar(120)`. The AI takes a title
      and a photo, and the past-orders list needs one line to show; `description`
      is the paragraph underneath. Migrate.
- [ ] Rename `RequestType.HOME_VISIT` to `CONSULTATION`, and say in a comment
      what the two branches now mean:

      ```prisma
      enum RequestType {
        AI_ESTIMATION  // the AI screen: 50 points buys a severity and a summary
        CONSULTATION   // straight to the technicians, no AI, no charge
      }
      ```

      Both branches collect a photo and a description and both end up published
      the same way — the type only decides whether an estimate is required
      first, and what the technician's card has room to show.

**`src/modules/requests/requests.schema.ts`**

- [ ] `createServiceRequestBody` — `title` (3–120), `description` (10–2000),
      `categoryId` (`idField`), `requestType` (`AI_ESTIMATION` | `CONSULTATION`),
      `images` (array of URL strings from `POST /public/uploads`, **1–5,
      required for both types**), and an optional address override
      (`serviceAddress`, `serviceCity`, `latitude`, `longitude`).

      A photo is required either way: the AI has nothing to look at without one,
      and a technician pricing a visit blind will either overcharge or refuse.
- [ ] `listMyRequestsQuery` — `paginationQuery` plus an optional `status`.
- [ ] `requestIdParams` = `idParams`; `requestOfferParams` for
      `/:id/offers/:offerId` (task 11).

**`src/modules/requests/requests.service.ts`**

```ts
createServiceRequest(customerId: bigint, data: CreateServiceRequestBody)
listCustomerRequests(customerId: bigint, query: ListMyRequestsQuery)
getCustomerRequest(customerId: bigint, requestId: bigint)
cancelServiceRequest(customerId: bigint, requestId: bigint)
```

- [ ] `createServiceRequest` — one `prisma.$transaction`: create the request with
      `status: "PENDING"`, then `tx.requestAttachment.createMany` for the images.
      **The address is a snapshot, not a join.** Default it from the user's
      profile, but copy the values onto the request — the customer may move house
      next year and the job happened where it happened. A bad `categoryId` is a
      P2003 → 409 on its own; do not pre-check it.
- [ ] `listCustomerRequests` — the past-orders screen. A page + a total, newest
      first, `where: { customerId }`, `include: { category: true, technician: true,
      aiEstimation: true, _count: { select: { offers: true } } }`. Always scope by
      `customerId` in the `where` — never fetch and then compare in JS.

      **Drafts are excluded unless they are asked for by name.** With no
      `?status=`, filter `status: { not: "PENDING" }`: a customer who opened the
      AI screen and backed out left a row behind, and it is not an order they
      placed. `?status=PENDING` still returns them, so nothing is unreachable.
- [ ] `getCustomerRequest` — `findFirst({ where: { id, customerId } })`, plus
      attachments, estimation, category, technician and `_count: { select: { offers: true } }`.
      Not theirs → **404, not 403.** A 403 tells a stranger the request exists.
- [ ] `cancelServiceRequest` — allowed from `PENDING`, `WAITING_FOR_TECHNICIAN`
      and `TECHNICIAN_SELECTED`; anything else is a 409. One transaction: the
      request to `CANCELLED`, and every offer still `PENDING` or `SUBMITTED` to
      `NOT_SELECTED`, so it drops out of the technicians' feeds too.

      **Return the ids of the technicians whose offers it just closed.** Nothing
      uses them today; task 10 hands them to `emitJobClosed` so the card
      disappears from the screens people are actually looking at. Collect them
      with a `findMany({ select: { technicianId: true } })` inside the
      transaction, before the `updateMany` changes what matches.

**`src/modules/requests/requests.mapper.ts`**

- [ ] `toServiceRequestResponse(request)` — the customer's own view. Ids as
      strings, `visitFee`/`distanceKm` as strings or null, attachments as an
      array of urls, `aiEstimation` nested or null. Include the assigned
      technician's **phone** here — but only when `status` is
      `TECHNICIAN_SELECTED` or past it, because that is the point at which the
      two of them are supposed to talk.
- [ ] `toServiceRequestListItem(request)` — the past-orders row: id, title,
      category name, status, `requestType`, createdAt, visitFee, technician
      name, and `offersCount` from `_count`. Deliberately smaller than the one
      above; a list of 20 does not need 20 sets of attachments.

**`src/modules/requests/requests.customer.routes.ts`**

- [ ] `POST /` → 201
- [ ] `GET /` → `{ data, meta }`
- [ ] `GET /:id` → 200
- [ ] `POST /:id/cancel` → 200

**Wiring** — already done: `customerRouter.use("/requests", …)` is in
`src/api/customer.ts`. All eight routes in that file are mounted and answering
`501`, including the ones tasks 8, 10 and 11 fill in.

### Test it

```bash
curl -X POST localhost:3000/api/v1/customer/requests \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"Kitchen sink leaking","description":"Water under the sink since yesterday, the pipe joint is wet.","categoryId":"1","requestType":"AI_ESTIMATION","images":["/uploads/1712-sink.jpg"]}'
# 201, "status":"PENDING"

curl localhost:3000/api/v1/customer/requests -H "Authorization: Bearer $TOKEN"
curl localhost:3000/api/v1/customer/requests/1 -H "Authorization: Bearer $OTHER_TOKEN"  # 404
```

---

# Task 8 — "Describe it with an AI"

Title + photo in; a sentence the customer can read, a severity and a price range
out; 50 points off the balance. The model itself is somebody else's job — this
task is the endpoint, the charge, and the contract with them.

**`prisma/schema.prisma`**

- [ ] `AiEstimation.summary` — `String @db.Text`. The screen shows the AI's
      *answer*, in Arabic, above the price range — "the problem is most likely
      the joint under the sink, you need a plumber to replace it". A severity
      enum is what we price from; a sentence is what the customer came for.
      Migrate.

**`src/core/env.ts`**

- [ ] `AI_SERVICE_URL` (optional), `AI_SERVICE_TOKEN` (optional),
      `AI_TIMEOUT_MS` (default 15000), `AI_ESTIMATION_POINTS_COST` (default 50).

      While you are in `core/`, add the two sentences this task needs to
      `messages.ts`: `messages.ai.unavailable` ("الخدمة مش متاحة دلوقتي، جرّب
      كمان شوية أو اطلب كشف") and `messages.requests.pricingMissing`. Nothing
      user-facing is typed inline — see the header of that file.

**`src/modules/ai/ai.client.ts`** — the whole integration, in one file, exactly
like `auth.sms.ts` is the only file that knows what an SMS is.

```ts
type AiEstimateInput = { title: string; description: string; categoryName: string; imageUrls: string[] };
type AiEstimateResult = { severity: Severity; confidence: number; summary: string };

estimateProblem(input: AiEstimateInput): Promise<AiEstimateResult>
```

- [ ] `estimateProblem` — `POST {AI_SERVICE_URL}/estimate` with a bearer token
      and `AbortSignal.timeout(AI_TIMEOUT_MS)`. **Parse the response with zod**
      before returning it: this is somebody else's service and a `severity` of
      `"medium"` or `"HUGE"` must be our 503, not a Prisma enum crash. Trim
      `summary` and cap it (say 1–2000 characters) — it goes straight onto a
      phone screen. Any failure — timeout, non-200, unparseable body — becomes
      `ApiError.serviceUnavailable(messages.ai.unavailable)`. Never a 500, and
      never a charge.
- [ ] With no `AI_SERVICE_URL` configured, return a **deterministic stub**
      (hash the title → a severity, confidence `0.5`, a fixed Arabic sentence)
      and log it, the same way `sendOtpSms` prints the code. In production, an
      unconfigured URL throws at startup instead. Without this nobody can test
      tasks 9, 10 and 11 until the AI exists.

The contract to hand the AI engineer:

```jsonc
// POST /estimate
{ "category": "Plumbing",
  "title": "Kitchen sink leaking",
  "description": "Water under the sink since yesterday…",
  "images": ["https://api.example.com/uploads/1712-sink.jpg"] }

// 200
{ "severity": "MEDIUM",           // SMALL | MEDIUM | LARGE
  "confidence": 0.82,             // 0…1
  "summary": "المشكلة على الأغلب في وصلة ماسورة تحت الحوض…" }
```

Three things to tell them, because they are ours to enforce and theirs to
respect: **the summary is written in Egyptian Arabic and shown verbatim** —
nobody post-processes it here; it must never contain a price, because the price
comes from our own pricing table and two different numbers on one screen is a
support ticket; and it is at most a short paragraph, since it renders on a
phone under the photo.

> **Decide before wiring a real model:** those image URLs have to be reachable
> *from the AI service*. Today files are on the app container's local disk and
> the stored url is a path (`/uploads/…`), so a remote model cannot fetch it.
> Either add a `PUBLIC_BASE_URL` and make the folder publicly readable, or POST
> the bytes. This is the same limitation as the "one node only" note in
> `ONBOARDING-FLOW.md`, and S3 fixes both at once.

**`src/modules/requests/requests.service.ts`** (add to task 7's file)

```ts
estimateServiceRequest(customerId: bigint, requestId: bigint)
```

- [ ] The order of operations is the whole task:

      1. Load the request with its category and attachments, scoped by
         `customerId`. Missing → 404.
      2. `requestType !== "AI_ESTIMATION"` or `status !== "PENDING"` → 409.
      3. **Already has an `aiEstimation` → return it and charge nothing.** Not a
         409: a customer whose app retried a timed-out request must not pay
         twice. `AiEstimation.serviceRequestId` is unique, so the database
         agrees with you.
      4. Cheap balance check → 402 before calling the AI. Do not spend somebody
         else's GPU on a customer who cannot pay for it. This is a courtesy
         check, not the guard.
      5. `await estimateProblem(...)` — **outside any transaction.** A 15-second
         HTTP call inside `$transaction` holds a Postgres connection open for 15
         seconds; do that a hundred times at once and the pool is gone.
      6. One `prisma.$transaction`:
         - `spendPoints(tx, customerId, AI_ESTIMATION_POINTS_COST, { serviceRequestId })`
           — the real guard, and a 402 here means a concurrent estimation won.
         - `tx.categoryPricing.findUnique({ where: { categoryId_severity: … } })`
           for the min/max. Missing row → `ApiError.conflict(messages.requests.pricingMissing)`
           and tell them to run `prisma/seed-categories.ts`; the bands are
           seeded for every category, so a gap is a deployment fault, not a user
           error.
         - `tx.aiEstimation.create({ … })`.

         All three or none: if the pricing lookup fails, the 50 points are never
         taken, because the transaction rolls back the decrement with it.

**`src/modules/requests/requests.mapper.ts`**

- [ ] `toAiEstimationResponse(estimation)` — `severity`, `summary`,
      `minPrice`/`maxPrice` as 2dp strings, `confidence` as a string. Prices are
      money: strings, never floats.

**`src/modules/requests/requests.customer.routes.ts`**

- [ ] `POST /:id/ai-estimation` → 201

      ```jsonc
      { "data": { "estimation": { "severity": "MEDIUM",
                                  "summary": "المشكلة على الأغلب في وصلة ماسورة تحت الحوض…",
                                  "minPrice": "375.00", "maxPrice": "900.00",
                                  "confidence": "0.82" },
                  "pointsCharged": 50, "pointsBalance": 50 } }
      ```

      Return the new balance in the same response. The screen that shows the
      estimate also shows the wallet, and it should not need a second call to
      find out what the first one cost.

      On the second call `pointsCharged` is `0` and the balance is unchanged —
      the estimate is the same one, handed back. Do not invent a different
      status code for it: the app draws the same screen either way.

### Test it

```bash
curl -X POST localhost:3000/api/v1/customer/requests/1/ai-estimation \
  -H "Authorization: Bearer $TOKEN"          # 201, balance drops by 50
curl -X POST localhost:3000/api/v1/customer/requests/1/ai-estimation \
  -H "Authorization: Bearer $TOKEN"          # 201, same estimate, balance unchanged
# spend the rest of the points, then on a fresh request:  402 insufficient_points
```

---

# Task 9 — The live channel (Socket.IO)

A technician's feed fills up while they are staring at it, and a customer
watches fees arrive without pulling to refresh. This task is the channel that
does it: a socket server, authenticated exactly the way the API is, with five
events on it. Tasks 10 and 11 do the emitting — **nothing in this module knows
what an offer is**, and that is the point.

Keep one sentence in your head the whole way through: *the socket is a delivery
channel, not a second API.* It never receives an instruction, only sends
notifications. Every write stays an HTTP call in a transaction, where the
guards, the validation and the rollback already live.

`socket.io` and `socket.io-client` are already installed, and
**`src/realtime/realtime.events.ts` is already written** — the event names, the
`roomFor` helper, the payload types and `JobClosedReason`. It is the contract
the app team is reading in `APP-FLOW.md`, so it is the one file here that
existed before the behaviour did. Read it first; everything below fills it in.

One line of it is worth having in your head before you start: **payloads are
whatever the REST mappers already return.** `job:new` carries one element of
`GET /technician/jobs`, `offer:new` one element of
`GET /customer/requests/:id/offers`. Same mapper, same shape — an app that
renders a card from the list must render the same card from the event without a
second code path.

**`src/core/env.ts`**

- [ ] `SOCKET_CORS_ORIGIN` — comma-separated origins, default `*`. A native app
      does not send an `Origin`, so this changes nothing for the phone; a browser
      dashboard on another host would be refused at the handshake without it,
      because that handshake is an ordinary HTTP request before it is a socket.

**`src/realtime/realtime.auth.ts`**

- [ ] The handshake guard, reusing the HTTP guard's own pieces — `verifyToken`,
      `findUserById`, `assertAccountIsUsable`. One auth story for both channels:

      ```ts
      io.use(async (socket, next) => {
        try {
          const token = socket.handshake.auth?.token;
          const userId = verifyToken(String(token ?? ""), "access");
          const user = await findUserById(userId);
          if (!user) throw new Error("gone");
          assertAccountIsUsable(user);      // blocked / suspended stop here
          socket.data.user = user;
          next();
        } catch {
          next(new Error("unauthorized")); // the client sees this exact string
        }
      });
      ```

      **One message for every failure.** Missing, malformed, expired, wrong kind
      of token, deleted account, blocked account — all `unauthorized`, because
      the client's reaction is the same in every case (refresh, then reconnect)
      and anything more specific is free information for someone probing.

**`src/realtime/realtime.server.ts`**

- [ ] `createRealtime(httpServer)` — build the `Server`, install the guard, and
      on `connection` put the socket in `roomFor(user.id)`. Nothing else: no
      `socket.on(...)` handlers for client events, on purpose. Keep the instance
      in a module-level variable behind `getIo()`.

      Two details that are easy to skip and painful later:

      - **Clients never join rooms themselves.** The room comes from the token.
        A `socket.on("join", ...)` handler, however innocent it looks, is a
        subscription to somebody else's jobs.
      - **Disconnect a socket once its access token would have expired**
        (`ACCESS_TOKEN_TTL_MINUTES`), with a `setTimeout` armed at connection.
        A socket authenticated once and left open for a week would keep feeding
        a blocked account. The HTTP side promises "a blocked account stops
        working within 15 minutes" because the guard re-reads the user row every
        request; this timer is how the socket keeps the same promise. The client
        already knows how to reconnect with a fresh token — that is the
        `connect_error` handler in `APP-FLOW.md`.

**`src/realtime/realtime.emit.ts`** — the only file tasks 10 and 11 import.

- [ ] Five functions, all taking ids and an already-mapped payload:

      ```ts
      emitJobNew(technicianIds: bigint[], job: unknown): void
      emitJobClosed(technicianIds: bigint[], requestId: bigint, reason: JobClosedReason): void
      emitJobSelected(technicianId: bigint, requestId: bigint, offerId: bigint): void
      emitOfferNew(customerId: bigint, requestId: bigint, offer: unknown): void
      emitRequestUpdated(customerId: bigint, requestId: bigint, status: RequestStatus): void
      ```

      All of them synchronous and all of them **incapable of throwing**: wrap the
      body in a `try`/`catch` that logs. By the time one of these runs the
      transaction has committed, so a socket problem must never turn a successful
      request into a 500. With no `io` yet (a script, a test) they log once and
      return — never crash.

      Ids are `bigint` in, strings on the wire. Serialize them the way the
      mappers do; `core/serialize.ts` only taught `JSON.stringify` about BigInt,
      and Socket.IO does not use it.

**`src/index.ts`**

- [ ] Uncomment the `createRealtime(server)` line. It is commented out today
      because the function throws, and a throw there takes the whole API down
      at startup rather than degrading to "no socket". `closeRealtime()` is
      already called from `shutdown()`.

      It shares the HTTP port: no second listener, and no second port to open in
      Docker.

**`src/realtime/realtime.admin.routes.ts`** — a way to test this today

- [ ] `POST /admin/realtime/ping` → 200, body `{ userId, message }`, emits
      `debug:ping` to that user's room. Tasks 10 and 11 are the real emitters,
      but they are days away and a channel you cannot see is a channel you
      cannot debug. Admin-guarded, so it can stay.

### Test it

`scripts/socket-test.mjs` is already there: it connects with a token and prints
every event the server sends. Leave one copy running as a customer and another
as a technician while you curl your way through tasks 10 and 11.

```bash
node scripts/socket-test.mjs "$TOKEN"           # connected <id>
node scripts/socket-test.mjs "not-a-token"      # connect_error: unauthorized

curl -X POST localhost:3000/api/v1/admin/realtime/ping \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"userId":"2","message":"hello"}'          # the script prints debug:ping
```

Block that user (`PATCH /admin/users/2/status`) and reconnect: `unauthorized`.

### What this deliberately does not do

- **It does not survive a second app container.** Rooms live in one process's
  memory, so a technician connected to node A never hears an event emitted on
  node B. The fix is `@socket.io/redis-adapter` and about six lines, the day
  there is a second node — the same "one node only" caveat as the uploads
  folder, and worth noting next to it.
- **It does not replace push notifications.** A closed app has no socket. The
  offer rows are what a push worker will read later; this only serves the screen
  that is open right now.
- **It guarantees nothing about delivery.** An event emitted while a phone is in
  a tunnel is gone. That is why every screen in `APP-FLOW.md` fetches over REST
  on open and on reconnect, and why no server logic may ever assume a client
  received something.

---

# Task 10 — Publishing, and the technician's feed

The "Send" button. The request goes out to every nearby technician in that
category, their feed fills up with it live, and they answer with a price.

**`prisma/schema.prisma`**

- [ ] The technician's fee, and the status rename that goes with it:

      ```prisma
      enum OfferStatus {
        PENDING       // in their feed, unanswered
        SUBMITTED     // they sent a fee — was ACCEPTED
        DECLINED      // they dismissed it
        SELECTED      // the customer took this one
        NOT_SELECTED  // closed: someone else was taken, or the request died
      }

      model TechnicianOffer {
        // …
        consultationFee Decimal?  @map("consultation_fee") @db.Decimal(10, 2)
        submittedAt     DateTime? @map("submitted_at") @db.Timestamptz(6)
      }
      ```

      `consultationFee` is nullable because the row is created by the fan-out,
      before any technician has typed anything: a `PENDING` offer is an
      *invitation*, and it becomes an offer when a fee lands on it. Drop the old
      `acceptedAt` in the same migration — `submittedAt` is the same instant
      under the right name. `npm run prisma:migrate -- --name offer_fees`.

**`src/core/messages.ts`**

- [ ] A `messages.offers` block — `noLongerAvailable`, `enoughTechnicians`,
      `feeOutOfRange(min, max)`, `alreadyAssigned`, `notSubmitted` — and
      `consultationFee` in `fieldLabels` (`"سعر الكشف"`). Arabic, like
      everything else a person reads.

**`src/modules/requests/requests.service.ts`**

```ts
publishServiceRequest(customerId: bigint, requestId: bigint)
```

- [ ] Guards: owned by the caller, `status === "PENDING"`, and — when
      `requestType` is `AI_ESTIMATION` — an `aiEstimation` row exists. Publishing
      an AI request with no estimate would send technicians a card with an empty
      severity on it. `CONSULTATION` skips that check: it is the "just send
      someone" button and there is nothing to wait for.

      One transaction: set `status: "WAITING_FOR_TECHNICIAN"`, then
      `fanOutOffers(tx, request)` below. Return the request and the technician
      ids it reached.
- [ ] **Then, after the commit, `emitJobNew(technicianIds, card)`** — one
      already-mapped card, the same object `GET /technician/jobs` would return.
      Outside the transaction, always: emit inside it and a rollback leaves fifty
      technicians looking at a job that does not exist. `distanceKm` differs per
      technician, so map the card per recipient rather than emitting one shared
      object with somebody else's distance on it.
- [ ] **Zero technicians nearby is not an error.** Publish anyway and return
      `technicianCount: 0`, so the app can say "nobody in your area yet" instead
      of a 409 the customer cannot act on. The request stays open and a
      technician who signs up tomorrow will not see it — the fan-out already
      happened. Say so out loud in a comment; it is the first thing someone will
      call a bug, and re-running the fan-out on a timer is the fix if it ever
      matters.

**`src/core/geo.ts`** (new)

```ts
distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number
boundingBox(center: { lat: number; lng: number }, radiusKm: number): { minLat: number; maxLat: number; minLng: number; maxLng: number }
```

- [ ] Haversine, and the box that prefilters it. The box is a `where` Postgres
      can serve from an index; the haversine then trims the corners in JS. Doing
      it the other way round means reading every technician in the country.

**`src/modules/offers/offers.service.ts`**

```ts
fanOutOffers(tx: Prisma.TransactionClient, request: ServiceRequest): Promise<bigint[]>
listTechnicianJobs(technicianId: bigint, query: ListJobsQuery)
submitOffer(technicianId: bigint, offerId: bigint, data: SubmitOfferBody)
declineOffer(technicianId: bigint, offerId: bigint)
```

- [ ] `fanOutOffers` — find the eligible technicians and `createMany` one
      `PENDING` offer each, `skipDuplicates: true`. Eligible means **all** of:
      `TechnicianProfile.categoryId === request.categoryId`,
      `verificationStatus: "VERIFIED"`, `isAvailable: true`,
      `user.status: "ACTIVE"`, `user.deletedAt: null`, inside
      `FANOUT_RADIUS_KM` — nearest `FANOUT_MAX_TECHNICIANS` if more qualify.
      **Return their user ids**, not a count: `publishServiceRequest` needs them
      to emit, and a count cannot be emitted to.

      > Why rows rather than a live query: `@@unique([serviceRequestId,
      > technicianId])` and `OfferStatus.PENDING` already exist for this, a
      > declined offer needs a row to stay hidden anyway, and "it disappeared
      > from the other technicians' screens" becomes one `updateMany` instead of
      > a filter every reader has to remember. It is also what a reconnecting
      > phone re-reads, and what push notifications will hang off later. The cost
      > is one `createMany` of at most 50 rows per publish.
      >
      > The socket does not change this. Rooms are the *delivery*; the rows are
      > the record. A feed built on events alone would be empty every time
      > somebody's train went into a tunnel.

- [ ] `listTechnicianJobs` — the feed. `where: { technicianId, status:
      query.status ?? "PENDING", serviceRequest: { status: "WAITING_FOR_TECHNICIAN" } }`,
      `include` the request with its category, attachments, `aiEstimation` and
      customer. Paginated, newest first. The second condition is belt and
      braces — a cancelled request should never render even if its offers were
      missed.
- [ ] `submitOffer` — the technician's price. One transaction, and every guard
      is a conditional write, not a read:
      - Read the request's category price for the bounds:
        `homeVisitBasePrice × OFFER_FEE_MIN_MULTIPLIER` …
        `× OFFER_FEE_MAX_MULTIPLIER`. Outside them → 400
        `messages.offers.feeOutOfRange(min, max)`. **This bound cannot live in
        the zod schema**: it depends on the category, which depends on the offer
        row. Schemas validate shape; services validate against the database.
      - `updateMany({ where: { id: offerId, technicianId, status: "PENDING",
        serviceRequest: { status: "WAITING_FOR_TECHNICIAN" } }, data: { status:
        "SUBMITTED", consultationFee, submittedAt: new Date() } })`.
        `count === 0` → 409 `messages.offers.noLongerAvailable`, which covers all
        of: not mine, already answered, request cancelled, technician already
        chosen.
      - Then count the `SUBMITTED` offers on that request. Over
        `MAX_OFFERS_PER_REQUEST` → roll back with a 409
        `messages.offers.enoughTechnicians`. Exactly at it → close the rest:
        `updateMany({ where: { serviceRequestId, status: "PENDING" }, data: {
        status: "NOT_SELECTED" } })`, collecting those technician ids first.
        That is the "it vanishes from the other screens" line in the brief, and
        it fires here rather than at selection so nobody is left waiting on one
        customer's decision.
      - After the commit: `emitOfferNew(customerId, requestId, card)` with the
        customer's version of the offer (task 11's mapper), and — if the request
        just filled up — `emitJobClosed(closedIds, requestId, "FULL")`.
- [ ] `declineOffer` — `PENDING` → `DECLINED`, same conditional-update shape.
      Nothing else changes and nothing is emitted; it only hides one card, on the
      screen that asked for it.

**`src/modules/offers/offers.schema.ts`**

- [ ] `submitOfferBody` — `consultationFee`, positive, at most 2 decimal places,
      capped at `99999999.99` like `homeVisitBasePrice` is. The category-relative
      bounds are the service's job, above.
- [ ] `listJobsQuery` — `paginationQuery` plus an optional `status`
      (`PENDING` | `SUBMITTED` | `DECLINED`). Not `SELECTED`/`NOT_SELECTED`:
      those are the customer's side of the story and there is no screen for them.

**`src/modules/offers/offers.mapper.ts`**

- [ ] `toTechnicianJobResponse(offer, distanceKm, feeBounds)` — the card in the
      technician's feed: offer id and status, the problem (title, description,
      photos, category name), the AI's severity, summary and price range
      (`null` on a `CONSULTATION`), of the customer **only** `fullName`,
      `serviceCity` and `distanceKm`, and a `fee` block —
      `{ suggested, min, max }` — so the fee input can be built without the app
      knowing the multipliers.

      **No phone. No `serviceAddress`. No exact coordinates.** Fifty technicians
      receive this card and at most one gets the job; the other forty-nine have
      no reason to hold a stranger's address. Task 11 adds a second mapper for
      after the choice is made.

      Keep the AI's range and the fee block visibly apart in the shape, and name
      them so nobody merges them: one is a guess at the repair, the other is what
      this technician charges to show up.

**`src/modules/offers/offers.technician.routes.ts`**

- [ ] `GET /` → `{ data, meta }`
- [ ] `POST /:id/offer` → 200, the updated offer
- [ ] `POST /:id/decline` → 200

**`src/modules/requests/requests.customer.routes.ts`**

- [ ] `POST /:id/publish` → 200 `{ data: { request, technicianCount: 7 } }`

**Wiring** — `technicianRouter.use("/jobs", offersTechnicianRoutes)` is already
in `src/api/technician.ts`. What is left is the cancel route, in the other
module:

- [ ] Hook `cancelServiceRequest`'s returned technician ids up to
      `emitJobClosed(ids, requestId, "CANCELLED")` in
      `requests.customer.routes.ts` — the `TODO(task 10)` in that handler — and
      emit `requestUpdated` to the customer on publish and cancel. Task 7 left
      those ids unused precisely so this task could pick them up.

      The `:id` on `/technician/jobs/:id` is the **offer** id, not the request
      id. It is what the card carries, and it is the row that a conditional
      update can lock on.

### Test it

```bash
curl -X POST localhost:3000/api/v1/customer/requests/1/publish \
  -H "Authorization: Bearer $TOKEN"                       # 200, technicianCount

curl localhost:3000/api/v1/technician/jobs -H "Authorization: Bearer $TECH_TOKEN"
curl -X POST localhost:3000/api/v1/technician/jobs/3/offer \
  -H "Authorization: Bearer $TECH_TOKEN" -H 'content-type: application/json' \
  -d '{"consultationFee":180}'                            # 200, SUBMITTED
curl -X POST localhost:3000/api/v1/technician/jobs/3/offer \
  -H "Authorization: Bearer $TECH_TOKEN" -H 'content-type: application/json' \
  -d '{"consultationFee":180}'                            # 409, already answered
curl -X POST localhost:3000/api/v1/technician/jobs/4/offer \
  -H "Authorization: Bearer $TECH2_TOKEN" -H 'content-type: application/json' \
  -d '{"consultationFee":99999}'                          # 400, out of range
```

Run the socket script from task 9 as the customer while you do this: publishing
prints `request:updated`, and each `POST …/offer` prints one `offer:new`. Run a
second copy as a technician: publishing prints `job:new`.

Send a fee from five different technicians, then check the sixth: their offer is
`NOT_SELECTED`, gone from `GET /technician/jobs`, and their socket printed
`job:closed` with `reason: "FULL"`.

---

# Task 11 — Choosing a technician

The customer's list of everyone who sent a fee, nearest first, and the tap that
hires one of them.

**`src/modules/offers/offers.service.ts`**

```ts
listRequestOffers(customerId: bigint, requestId: bigint)
acceptOffer(customerId: bigint, requestId: bigint, offerId: bigint)
```

- [ ] `listRequestOffers` — the `SUBMITTED` offers on that request, with the
      technician's `User` and `TechnicianProfile` and the profile's `Category`.
      **Not paginated** — `MAX_OFFERS_PER_REQUEST` is 5. Compute `distanceKm` for
      each from the request's stored coordinates and sort ascending, then by
      `overallRating` descending as the tie-break. Sorting in JS is right here
      and wrong in task 10: five rows, versus every technician in the
      governorate.

      Count each technician's past jobs in the same query, with a filtered
      relation count:

      ```ts
      _count: { select: { requestsAsTechnician: {
        where: { status: { notIn: ["PENDING", "WAITING_FOR_TECHNICIAN", "CANCELLED"] } },
      } } }
      ```

      Jobs they were *given*, not jobs they finished: `COMPLETED` is unreachable
      until the job lifecycle is built, and a screen full of "0 past orders"
      helps nobody choose. When completion lands, tighten this `where` — one
      place, one line. If this ever shows up in a slow query log, the fix is a
      counter column on `TechnicianProfile`, not a smarter query.
- [ ] `acceptOffer` — one transaction, in this order:

      1. `tx.serviceRequest.updateMany({ where: { id: requestId, customerId,
         status: "WAITING_FOR_TECHNICIAN", technicianId: null }, data: {
         technicianId, status: "TECHNICIAN_SELECTED", visitFee, distanceKm } })`.
         `count === 0` → 409 `messages.offers.alreadyAssigned`. Putting the
         request first makes it the lock: two taps on a slow connection cannot
         both assign, because the second no longer matches `technicianId: null`.
      2. The chosen offer `SUBMITTED` → `SELECTED`, conditionally. `count === 0`
         means no fee was ever sent on it → 409 `messages.offers.notSubmitted`.
      3. Every other offer on the request → `NOT_SELECTED`, collecting those
         technician ids on the way.

      `visitFee` is **the accepted offer's `consultationFee`**, copied onto the
      request at the moment of acceptance — not read back through the join, and
      not the category's base price. That number is what the customer agreed to
      pay, and it must not move afterwards for the same reason the address is a
      snapshot: the technician will price their next job differently, and last
      month's job must not change with it.

      Read the fee off the offer row **inside the transaction**, not from the
      request body. A `consultationFee` the client sends is a `consultationFee`
      the client chose.
- [ ] After the commit, three emits — the whole "it disappears from the other
      screens" requirement, and the only part of it the app cannot do for
      itself:

      ```ts
      emitJobSelected(winnerId, requestId, offerId);
      emitJobClosed(loserIds, requestId, "TAKEN");
      emitRequestUpdated(customerId, requestId, "TECHNICIAN_SELECTED");
      ```

**`src/modules/offers/offers.mapper.ts`**

- [ ] `toOfferForCustomerResponse(offer, distanceKm)` — the card the customer
      chooses from: `consultationFee` (2dp string), `submittedAt`, and the
      technician's `fullName`, `profileImage`, `overallRating`, `totalReviews`,
      `pastOrdersCount`, category name, `city` and `distanceKm` (2dp string).

      Still no phone — it appears in `toServiceRequestResponse` after the
      acceptance, which is task 7's mapper and the one place that decides it.

      **This is also the payload of `offer:new`**, so task 10 imports it. If the
      two ever differ, the list and the live insert draw different cards.

**`src/modules/requests/requests.customer.routes.ts`**

- [ ] `GET /:id/offers` → `{ data: [...] }`, no `meta`
- [ ] `POST /:id/offers/:offerId/accept` → 200 `{ data: { request } }`, the
      request now carrying the assigned technician and their phone.

### Test it

```bash
curl localhost:3000/api/v1/customer/requests/1/offers -H "Authorization: Bearer $TOKEN"
# 200, only technicians who sent a fee, distanceKm ascending, each with a fee
# and a pastOrdersCount

curl -X POST localhost:3000/api/v1/customer/requests/1/offers/3/accept \
  -H "Authorization: Bearer $TOKEN"     # 200, TECHNICIAN_SELECTED, visitFee = that offer
curl -X POST localhost:3000/api/v1/customer/requests/1/offers/4/accept \
  -H "Authorization: Bearer $TOKEN"     # 409, already assigned
```

The four technicians who were not chosen: their offer is `NOT_SELECTED`, no
longer in `GET /technician/jobs`, and their sockets printed `job:closed` with
`reason: "TAKEN"`. The chosen one printed `job:selected` and now sees the
customer's phone number; the customer's response carries the technician's.

---

## Done means

1. `npm run typecheck` exits 0
2. Every curl above does what it says
3. No `notImplemented` left in your files
4. Every new zod schema is registered in `src/docs/openapi.ts` with `fromZod`,
   so `/docs` documents what the routes actually accept
5. Every socket event a task emits is listed in `realtime.events.ts` **and** in
   the table in [`APP-FLOW.md`](APP-FLOW.md#live-updates-socketio) — an event the
   app team cannot read about does not exist
6. Nothing the socket carries is unobtainable over REST. Kill the socket and the
   app must still work with a pull-to-refresh

## Later, not now

The job itself — `ON_THE_WAY` → `ARRIVED` → `IN_PROGRESS` → `COMPLETED`, and the
two review tables that hang off a completed one · paying for the visit ·
topping up points with a card (task 6, *Recharging*) · push notifications for a
closed app, which is what the offer rows are waiting for · `@socket.io/redis-adapter`
the day there is a second app container · a short note alongside the fee, and
editing a fee once sent · re-running the fan-out for technicians who signed up
after a request was published · the technician's own "I am available" toggle ·
a real SMS provider · per-device token revocation.
