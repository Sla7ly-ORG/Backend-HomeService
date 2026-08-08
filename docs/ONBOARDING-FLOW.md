# Onboarding flow — design + open tasks

How a user gets from "opened the app" to "can use the app", which endpoint
serves each screen, and which ones are still to be built.

## Two ways through, same destination

Steps 1 and 2 are always the same: phone, then code. What follows the code
depends on how the app asks for it, and **both routes are supported**.

**Step by step** — one screen per endpoint. Described in the table below.

**All at once** — `POST /api/v1/me/signup` takes the role, the profile and (for
a technician) the documents as one `multipart/form-data` request, with the files
themselves rather than URLs. See *Signing up in one call* below.

They are not two implementations. Signup calls the same service functions the
step-by-step endpoints call, so an account that started one way can finish the
other, and `accountState` means the same thing whichever was used.

## The screens, and what each one calls

| # | Screen                        | Endpoint                              | Status |
| - | ----------------------------- | ------------------------------------- | ------ |
| 1 | Enter phone                   | `POST /api/v1/public/auth/request-otp` | ✅ done |
| 2 | Enter the 6-digit code        | `POST /api/v1/public/auth/verify-otp`  | ✅ done |
| 3 | Pick a field (plumbing, …)    | `GET /api/v1/public/categories`        | ✅ done |
| 4 | "Customer or technician?"     | `PATCH /api/v1/me/role`                | ✅ done |
| 5a| Customer → profile page       | `POST /api/v1/customer/profile`        | ✅ done |
| 5b| Technician → documents form   | `POST /api/v1/technician/profile`      | ✅ done |
|   | ↳ the file upload itself      | `POST /api/v1/public/uploads`          | ✅ done |
| — | **4 + 5 on one form**         | `POST /api/v1/me/signup`               | ✅ done |
|   | Admin approves the technician | `PATCH /api/v1/admin/technicians/:id/verification` | ✅ done |

Every 🔨 endpoint **already exists in the route map** — the files are written,
the functions are named, the bodies are empty. Calling one today returns:

```json
{ "error": { "code": "not_implemented", "message": "This endpoint is not built yet" } }
```

with status `501`. Your job is to delete the `throw ApiError.notImplemented()`
and write the body. Follow the `TODO(task N)` comments — each one names the
Prisma call and the traps.

## Three decisions that keep this simple

Everything from step 4 on runs behind a token. `verify-otp` issues one to a
PENDING user precisely so the rest of onboarding can be authenticated: each of
those steps acts on *the caller*, so none of them takes a `userId` — the id
comes from the token via `currentUser(req)`. See the Authentication section of
the README.

**1. The user row is created at step 2, with nothing but a phone.**

Everything except `phone` is nullable on `User`. The moment the code is
verified we insert a row and hand it back. The app is then "logged in" with an
incomplete profile, which is exactly what steps 3–5 fill in.

`status` tracks the progress, using the enum that already existed:

```
PENDING  → phone verified, profile not finished
ACTIVE   → profile complete, can use the app
BLOCKED / SUSPENDED → moderation
```

A returning user gets the same row back — one row per phone, forever.

**`verify-otp` tells the app which screen to show next**, via `accountState`:

| `accountState`          | Meaning                                    | App shows              |
| ----------------------- | ------------------------------------------ | ---------------------- |
| `COMPLETE_PROFILE`      | customer branch (or role not picked yet)   | onboarding → profile page |
| `SUBMIT_DOCUMENTS`      | technician branch, documents not sent yet  | national id + criminal record form |
| `WAITING_FOR_APPROVAL`  | technician sent documents, admin hasn't decided | "under review" screen |
| `VERIFICATION_REJECTED` | admin rejected the documents               | re-upload screen       |
| `READY`                 | done                                       | home                   |
| `BLOCKED` / `SUSPENDED` | moderation                                 | error screen           |

A matching `message` comes back with it, so the app has something to display
without inventing wording.

This is computed in one place — `resolveAccountState` in
`src/modules/users/users.state.ts` — because two columns decide it together
(`User.status` **and** `TechnicianProfile.verificationStatus`). Never re-derive
it by hand in a route; call that function.

