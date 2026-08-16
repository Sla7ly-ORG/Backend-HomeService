# App flow — which API to call, when

For whoever is building the app. Every screen, the call it makes, and what to
do with the answer.

Base URL: `http://localhost:3000/api/v1`
Socket: `http://localhost:3000` (Socket.IO, default path) — see
[Live updates](#live-updates-socketio).

> **Auth.** Screens 1 and 2 are open. From screen 3 on, every call carries
> `Authorization: Bearer <accessToken>` — the token you got from `verify-otp`.
> No endpoint takes a `userId`: the server reads who you are from the token, so
> sending one would be ignored anyway. See [Tokens](#tokens) at the bottom.

This doc has two halves: **signing up** (screens 1–5, below) and **ordering a
service** (everything after [After signup](#after-signup--ordering-a-service)).

## The whole journey

```
  ┌─────────────────┐
  │ 1. Enter phone  │  POST /public/auth/request-otp
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │ 2. Enter code   │  POST /public/auth/verify-otp
  └────────┬────────┘
           │  → returns tokens + accountState, which decides everything below
           ▼
  ┌─────────────────┐
  │ 3. Pick a field │  GET /public/categories
  │    (plumbing…)  │  keep the chosen id in memory
  └────────┬────────┘
           ▼
  ┌─────────────────────────┐
  │ 4. Customer or          │  PATCH /me/role
  │    technician?          │
  └───┬─────────────────┬───┘
      │ CUSTOMER        │ TECHNICIAN
      ▼                 ▼
 ┌──────────┐    ┌──────────────────┐
 │ 5a.      │    │ 5b. Same fields  │  POST /public/uploads  (×2)
 │ Profile  │    │  + national ID   │  then
 │ form     │    │  + criminal rec. │  POST /technician/profile
 └────┬─────┘    └────────┬─────────┘
      │                   ▼
      │           ┌──────────────────┐
      │           │ Waiting for      │  no call — poll by logging in again,
      │           │ admin approval   │  or wait for a push notification
      │           └────────┬─────────┘
      │                    │ admin approves
      ▼                    ▼
 ┌────────────────────────────┐
 │        Profile screen      │
 └────────────────────────────┘
```

### Or: screens 4 and 5 on one form

If your signup is a single form rather than a screen per question, replace
everything from step 4 down with one call:

```
  ┌─────────────────┐
  │ 2. Enter code   │  POST /public/auth/verify-otp
  └────────┬────────┘
           │  isNewUser: true  →  show the signup form
           ▼
  ┌──────────────────────────┐
  │ Signup form              │  POST /me/signup   multipart/form-data
  │  name, city, address,    │
  │  location, role,         │  the files go in this same request —
  │  + docs if TECHNICIAN    │  no separate upload call
  └────────┬─────────────────┘
           ▼
     CUSTOMER → READY (profile screen)
     TECHNICIAN → WAITING_FOR_APPROVAL (waiting screen)
```

You still need `GET /public/categories` (screen 3) to populate the category
picker on that form, since a technician has to send `categoryId`.

See [Signup in one call](#signup-in-one-call) below for the exact fields. Both
routes are supported and reach the same place, so pick whichever matches your
UI — you do not have to use the same one for customers and technicians.

---

## Screen 1 — Enter phone

```http
POST /public/auth/request-otp
{ "phone": "+201112223334" }
```

```jsonc
// 200
{ "data": { "expiresAt": "2026-08-02T08:23:40.510Z", "devOtpCode": "764249" } }
```

- `devOtpCode` only exists while there is no SMS provider. **Use it to test**,
  and never show it in the UI — it disappears in production.
- Start a 60-second countdown before enabling "resend". Asking sooner returns
  `429` with the seconds left in the message.
- Show `expiresAt` as a 5-minute countdown on the next screen.

## Screen 2 — Enter the 6-digit code

```http
POST /public/auth/verify-otp
{ "phone": "+201112223334", "otpCode": "764249" }
```

```jsonc
// 200
{
  "data": {
    "user": { "id": "12", "phone": "+201112223334", "role": "CUSTOMER",
              "status": "PENDING", "fullName": null, … },
    "isNewUser": true,
    "accountState": "COMPLETE_PROFILE",
    "message": "Please complete your profile",
    "tokens": {
      "tokenType": "Bearer",
      "accessToken": "eyJhbGciOiJIUzI1NiIs…",
      "expiresIn": 900,                       // seconds
      "refreshToken": "eyJhbGciOiJIUzI1NiIs…",
      "refreshExpiresIn": 2592000
    }
  }
}
```

**Store both tokens** — in the keychain / encrypted store, not in plain
preferences. The access token goes on every later call; the refresh token is
only ever sent to `/public/auth/refresh`. You do not need to store `user.id`
for API calls any more, only for display: the server reads it from the token.

**Then route on `accountState`, not on `isNewUser`.** See the table at the
bottom; it is the same logic every time the app opens.

Failures to handle:

| Response | Meaning | Do |
| --- | --- | --- |
| `400` "Wrong code. 3 attempt(s) left." | wrong digits | show the message, let them retry |
| `400` "This code has expired…" | >5 min | send them back to screen 1 |
| `400` "This code was already used" | replay | back to screen 1 |
| `429` | 5 wrong tries — locked 15 min | show the message, block the form |
| `403` | account blocked/suspended | dead end, show support info |

## Screen 3 — Pick a field

```http
GET /public/categories
```

```jsonc
{ "data": [ { "id": "1", "name": "سباكة", "homeVisitBasePrice": "150.00" } ] }
```

- Not paginated — there are only a handful.
- **Keep the chosen `id` in app memory.** Nothing is saved server-side at this
  step. A technician sends it later as `categoryId`; a customer sends it when
  creating a service request.
- Prices are **strings**, on purpose. Don't parse them into a float — format
  them for display as-is.

## Screen 4 — Customer or technician?

```http
PATCH /me/role
Authorization: Bearer <accessToken>
{ "role": "TECHNICIAN" }
```

```jsonc
{
  "data": {
    "user": { … "role": "TECHNICIAN" },
    "accountState": "SUBMIT_DOCUMENTS",
    "message": "Please enter your national ID and upload your criminal record to finish signing up"
  }
}
```

Route on the returned `accountState`:

| Picked | `accountState` | Go to |
| --- | --- | --- |
| `CUSTOMER` | `COMPLETE_PROFILE` | screen 5a |
| `TECHNICIAN` | `SUBMIT_DOCUMENTS` | screen 5b |

This is saved, so if the user closes the app here and comes back, screen 2
returns the same state and they land on the right form — never back at this
screen, and a technician never on the customer profile page.

`409` means they already finished signing up; send them home instead.

## Screen 5a — Customer profile

```http
POST /customer/profile
Authorization: Bearer <accessToken>
{ "fullName": "Mona Ali", "city": "Giza",
  "address": "12 Nile St", "latitude": 30.0131, "longitude": 31.2089 }
```

```jsonc
// 201
{ "data": { "user": { … "status": "ACTIVE" },
            "accountState": "READY", "message": "Your account is ready" } }
```

→ Go to the home screen. Done.

## Screen 5b — Technician documents

**Two steps.** Upload each file first, then submit the form with the URLs you
get back.

```http
POST /public/uploads          multipart/form-data, field name "file"
Authorization: Bearer <accessToken>
```

```jsonc
// 201
{ "data": { "url": "/uploads/1712345678-criminal-record.pdf" } }
```

jpeg / png / pdf, max 5 MB. Call it once per file.

**It needs a token even though it lives under `/public`** — it is the one
endpoint there that writes to disk. Everyone who uploads has one by this point,
so nothing changes for the app except the header. Sending no file at all is a
`400`, not an empty `201`.

```http
POST /technician/profile
Authorization: Bearer <accessToken>
{ "fullName": "Karim Fathy", "city": "Cairo", "address": "5 Tahrir",
  "latitude": 30.0444, "longitude": 31.2357,

  "categoryId": "1",                              // from screen 3
  "nationalId": "29805150101234",                 // the 14 digits, typed in
  "criminalRecordFile": "/uploads/1712-rec.pdf",  // optional, from the upload above
  "profileImage": "/uploads/1712-me.jpg" }        // optional
```

```jsonc
// 201
{ "data": { "user": { … "role": "TECHNICIAN", "status": "PENDING" },
            "technicianProfile": { … "verificationStatus": "PENDING" },
            "accountState": "WAITING_FOR_APPROVAL",
            "message": "Your documents are under review. You will be notified once an admin approves your account." } }
```

→ Go to the waiting screen. Show `message`.

The technician form asks for the personal details **as well as** the documents,
because a technician never sees screen 5a.

`409` "Documents were already submitted" means they submitted before — go to
the waiting screen instead.

## Signup in one call

For a signup that is one form instead of three screens. Everything screens 4,
5a and 5b collect, in a single request — and the files go **in this request**,
so there is no separate upload call.

```http
POST /me/signup
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

| Field                | Customer | Technician | |
| -------------------- | -------- | ---------- | --- |
| `fullName`           | required | required   | 2–100 chars |
| `city`               | required | required   | |
| `address`            | required | required   | |
| `latitude`           | required | required   | −90…90 |
| `longitude`          | required | required   | −180…180 |
| `role`               | required | required   | `CUSTOMER` or `TECHNICIAN` |
| `categoryId`         | ✗        | required   | the id from screen 3 |
| `nationalId`         | ✗        | required   | **text**, the 14 digits off the card |
| `criminalRecordFile` | ✗        | optional   | the file — jpeg/png/pdf, ≤ 5 MB |
| `profileImage`       | ✗        | optional   | the file |

✗ means the field does not belong to that role. Attaching a *file* as a customer
is a `400` rather than a silent drop, so a technician who picked the wrong role
finds out instead of losing their documents; the text-only `categoryId` and
`nationalId` are simply dropped.

`nationalId` is a text field, not an upload — attaching it as a file is a `400`.
It has to be 14 digits that actually spell out a card:

```
2 98 05 15 01 0123 4    → 29805150101234
^ ^  ^  ^  ^  ^    check digit (not verified — the algorithm is not public)
| |  |  |  |  serial
| |  |  |  governorate, 01–35 or 88 for born abroad
| |  |  day
| |  month
| year
century: 2 = 1900s, 3 = 2000s
```

The birth date has to be a real, past date, so `2981315…` (month 13) and
`2980230…` (30 February) come back as a `400` naming the digits at fault.

A customer sends no files at all, so you can post plain JSON for them if that
is easier:

```http
POST /me/signup
Content-Type: application/json
{ "fullName": "Mona Ali", "city": "Giza", "address": "12 Nile St",
  "latitude": 30.0131, "longitude": 31.2089, "role": "CUSTOMER" }
```

```jsonc
// 201 — customer
{ "data": { "user": { … "role": "CUSTOMER", "status": "ACTIVE" },
            "technicianProfile": null,
            "accountState": "READY",
            "message": "Your account is ready" } }

// 201 — technician
{ "data": { "user": { … "role": "TECHNICIAN", "status": "PENDING" },
            "technicianProfile": { … "verificationStatus": "PENDING" },
            "accountState": "WAITING_FOR_APPROVAL",
            "message": "Your documents are under review. …" } }
```

→ Switch on `accountState` exactly as you would after screen 5a or 5b.

What can come back instead:

| Status | When |
| ------ | ---- |
| `400` | a missing or malformed field, a national id that is not 14 valid digits, a file over 5 MB, a type that is not jpeg/png/pdf, a customer that attached a file, or a technician that forgot `nationalId` |
| `409` | this account already finished signing up — go to the waiting screen or the profile screen, do not retry |
| `401` | no token, or an expired one — refresh it |

A rejected signup stores nothing and keeps no files, so it is safe to fix the
form and post it again.

## The waiting screen

A technician stays here until an admin approves them. To find out when that
happens:

```http
GET /me
Authorization: Bearer <accessToken>
```

```jsonc
{ "data": { "user": { … }, "technicianProfile": { … },
            "accountState": "WAITING_FOR_APPROVAL", "message": "…" } }
```

Poll that on pull-to-refresh or a slow timer, or wait for a push notification
once that is built. **Never poll `verify-otp`** — it sends a real SMS each time
and the 60-second cooldown will start returning `429`.

---

# After signup — ordering a service

Everything above gets an account to `READY`. This half is what the app is for:
the customer describes a problem, either has an AI size it up or asks straight
for a consultation, sends it out to every technician in that field, watches
their fees arrive live, and picks one.

```
  Profile / home
   ├── tokens balance      GET  /customer/points
   ├── past orders         GET  /customer/requests
   └── [ Say your problem ]
             │
             ▼
   Pick a service          GET  /public/categories
             │
             ▼
   How do you want to fix it?
        ┌────┴─────────────────────────┐
        ▼                              ▼
 [ Describe it with AI ]      [ Order a consultation ]
   photo + description           photo + description
        │                              │
   POST /customer/requests        POST /customer/requests
   requestType AI_ESTIMATION      requestType CONSULTATION
        │  → a draft                   │  → a draft
        ▼                              │
   POST …/:id/ai-estimation            │
   −50 tokens                          │
   → the AI's answer + price range     │
        │                              │
        └──────────┬───────────────────┘
                   ▼  [ Send ]
   POST /customer/requests/:id/publish
   → goes out to every technician in that service, live
                   │
      ┌────────────┴─────────────────────────┐
      ▼                                      ▼
  Customer waits                     Technician's job feed
  GET  …/:id/offers                  GET  /technician/jobs
  socket: offer:new                  socket: job:new
  [ Cancel ]  POST …/:id/cancel      POST /technician/jobs/:id/offer
                   │                        { consultationFee }
                   ▼                        POST …/:id/decline
  Offers list: photo, past orders,
  distance, fee
  POST …/offers/:offerId/accept
                   │
                   ▼
  TECHNICIAN_SELECTED — the two of them now see each other's phone,
  and the job disappears from every other technician's feed.
```

Two things to get straight before reading further, because the whole screen
flow hangs off them:

- **A request is a draft until you publish it.** `POST /customer/requests`
  writes a row with `status: "PENDING"` and tells nobody. Only `publish` sends
  it out. That split exists so the AI branch has somewhere to attach its answer
  before the customer has agreed to send anything.
- **The offer fee is the price of *coming out*, not of the repair.** A
  technician offers what they charge for the consultation / home visit. The AI
  price range is a separate guess at what fixing the thing might eventually
  cost, and nobody is bound by it.

## Home / profile screen

Three calls, all cheap, all safe to fire in parallel on load.

```http
GET /me                      → the user, incl. pointsBalance
GET /customer/points         → { "data": { "pointsBalance": 250 } }
GET /customer/requests       → past orders, paginated
```

`GET /me` already carries `pointsBalance`, so you only need
`GET /customer/points` for the wallet screen or after spending. **The UI calls
them tokens or credits; the API calls them points** — same number, and it is a
plain integer, not money, so this is the one field you do *not* keep as a
string.

Past orders:

```jsonc
// GET /customer/requests?page=1&limit=20
{ "data": [ { "id": "12", "title": "Kitchen sink leaking",
              "categoryName": "سباكة", "status": "TECHNICIAN_SELECTED",
              "requestType": "AI_ESTIMATION", "visitFee": "180.00",
              "technicianName": "Karim Fathy", "offersCount": 3,
              "createdAt": "2026-08-08T09:12:00.000Z" } ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 } }
```

Drafts are **not** in this list. A customer who opened the AI screen and backed
out has a `PENDING` row, and it is not an order — pass `?status=PENDING`
explicitly if you ever want to show unfinished ones. `?status=` also takes
`WAITING_FOR_TECHNICIAN`, `TECHNICIAN_SELECTED`, `COMPLETED`, `CANCELLED`.

Recharging tokens is not built yet — see *Recharging* in
[`INTERN-TASKS.md`](INTERN-TASKS.md). Until it is, an admin grants them.

## "Say your problem" → pick a service

The same `GET /public/categories` as screen 3. Keep the chosen `id` in memory;
you send it with the request on the next screen but one.

## How do you want to fix it?

No call. Two buttons, and all they do is decide the `requestType` you send next:

| Button | `requestType` | Costs | Next |
| --- | --- | --- | --- |
| Describe it with AI | `AI_ESTIMATION` | 50 tokens | the AI screen |
| Order a consultation | `CONSULTATION` | free | the consultation screen |

Grey out the AI button when `pointsBalance < 50` and point at the recharge
screen instead — the server also refuses with `402`, but the customer should
find out before they have typed a paragraph.

## Describing the problem — both branches

Both screens collect the same thing: **a photo and a description**. Upload the
photo first, then create the request with the URL you got back.

```http
POST /public/uploads          multipart/form-data, field "file"
Authorization: Bearer <accessToken>
→ { "data": { "url": "/uploads/1712-sink.jpg" } }
```

```http
POST /customer/requests
Authorization: Bearer <accessToken>
{ "title": "Kitchen sink leaking",
  "description": "Water under the sink since yesterday, the joint is wet.",
  "categoryId": "1",
  "requestType": "AI_ESTIMATION",          // or "CONSULTATION"
  "images": ["/uploads/1712-sink.jpg"] }   // 1–5, required either way
```

```jsonc
// 201
{ "data": { "id": "12", "status": "PENDING", "requestType": "AI_ESTIMATION",
            "title": "Kitchen sink leaking", "images": [ … ],
            "categoryId": "1", "categoryName": "سباكة",
            "aiEstimation": null, "offersCount": 0, … } }
```

- `title` is 3–120 characters, `description` 10–2000.
- **At least one image, at most five**, both branches. The AI needs something to
  look at, and a technician deciding on a fee does too.
- The address is taken from the profile and **copied onto the request**. Send
  `serviceAddress` / `serviceCity` / `latitude` / `longitude` only if the
  customer is ordering for somewhere other than home.
- `status: "PENDING"` means *draft*. Nothing has been sent to anybody yet.

**Keep the returned `id`.** Everything from here on is a call on that request.

### The AI branch — one more call

```http
POST /customer/requests/12/ai-estimation
Authorization: Bearer <accessToken>
```

No body: the server already has the title, the description and the photos. It
sends them to the model, waits, charges the 50 tokens, and answers:

```jsonc
// 201
{ "data": {
    "estimation": {
      "severity": "MEDIUM",
      "summary": "المشكلة على الأغلب في وصلة ماسورة تحت الحوض. محتاجة فني سباكة يغيّر الوصلة والجوان.",
      "minPrice": "375.00", "maxPrice": "900.00",
      "confidence": "0.82"
    },
    "pointsCharged": 50,
    "pointsBalance": 200 } }
```

Show `summary` as the answer, `minPrice`–`maxPrice` as the expected repair
cost, and `pointsBalance` in the wallet chip — that is why it comes back here,
so the screen does not need a second call to find out what the first one cost.

This call can be slow: it is waiting on a model. Show a spinner and allow up to
20 seconds.

| Response | Meaning | Do |
| --- | --- | --- |
| `402 insufficient_points` | fewer than 50 tokens | send them to recharge; nothing was charged |
| `503 service_unavailable` | the model timed out or answered nonsense | offer "try again" and "order a consultation instead". **Nothing was charged** |
| `409 conflict` | not an `AI_ESTIMATION` request, or it is already published | you are on the wrong screen |
| `201`, same estimate, `pointsCharged: 0` | you called it twice | fine — an estimate is charged once, ever |

That last row matters: a request that timed out on the client but succeeded on
the server can be retried safely. **Never charge the customer twice for the
same answer, and never show them a "pay again" dialog.**

The consultation branch skips all of this and goes straight to Send.

## The Send button — publishing

```http
POST /customer/requests/12/publish
Authorization: Bearer <accessToken>
```

```jsonc
// 200
{ "data": { "request": { "id": "12", "status": "WAITING_FOR_TECHNICIAN", … },
            "technicianCount": 7 } }
```

That is the moment the request reaches technicians. `technicianCount` is how
many it went to.

- **`technicianCount: 0` is a success, not an error.** Nobody in that field is
  near them yet. Say so on the waiting screen — "no technicians in your area
  right now" — and offer to cancel. Be straight about it: the request went to
  the technicians who were available at that second, and nobody who signs up
  afterwards will see it, so waiting on that screen will not help.
- `409` means it was published already, or it is an `AI_ESTIMATION` with no
  estimate on it yet.

## Waiting for offers

The screen after Send. It has a list that fills up on its own, and a Cancel
button.

```http
GET /customer/requests/12/offers
```

```jsonc
{ "data": [
  { "id": "31",
    "consultationFee": "180.00",
    "submittedAt": "2026-08-08T09:20:11.000Z",
    "technician": {
      "id": "7",
      "fullName": "Karim Fathy",
      "profileImage": "/uploads/1712-karim.jpg",
      "categoryName": "سباكة",
      "city": "Cairo",
      "distanceKm": "3.40",
      "pastOrdersCount": 34,
      "overallRating": "4.60",
      "totalReviews": 12 } } ] }
```

Not paginated — at most five offers ever arrive, because the request closes
itself after the fifth. Sorted nearest first, best-rated first on a tie.

**Call this once when the screen opens, then let the socket do the rest.** A
new offer arrives as an `offer:new` event with exactly this object in it; push
it onto the list. Call it again on reconnect and on pull-to-refresh — the
socket is a speed-up, never the source of truth. See
[Live updates](#live-updates-socketio).

Cancel:

```http
POST /customer/requests/12/cancel      → 200, status CANCELLED
```

Allowed while the request is a draft, waiting, or even after a technician was
picked. Every outstanding offer is closed with it and the card vanishes from
the technicians' feeds. `409` means it is already finished or already
cancelled.

## Accepting one

```http
POST /customer/requests/12/offers/31/accept
Authorization: Bearer <accessToken>
```

```jsonc
// 200
{ "data": { "request": {
    "id": "12", "status": "TECHNICIAN_SELECTED",
    "visitFee": "180.00",                 // the fee that was accepted, frozen here
    "technician": { "id": "7", "fullName": "Karim Fathy",
                    "phone": "+201112223334",     // appears only now
                    "profileImage": "…", "overallRating": "4.60" }, … } } }
```

- **The phone number appears at this point and not before.** Up to here the
  technician is a photo, a distance and a rating; forty-nine other technicians
  saw the job and none of them ever get a phone number or a street address.
- The accepted fee is **copied onto the request** as `visitFee`. It does not
  move afterwards, whatever the technician later charges for the repair itself.
- The other four offers are closed automatically. You do not have to do
  anything with them.
- `409 conflict` — this request already has a technician (two taps on a slow
  connection), or that offer never carried a fee. Refetch the offers list and
  show what is actually there.

## The technician side

Same login, same tokens, `READY` only after an admin approved them.

### Their job feed

```http
GET /technician/jobs?page=1&limit=20
Authorization: Bearer <technician accessToken>
```

```jsonc
{ "data": [
  { "id": "31",                        // ← the offer row; this is the :id you act on
    "status": "PENDING",
    "createdAt": "2026-08-08T09:15:00.000Z",
    "request": {
      "id": "12",
      "requestType": "AI_ESTIMATION",
      "title": "Kitchen sink leaking",
      "description": "Water under the sink since yesterday…",
      "images": ["/uploads/1712-sink.jpg"],
      "categoryName": "سباكة",
      "aiEstimation": { "severity": "MEDIUM", "confidence": "0.8180",
                        "minPrice": "375.00", "maxPrice": "900.00" },
      "customer": { "fullName": "Mona", "city": "Giza", "distanceKm": "3.40" } },
    "fee": { "suggested": "150.00", "min": "75.00", "max": "450.00" } } ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 } }
```

- Only jobs in **their** category, within 25 km, that are still open.
- `fee.suggested` is what the category normally goes for — prefill the input
  with it. `min` and `max` are the bounds the server will accept, so the
  keypad can stop them before the `400` does.
- `aiEstimation` is `null` on a `CONSULTATION` job, and on an `AI_ESTIMATION`
  the customer has not paid for yet. The card should then show the photo and
  description alone; there is no price guess to display.
- **There is no `summary`.** The model returns a severity, not prose — the card
  shows the severity and the range and nothing written by the AI. `confidence`
  is the model's own **0..1**, not a percentage. `minPrice`/`maxPrice` come from
  the category's price band for that severity, not from the model, which never
  prices anything.
- **No phone number, no street address, no exact coordinates** — a first name,
  a city and a distance. That is deliberate and it does not change until they
  are chosen.
- `?status=` takes `SUBMITTED` (fees I have sent and am waiting on) or
  `DECLINED`. The default is `PENDING`: the new ones.

### Sending a fee

```http
POST /technician/jobs/31/offer
Authorization: Bearer <technician accessToken>
{ "consultationFee": 180 }
```

```jsonc
// 200
{ "data": { "id": "31", "status": "SUBMITTED", "consultationFee": "180.00",
            "submittedAt": "…" } }
```

```http
POST /technician/jobs/31/decline       → 200, status DECLINED, card disappears
```

What can come back instead:

| Status | Meaning | Do |
| --- | --- | --- |
| `409 conflict` | somebody else was picked, the customer cancelled, five fees are already in, or this one was answered | drop the card and refresh the feed |
| `400` | the fee is outside `fee.min … fee.max` | show the bounds |

A fee is sent once. There is no editing it — decline and let it go if it was
wrong.

### When a card should disappear

Three reasons a card should vanish, plus the good one. All four arrive as socket
events:

| Event | Why | Do |
| --- | --- | --- |
| `job:closed` `{ requestId, reason: "TAKEN" }` | another technician was chosen | remove the card |
| `job:closed` `{ requestId, reason: "CANCELLED" }` | the customer cancelled | remove the card |
| `job:closed` `{ requestId, reason: "FULL" }` | five fees are in, the customer is deciding | remove the card |
| `job:selected` `{ requestId, offerId }` | **they got the job** | refetch — the customer's phone and address are now readable |

## Live updates (Socket.IO)

One socket per logged-in user, opened once the account is `READY` and closed on
logout. It carries notifications only: **every action is still an HTTP call.**
Nothing you emit to the server does anything.

```js
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  auth: { token: accessToken },      // the same access token, not the refresh one
  transports: ["websocket"],
});
```

The server puts you in your own rooms from the token — there is nothing to
join, and no way to listen to somebody else's jobs.

**Customer events**

| Event | Payload | Meaning |
| --- | --- | --- |
| `offer:new` | `{ requestId, offer }` — `offer` is one row of `GET …/offers` | a technician sent a fee |
| `request:updated` | `{ requestId, status }` | the request moved on |

**Technician events**

| Event | Payload | Meaning |
| --- | --- | --- |
| `job:new` | one card of `GET /technician/jobs` | a new job in their area and field |
| `job:closed` | `{ requestId, reason }` | remove that card — see the table above |
| `job:selected` | `{ requestId, offerId }` | they were chosen |

Five rules, and the app breaks in a subtle way without each of them:

- **Fetch on connect, and again on every reconnect.** A socket that was down for
  ten seconds missed whatever happened in those ten seconds and nothing replays
  it. The REST list is the truth; the socket only saves you from polling.
- **Match on ids, not on position.** `job:new` for a job already in the list
  (which happens after a reconnect race) must update, not duplicate.
- **The server hangs up roughly every 15 minutes, on purpose.** A socket is
  authenticated once, at the handshake, so it is dropped when the access token
  it was opened with would have expired — that is what keeps a blocked account
  from being fed forever. Treat the disconnect as routine: reconnect with a
  fresh token, refetch, carry on. Socket.IO's own reconnect will do it for you
  as long as `socket.auth.token` is current.
- **An expired token kills the socket, not just the requests.** On
  `connect_error` with `unauthorized`, refresh, then
  `socket.auth = { token: newToken }; socket.connect();`. Do this from the same
  place that already handles the HTTP `401` — one refresh, both channels.
- **Do not open a socket before `READY`.** A pending technician has no feed, and
  a blocked account is refused at the handshake.

```js
socket.on("connect_error", async (err) => {
  if (err.message === "unauthorized") {
    socket.auth = { token: await refreshAccessToken() };
    socket.connect();
  }
});
```

---

## When the app opens — the only routing table you need

With a stored token, call `GET /me`; without one, run screens 1–2. Either way
you get an `accountState` — switch on it:

| `accountState` | Screen | Why |
| --- | --- | --- |
| `COMPLETE_PROFILE` | screen 3 → 4 → 5a | customer branch, or role not picked yet |
| `SUBMIT_DOCUMENTS` | screen 5b | picked technician, documents not sent |
| `WAITING_FOR_APPROVAL` | waiting screen | documents in, admin hasn't decided |
| `VERIFICATION_REJECTED` | screen 5b again | rejected — let them re-upload |
| `READY` | home | done |
| `BLOCKED` / `SUSPENDED` | error screen | moderation; `verify-otp` returns `403` |

Never infer the screen from `role` or `status` yourself — those two columns
have to be read *together*, which is exactly what `accountState` does for you.
If a new state appears later, this table is the only thing that changes.

`READY` is also the one state that opens the socket — see
[Live updates](#live-updates-socketio). Close it on anything else.

---

## Conventions across every endpoint

**Success** — one object under `data`; lists add `meta`:

```jsonc
{ "data": { … } }
{ "data": [ … ], "meta": { "page": 1, "limit": 20, "total": 3, "totalPages": 1 } }
```

**Errors** — always the same shape, so one handler covers the whole API:

```jsonc
{ "error": { "code": "validation_error", "message": "…",
             "details": [ { "field": "phone", "message": "رقم التليفون لازم يكون…" } ] } }
```

| Status | Meaning |
| --- | --- |
| `400` | bad input — `details` lists the offending fields |
| `401` | no token, or it expired — refresh, then retry once |
| `403` | wrong audience for this endpoint, or the account is blocked/suspended |
| `404` | no such record |
| `409` | duplicate, or an action that no longer applies |
| `429` | too many OTP requests or wrong guesses |
| `501` | **endpoint not built yet** (see below) |
| `500` | our bug — report it |

**IDs are strings**, always. `"id": "12"`, not `12`. They are 64-bit integers
that don't fit in a JavaScript number — keep them as strings end to end.

**Money is a string** too (`"150.00"`). Never parse it into a float.

## Tokens

`verify-otp` hands back an access token and a refresh token. Put the access
token on every call outside `/public`:

```http
Authorization: Bearer <accessToken>
```

It lasts 15 minutes. When it runs out you get:

```jsonc
// 401
{ "error": { "code": "unauthorized", "message": "Your session has expired, refresh it" } }
```

Trade the refresh token for a new pair — no SMS, no login screen:

```http
POST /public/auth/refresh
{ "refreshToken": "eyJhbGciOiJIUzI1NiIs…" }
```

```jsonc
// 200 — same shape as verify-otp, minus isNewUser
{ "data": { "user": { … }, "accountState": "READY", "message": "…",
            "tokens": { "accessToken": "…", "refreshToken": "…", … } } }
```

**Store the new pair and drop the old one.** Do this in one place — an
interceptor that catches a `401`, refreshes, and replays the request once. If
the refresh itself fails (`401`, or `403` for a blocked account), clear both
tokens and send the user back to screen 1.

Two things worth knowing:

- **The refresh response carries a fresh `accountState`.** An admin may have
  approved the waiting technician since the app last looked, so route on it the
  same way you do after login.
- **A blocked account stops working within 15 minutes**, and cannot refresh at
  all — both return `403 "This account is blocked"`.

## What is live today

Working now:

```
POST  /public/auth/request-otp
POST  /public/auth/verify-otp
POST  /public/auth/refresh
GET   /public/categories            screen 3, and "pick a service"
GET   /me
PATCH /me/role
POST  /customer/profile             screen 5a
POST  /technician/profile           screen 5b
POST  /public/uploads               screen 5b, and every photo below
POST  /me/signup                    screens 4 + 5 in one call, files included
GET   /admin/technicians            back-office approval queue
PATCH /admin/technicians/:id/verification
      + the whole /admin/users and /admin/categories sections
```

**Signup works end to end**, both ways through it: screen by screen, or
`POST /me/signup` in one call. `POST /public/uploads` is live too, so the app
can upload a photo and hold the URL — note it now needs a token, even though it
sits under `/public`.

**The whole second half of this document is scaffolded.** Every URL below
is mounted and answers `501 not_implemented` today, so you can wire the screens
up, see the request leave the phone, and swap in the real handling as each task
lands. The task number is which one fills it in:

```
GET   /customer/points              tokens balance          task 6
GET   /customer/points/transactions                         task 6
POST  /customer/requests            the draft               task 7
GET   /customer/requests            past orders             task 7
GET   /customer/requests/:id                                task 7
POST  /customer/requests/:id/cancel                         task 7
POST  /customer/requests/:id/ai-estimation                  task 8
POST  /customer/requests/:id/publish   the Send button      task 10
GET   /technician/jobs              the technician's feed   task 10
POST  /technician/jobs/:id/offer    send a fee              task 10
POST  /technician/jobs/:id/decline                          task 10
GET   /customer/requests/:id/offers                         task 11
POST  /customer/requests/:id/offers/:offerId/accept         task 11
```

**The socket is the exception**: it is not listening yet, so a connection
attempt fails outright rather than answering politely. Build the screens to work
without it — fetch on open, pull to refresh — and turn the connection on when
task 9 lands. Nothing in the app should depend on an event arriving.

Progress on signup is tracked in [`ONBOARDING-FLOW.md`](ONBOARDING-FLOW.md);
everything after it, in [`INTERN-TASKS.md`](INTERN-TASKS.md).