### "Waiting for approval", specifically

A technician is **never** `READY` on their own. The sequence is:

```
picks TECHNICIAN               role = TECHNICIAN, no profile row yet
                               → accountState SUBMIT_DOCUMENTS
        ↓
submits documents (task 3)     TechnicianProfile created, verificationStatus = PENDING
                               → accountState WAITING_FOR_APPROVAL
        ↓
admin approves (task 5)        verificationStatus = VERIFIED, user.status = ACTIVE
                               → accountState READY
        ↓ (or)
admin rejects (task 5)         verificationStatus = REJECTED, user.status stays PENDING
                               → accountState VERIFICATION_REJECTED, can resubmit
```

They stay in `WAITING_FOR_APPROVAL` however many times they close and reopen
the app — logging in again returns the same state, so they are never pushed
back through onboarding. **That already works**; it starts the moment task 3
creates the `TechnicianProfile` row. You do not have to build it.

**2. Step 4 splits the flow in two, and the choice is saved.**

`PATCH /me/role` stores the answer and replies with the state that tells the
app where to go:

```
selects CUSTOMER    → COMPLETE_PROFILE   app opens, land on the profile page
selects TECHNICIAN  → SUBMIT_DOCUMENTS   land on the national id / criminal
                                         record form instead
```

Saving it matters for two reasons. A technician must never be routed to the
customer profile page — they have their own, longer form. And if either user
closes the app halfway, logging back in returns the *same* state, so they
resume exactly where they stopped instead of starting over.

The role is locked once onboarding finishes (409 after documents are submitted,
or once the account is ACTIVE) — otherwise a technician could flip to customer
and strand their profile, offers and reviews. `ADMIN` is rejected outright: the
schema does not accept it, so nobody promotes themselves by calling their own
account endpoint.

**The technician form is the customer form plus documents.** Because a
technician skips the profile page, `POST /technician/profile` collects the same
name / city / address / location *and* the national id and criminal record, in
one submission.

### Two profile endpoints, not one

```
POST /api/v1/customer/profile      ← the app calls this if CUSTOMER was picked
POST /api/v1/technician/profile    ← this one if TECHNICIAN was picked
```

Same verb, same shape of URL, same response envelope — the app just picks the
one matching the role it already chose on the previous screen.

It is tempting to have a single `POST /users/profile` with a `role` field
instead. Don't: the two payloads genuinely differ (a technician also sends
`categoryId`, `nationalId`, `criminalRecordFile`), so one endpoint would need
"these fields are required *only* when role is TECHNICIAN" conditional
validation. Two endpoints means each has one flat, obvious payload — easier to
validate, easier to document, and the frontend already knows which branch it is
on.

Neither endpoint creates a *user*. That row was created when the OTP was
verified. The customer one fills in the blanks on it; the technician one fills
in the blanks **and** creates the `TechnicianProfile` row.

#### The contract

Both reply with the same envelope, so the app can handle them with one code path:

```jsonc
// 201 Created
{
  "data": {
    "user": { "id": "12", "fullName": "…", "role": "CUSTOMER", "status": "ACTIVE", … },
    "accountState": "READY",              // technician: "WAITING_FOR_APPROVAL"
    "message": "Your account is ready"
  }
}
```

The technician response also carries `technicianProfile`.

```jsonc
// POST /api/v1/customer/profile     Authorization: Bearer <accessToken>
{
  "fullName": "Mona Ali",
  "city": "Giza",
  "address": "12 Nile St",
  "latitude": 30.0131,
  "longitude": 31.2089
}

// POST /api/v1/technician/profile  — the same five, plus three
{
  "fullName": "Karim Fathy",
  "city": "Cairo",
  "address": "5 Tahrir",
  "latitude": 30.0444,
  "longitude": 31.2357,

  "categoryId": "1",                            // picked back on screen 3
  "nationalId": "29805150101234",               // the 14 digits, as text
  "criminalRecordFile": "/uploads/1712-rec.pdf",// optional, URL from POST /public/uploads
  "profileImage": "/uploads/1712-me.jpg"        // optional
}
```

Neither body carries a `userId`: the profile always belongs to the caller, and
the route reads that from the token. Accepting one as a field would let a user
file a profile against somebody else's account.

### Signing up in one call

Everything above assumes the app asks one question per screen. An app that puts
the role, the profile and the documents on a single form calls this instead:

```
POST /api/v1/me/signup       Authorization: Bearer <accessToken>
                             Content-Type: multipart/form-data
```

| Field                | Customer | Technician | Notes |
| -------------------- | -------- | ---------- | ----- |
| `fullName`           | required | required   | |
| `city`               | required | required   | |
| `address`            | required | required   | |
| `latitude`           | required | required   | |
| `longitude`          | required | required   | |
| `role`               | required | required   | `CUSTOMER` or `TECHNICIAN` |
| `categoryId`         | dropped  | required   | from `GET /public/categories` |
| `nationalId`         | dropped  | required   | **text** — the 14 digits, not a file |
| `criminalRecordFile` | rejected | optional   | the file |
| `profileImage`       | rejected | optional   | the file |

A customer who attaches a *file* gets a `400`, not a silent drop — the
alternative is a technician who picked the wrong role watching their documents
vanish. The two technician-only text fields are simply ignored.

The response is the contract above plus `technicianProfile`, which is `null`
for a customer. `accountState` is `READY` for a customer and
`WAITING_FOR_APPROVAL` for a technician — same two destinations as the
step-by-step flow, because it is the same code underneath.

Four things worth knowing:

- **It is on `/me`, not `/customer` or `/technician`.** Those groups sit behind
  `requireRole`, and the role is exactly what this call is being told. It is
  what the caller *becomes*, so it cannot also be the guard.
- **A customer sends no files, so plain JSON works for them too.** Multer stands
  aside when the request is not multipart.
- **Uploads go through the same rules as task 4**: JPEG, PNG or PDF, at most
  5 MB each. The server renames every file, so the client's filename is ignored.
  A signup that fails for any reason deletes whatever it had already stored.
- **The rules are the same**: no `userId` in the body, `409` if the account has
  already finished signing up, and `accountState` from `resolveAccountState`.

Files land in `UPLOAD_DIR` (default `uploads/`) and are served back under
`/uploads/…`, which is what the stored URLs point at.

### What the upload path does and does not protect against

Handled:

- **Type and size.** jpeg / png / pdf, 5 MB, 2 files per request.
- **The filename.** Never reused from the client — it is
  `${Date.now()}-${randomUUID()}` plus an extension taken from our own mime
  table, so `../` and double extensions cannot get through.
- **Orphans on failure.** A signup that fails at any point deletes whatever it
  had already stored, so a rejected attempt leaves nothing behind.
- **Content sniffing.** Multer can only believe the `Content-Type` the client
  declared, so a `.jpg` may hold anything. Files are served with
  `X-Content-Type-Options: nosniff`, and PDFs additionally with
  `Content-Disposition: attachment` — a PDF can carry JavaScript and the
  browser's viewer would otherwise run it on this origin. Images stay inline so
  the app can point an `<img>` at a profile photo.

Not handled — decide these before real identity documents go through:

- **The URL is the only credential.** Anyone holding it can read the file; the
  random name is all that protects it. That is why
  `toTechnicianProfileResponse` never returns `criminalRecordFile` — or the
  `nationalId` number itself — to a non-admin. Signed URLs, or serving documents
  through an authenticated route, is the fix.
- **Nothing is ever deleted.** Soft-deleting a user leaves their documents on
  disk forever, and there is no retention policy or disk quota. Growth is
  unbounded.
- **One node only.** The files are on local disk, so a second app container
  would not see them. Moving `uploads.storage.ts` to S3 is the one-module change
  that fixes this and the two points above at once.
- **A rejected technician cannot resubmit.** `VERIFICATION_REJECTED` is
  reachable, but both `POST /me/signup` and `POST /technician/profile` answer
  `409` once a profile row exists — there is no endpoint that replaces the
  documents. Needs building alongside task 5.

**3. The category picked at step 3 is only stored for technicians.**

For a technician it is their speciality, and `TechnicianProfile.categoryId`
requires it — the app holds the chosen id and posts it with the documents.

For a customer it is just "what am I shopping for today". There is no column
for it and it doesn't need one: the app keeps it in memory and sends it later
as `categoryId` when the customer creates a service request.

So step 3 is a plain read — list the categories so the user can pick one.

## What is already built

```
POST  /api/v1/public/auth/request-otp     { phone }
POST  /api/v1/public/auth/verify-otp      { phone, otpCode }
POST  /api/v1/public/auth/refresh         { refreshToken }
GET   /api/v1/me                          who am I + accountState
PATCH /api/v1/me/role                     { role: "CUSTOMER" | "TECHNICIAN" }
POST  /api/v1/me/signup                   role + profile + documents, one call
```

Rules baked into `src/modules/auth/auth.service.ts` (all the numbers are named
constants at the top of that file):

- code is 6 digits, valid for **5 minutes**, single use
- **60 seconds** between resends
- **5** wrong guesses locks the phone for **15 minutes**
- `BLOCKED`/`SUSPENDED` users cannot log in, refresh, or use an existing token

`verify-otp` also hands out the JWTs everything else needs — access (15 min)
and refresh (30 days). The guards that check them live in
`src/modules/auth/auth.middleware.ts` and are applied per audience group in
`src/api/index.ts`; the README has the full picture.

There is no SMS provider yet. The code is printed in the `npm run dev` terminal
and returned as `devOtpCode` in the response, which is stripped in production.
Wiring a real provider means editing one function: `sendOtpSms` in
`src/modules/auth/auth.sms.ts`.

---

# Tasks

**The files already exist.** Each task below is a folder under `src/modules/`
with every file created, every function named, and every body left empty:

```
src/modules/categories/     task 1    schema · service · mapper · public+admin routes
src/modules/users/
  users.customer.routes.ts  task 2 ✅ done
src/modules/technicians/    tasks 3+5 schema · service · mapper · technician+admin routes
src/modules/uploads/        task 4    public routes
```

They are already mounted in `src/api/`, so the URLs are live and answer `501`.
Nothing needs wiring up — open the file, follow the `TODO(task N)` comments,
replace the `throw ApiError.notImplemented()` with the real body.

The complete, working reference for all of it is `src/modules/users/` — every
pattern you need is in there.

Reminders that apply to all of them:

- **Never `try`/`catch` in a route.** `throw ApiError.notFound("…")`; the error
  handler turns it into JSON.
- **No SQL in a route file, no `req`/`res` in a service file.**
- **Ids are BigInt** — parse them with `idParams` from `src/core/fields.ts`.
- **Filter `deletedAt: null`** on anything that reads users.
- `npm run typecheck` before you push.

## Task 1 — Categories (start here)

The simplest possible module, and the one screen 3 needs.

```
GET    /api/v1/public/categories        list, no pagination — there are few
GET    /api/v1/admin/categories/:id
POST   /api/v1/admin/categories         { name, homeVisitBasePrice }
PATCH  /api/v1/admin/categories/:id
DELETE /api/v1/admin/categories/:id
```

- Model: `Category` (already in `schema.prisma`).
- `name` is unique — a duplicate already returns 409 on its own, no check needed.
- `homeVisitBasePrice` is a `Decimal`. **Return it as a string**
  (`price.toString()`), never a float.
- Mount the public list in `src/api/public.ts`, the rest in `src/api/admin.ts`.

## Task 2 — Customer creates their profile ✅ done

Screen 5a. Turns a phone-only row into a usable account.

```
POST /api/v1/customer/profile        Authorization: Bearer <accessToken>
  { fullName, city, address, latitude, longitude }
```

- All five profile fields are required here, even though the columns are
  nullable — nullable means "not filled in *yet*", and this is the screen that
  fills them in.
- On success set `status` to `ACTIVE`. That is what makes the account usable.
- Reply `201` with `{ user, accountState, message }` — see *The contract*
  above. Take the state from `resolveAccountState(user, null)`, never hardcode
  `"READY"`.
- 404 if the user doesn't exist or is soft-deleted; 409 if they already
  finished (`status !== PENDING`), the way `selectRole` does.
- `users.service.ts` already has almost all of this — reuse `updateUserFields`
  rather than writing new Prisma calls.

> No `userId` in the body: the group is behind `requireAuth` +
> `requireRole("CUSTOMER")`, so the caller is already known. Read them with
> `currentUser(req)` from `modules/auth/auth.middleware.js` and pass the id to
> the service — the technician twin does exactly this.

## Task 3 — Technician submits documents ✅ done

Screen 5b. Kept here as the worked example for task 2 — it is the same shape,
and it shows where the caller's id comes from. Still depends on task 4 for the
file URLs themselves.

```
POST /api/v1/technician/profile      Authorization: Bearer <accessToken>
  { fullName, city, address, latitude, longitude,   ← same as the customer form
    categoryId, nationalId, criminalRecordFile?, profileImage? }
```

The technician skips the profile page entirely, so this one form collects their
personal details **and** their documents. Import `profileFields` from
`users.schema.ts` instead of retyping the first five.

- Model: `TechnicianProfile`. `userId` is unique — one profile per user.
- Do all of this **in one `prisma.$transaction`**, because they must not half-happen:
  1. write the personal details onto the `User` row (role is already
     `TECHNICIAN` from step 4, but setting it again is harmless)
  2. create the `TechnicianProfile` with `verificationStatus: PENDING`
- Leave the user's `status` as `PENDING` — a technician is not active until an
  admin approves them (task 5).
- Return `accountState: "WAITING_FOR_APPROVAL"` and its `message` alongside the
  profile, so the app can show the "under review" screen straight away instead
  of making a second call. Get both from `modules/users/users.state.js`.
- `nationalId` is the **14 digits off the card**, as text. `core/national-id.ts`
  checks the century digit, the birth date and the governorate code before it
  reaches the database.
- `criminalRecordFile` and `profileImage` are **URL strings**, not files. The
  upload happens first (task 4) and the client sends back the returned URLs.

## Task 4 — File upload

Needed by task 3. **Most of it already exists**: `POST /api/v1/me/signup` had to
store files, so `src/modules/uploads/uploads.storage.ts` now holds the whole
storage layer — the configured multer instance, the type and size limits, the
renaming, and `publicUrlFor`. `app.ts` already serves the folder.

What is left is the standalone endpoint, for clients that upload before they
submit a form:

```
POST /api/v1/public/uploads    multipart/form-data, field name "file"
  → { data: { url: "/uploads/1712345678-<uuid>.jpg" } }
```

- Import `upload` and `publicUrlFor` from `uploads.storage.js` rather than
  configuring a second multer — the limits must not diverge between the two
  upload paths.
- `upload.single("file")` as route middleware, then
  `res.status(201).json({ data: { url: publicUrlFor(req.file) } })`.
- Rejections already answer correctly: `core/error-handler.ts` turns a
  `MulterError` into a 400 and an unsupported type into `unsupported_file_type`.
- Worth moving behind `requireAuth` while you are there — see the note in
  `src/api/public.ts`. Everyone who uploads has a token by then.
- Local disk is fine for now; S3 can replace that one module later.

## Task 5 — Admin approves a technician

The last step before a technician can receive work.

```
PATCH /api/v1/admin/technicians/:id/verification
  { verificationStatus: "VERIFIED" | "REJECTED" }
```

- On `VERIFIED`, also set the **user's** `status` to `ACTIVE` (transaction again).
- On `REJECTED`, leave the user `PENDING` so they can resubmit.
- Also worth adding: `GET /api/v1/admin/technicians?verificationStatus=PENDING`
  so admins can find the queue — copy the list/filter code from
  `users.service.ts`.

## Suggested order

Task 1 alone (easiest, teaches the module shape) → then 4 → then 2 and 3 in
parallel → then 5.
