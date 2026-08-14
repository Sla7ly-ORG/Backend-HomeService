import { createRequire } from "node:module";
import {
  Severity,
  UserRole,
  VerificationStatus,
} from "../generated/prisma/enums.js";
import { paginationQuery } from "../core/pagination.js";
import {
  refreshBody,
  requestOtpBody,
  verifyOtpBody,
} from "../modules/auth/auth.schema.js";
import {
  createCustomerProfileBody,
  createUserBody,
  listUsersQuery,
  selectRoleBody,
  updateUserBody,
  updateUserStatusBody,
} from "../modules/users/users.schema.js";
import { createTechnicianProfileBody } from "../modules/technicians/technicians.schema.js";
import {
  grantPointsBody,
  listPointsQuery,
} from "../modules/points/points.schema.js";
import {
  createServiceRequestBody,
  listMyRequestsQuery,
} from "../modules/requests/requests.schema.js";
import {
  dataOf,
  fromZod,
  idPathParam,
  jsonBody,
  jsonResponse,
  listOf,
  object,
  queryParams,
  responseRef,
  responses,
  schemaRef,
  schemas,
  securitySchemes,
  withDescriptions,
  withExamples,
  type JsonSchema,
} from "./openapi.components.js";
import {
  createCategoryBody,
  updateCategoryBody,
} from "../modules/categories/categories.schema.js";
import { pingBody } from "../realtime/realtime.schema.js";

/**
 * The OpenAPI 3.1 description of this API, served as a Swagger page at `/docs`
 * and as raw JSON at `/docs/openapi.json` (see docs.routes.ts).
 *
 * It is assembled in code rather than kept in a hand-written YAML file for one
 * reason: **request bodies and query strings are generated from the same zod
 * schemas the routes parse**. A field added to `createUserBody` appears on the
 * docs page by itself, and a documented body the API would reject is
 * impossible. Only the response shapes are written out by hand, next to the
 * mapper they mirror - see openapi.components.ts.
 *
 * The layout below follows api/index.ts exactly, audience by audience, so the
 * two can be read side by side.
 */

const { version } = createRequire(import.meta.url)("../../package.json") as {
  version: string;
};

/** Marks an endpoint that exists in the route map but is not written yet. */
function scaffolded(task: number) {
  return `🔨 **Not built yet — returns \`501\`.** Intern task ${task}: the request and response documented here are the shape it will have once the handler is written. See \`docs/INTERN-TASKS.md\`.`;
}

/**
 * Opts an operation out of the token requirement declared at the bottom of the
 * document. Only the four `/public` endpoints and the two health checks use it,
 * which is exactly the set that has no guard in api/index.ts.
 */
const openToAnyone: never[] = [];

/**
 * The `{ user, accountState, message }` block every onboarding endpoint answers
 * with. The app reads `accountState` to decide which screen is next, and it is
 * always computed by `resolveAccountState` - never by a route.
 */
function accountStateEnvelope(extra: Record<string, JsonSchema> = {}) {
  return dataOf(
    object({
      user: schemaRef("User"),
      ...extra,
      accountState: schemaRef("AccountState"),
      message: schemaRef("AccountStateMessage"),
    }),
  );
}

/**
 * Examples for the fields the generator cannot invent anything sensible for, so
 * "Try it out" starts from a body worth pressing Execute on. `+201000000002` is
 * the seeded customer - see `npm run prisma:seed`.
 */
const phoneExample = "+201000000002";

const profileExamples = {
  fullName: "Mona Ali",
  city: "Giza",
  address: "12 Nile St",
  latitude: 30.0131,
  longitude: 31.2089,
};

/** Task 7. A body the seeded customer can actually file. */
const serviceRequestExamples = {
  title: "Kitchen sink is leaking",
  description: "Water under the sink since yesterday, the pipe joint is wet.",
  categoryId: "1",
  requestType: "AI_ESTIMATION",
  images: ["/uploads/1712-sink.jpg"],
};

const documentExamples = {
  categoryId: "1",
  nationalId: "29805150101234",
  criminalRecordFile: "/uploads/1712345678-criminal-record.pdf",
  profileImage: "/uploads/1712345678-photo.jpg",
};

/**
 * The one request body in this document that is written out rather than
 * generated, because neither half of it can come from `fromZod`:
 *
 *   - the three file fields are not in `signUpBody` at all. Multer takes them
 *     off the request before the schema ever sees it, so zod knows nothing
 *     about them - but a form with no file inputs is not worth documenting.
 *   - `signUpBody` is a discriminated union, which generates as `anyOf`.
 *     Swagger renders that as a set of tabs, and a multipart form split across
 *     tabs cannot be filled in at all.
 *
 * So: keep this in step with `signUpBody` in users.schema.ts and
 * `withDocuments` in users.me.routes.ts. The rules it describes are enforced
 * there, not here.
 */
const signUpFormFields: Record<string, JsonSchema> = {
  fullName: {
    type: "string",
    minLength: 2,
    maxLength: 100,
    example: profileExamples.fullName,
  },
  city: {
    type: "string",
    minLength: 1,
    maxLength: 100,
    example: profileExamples.city,
  },
  address: { type: "string", minLength: 1, example: profileExamples.address },
  latitude: {
    type: "number",
    minimum: -90,
    maximum: 90,
    example: profileExamples.latitude,
  },
  longitude: {
    type: "number",
    minimum: -180,
    maximum: 180,
    example: profileExamples.longitude,
  },
  role: {
    type: "string",
    enum: [UserRole.CUSTOMER, UserRole.TECHNICIAN],
    description:
      "Which branch to take. `ADMIN` is not accepted - this acts on the caller's own account.",
    example: UserRole.TECHNICIAN,
  },
  categoryId: {
    type: "string",
    pattern: "^\\d+$",
    description:
      "**Technicians only, and required for them** - the speciality picked from `GET /api/v1/public/categories`. Sending it as a customer is a `400`.",
    example: documentExamples.categoryId,
  },
  nationalId: {
    type: "string",
    pattern: "^\\d{14}$",
    minLength: 14,
    maxLength: 14,
    description:
      "**Technicians only, and required for them.** The 14 digits off the card as text, not a photo of it. The birth date (digits 1-7) and the governorate (digits 8-9) have to be real ones; sending it as a file is a `400`.",
    example: documentExamples.nationalId,
  },
  criminalRecordFile: {
    type: "string",
    format: "binary",
    description:
      "Technicians only, optional. The file itself: JPEG, PNG or PDF, at most 5 MB.",
  },
  profileImage: {
    type: "string",
    format: "binary",
    description:
      "Technicians only, optional - the photo the app displays. Same limits as `criminalRecordFile`.",
  },
};

/** Task 5, same story: `updateVerificationBody` is still empty. */
const plannedVerificationBody: JsonSchema = object({
  verificationStatus: {
    type: "string",
    description:
      "`PENDING` is not a decision an admin can submit, so it is not accepted here.",
    enum: [VerificationStatus.VERIFIED, VerificationStatus.REJECTED],
  },
});

export const openApiDocument = {
  openapi: "3.1.0",

  info: {
    title: "HomeService API",
    version,
    license: { name: "ISC", identifier: "ISC" },
    description: [
      "Phone-and-OTP login, onboarding for customers and technicians, and the back-office behind them.",
      "",
      "### Routes are grouped by audience",
      "",
      "| Prefix | Who it is for | Guard |",
      "| --- | --- | --- |",
      "| `/api/v1/public` | anyone | none |",
      "| `/api/v1/me` | the caller, any role | `requireAuth` |",
      '| `/api/v1/customer` | customers | `requireAuth` + `requireRole("CUSTOMER")` |',
      '| `/api/v1/technician` | technicians | `requireAuth` + `requireRole("TECHNICIAN")` |',
      '| `/api/v1/admin` | back-office | `requireAuth` + `requireRole("ADMIN")` |',
      "",
      "The guards are applied once per group in `src/api/index.ts`, and no route, service, schema or mapper checks permissions itself.",
      "",
      "### Getting a token",
      "",
      "1. `POST /api/v1/public/auth/request-otp` with your phone. There is no SMS provider yet, so the code comes back as `devOtpCode` and is printed by `npm run dev`.",
      "2. `POST /api/v1/public/auth/verify-otp` with the code → `data.tokens.accessToken`.",
      "3. Press **Authorize** above, paste the access token, and every call on this page carries it.",
      "",
      "Seeded accounts: `+201000000001` admin · `+201000000002` customer · `+201000000003` technician.",
      "",
      "### Every response has the same shape",
      "",
      "```jsonc",
      '{ "data": { … } }                        // one object',
      '{ "data": [ … ], "meta": { … } }         // a list, with pagination',
      '{ "error": { "code": …, "message": … } } // any failure',
      "```",
      "",
      "🔨 marks an endpoint that is scaffolded but not implemented yet - it answers `501` today.",
      "",
      "### Live updates (Socket.IO)",
      "",
      "A technician's feed fills up while they are looking at it, and a customer watches fees arrive without pulling to refresh. That runs over a socket on **this same host and port** - there is no second URL and no second port to open.",
      "",
      "```js",
      'const socket = io("https://this-host", { auth: { token: accessToken } });',
      "```",
      "",
      "The token is the same `accessToken` as above, and it goes in `auth`, never in a query string. The handshake runs the same three checks `requireAuth` does - signature, the user row, blocked/suspended - so a token that opens a socket is exactly a token that opens an endpoint.",
      "",
      "**Every rejection is the single string `unauthorized`**, whether the token was missing, malformed, expired, the wrong kind, or the account was deleted or blocked. Your reaction is the same in all of those cases: refresh, then reconnect. Anything more specific would only help someone probing.",
      "",
      "| Event | To | Payload |",
      "| --- | --- | --- |",
      "| `job:new` | technician | one card of `GET /api/v1/technician/jobs` |",
      "| `job:closed` | technician | `{ requestId, reason }` - `TAKEN` / `CANCELLED` / `FULL` |",
      "| `job:selected` | technician | `{ requestId, offerId }` |",
      "| `offer:new` | customer | `{ requestId, offer }` - one card of `GET /api/v1/customer/requests/{id}/offers` |",
      "| `request:updated` | customer | `{ requestId, status }` |",
      "",
      "The payload shapes are under **Schemas** at the bottom of this page (`JobClosedEvent` and friends). Two things about them are worth stating plainly: ids are **strings**, exactly as they are in every HTTP response here; and the card payloads come out of the very same mapper as the REST endpoint next to them, so one screen renders a list item and an event with one code path.",
      "",
      "**The socket never receives anything.** There is no message you can send it - every write stays an HTTP call, where the guards, the validation and the rollback already live. It is a delivery channel, not a second API.",
      "",
      "Three things it does not promise:",
      "",
      "- **Delivery.** An event emitted while the phone is in a tunnel is gone. Fetch over REST on open and on reconnect, and never assume the server knows you received something.",
      "- **A long life.** The connection is closed once the access token that opened it would have expired, because a socket is only authenticated once. Reconnect with a fresh token on `connect_error`; this is normal, not a fault.",
      "- **Push.** A closed app has no socket.",
    ].join("\n"),
  },

  // Relative, so "Try it out" hits whichever host is serving this page.
  servers: [{ url: "/", description: "This server" }],

  tags: [
    { name: "Health", description: "Liveness checks, outside the API prefix." },
    { name: "Auth", description: "Phone + OTP login. Open to anyone." },
    { name: "Public", description: "Open endpoints used during onboarding." },
    {
      name: "Me",
      description: "The caller's own account, whatever their role.",
    },
    { name: "Customer", description: "Customer-facing endpoints." },
    { name: "Technician", description: "Technician-facing endpoints." },
    { name: "Admin · Users", description: "Back-office user management." },
    {
      name: "Admin · Categories",
      description: "Back-office category management.",
    },
    {
      name: "Admin · Technicians",
      description: "The approval queue for technician documents.",
    },
    {
      name: "Admin · Realtime",
      description:
        "Poking the socket channel by hand. See **Live updates** above for the channel itself.",
    },
  ],

  paths: {
    // -----------------------------------------------------------------------
    // Health - deliberately outside /api/v1 so monitoring can reach it without
    // a version or a token.
    // -----------------------------------------------------------------------
    "/health": {
      get: {
        tags: ["Health"],
        operationId: "health",
        summary: "Is the process alive?",
        security: openToAnyone,
        responses: {
          200: jsonResponse(
            "The server is up.",
            object({
              status: { type: "string", example: "ok" },
              uptime: {
                type: "number",
                description: "Seconds since the process started.",
                example: 133.7,
              },
            }),
          ),
        },
      },
    },

    "/health/db": {
      get: {
        tags: ["Health"],
        operationId: "healthDatabase",
        summary: "Can the server reach Postgres?",
        description: "Runs `SELECT 1`. A failure surfaces as a `500`.",
        security: openToAnyone,
        responses: {
          200: jsonResponse(
            "The database answered.",
            object({
              status: { type: "string", example: "ok" },
              database: { type: "string", example: "reachable" },
            }),
          ),
        },
      },
    },

    // -----------------------------------------------------------------------
    // /api/v1/public/auth - how a user gets in, so it cannot require being in.
    // -----------------------------------------------------------------------
    "/api/v1/public/auth/request-otp": {
      post: {
        tags: ["Auth"],
        operationId: "requestOtp",
        summary: "Step 1 - text me a code",
        description: [
          "Sign-up and sign-in are the same call: we do not say whether the phone is registered.",
          "",
          "The code is valid 5 minutes and single use, there is a 60 second gap between resends, and 5 wrong guesses lock the phone for 15 minutes.",
        ].join("\n"),
        security: openToAnyone,
        requestBody: jsonBody(
          withExamples(fromZod(requestOtpBody), { phone: phoneExample }),
        ),
        responses: {
          200: jsonResponse(
            "A code was sent.",
            dataOf(
              object(
                {
                  expiresAt: {
                    type: "string",
                    format: "date-time",
                    description: "When the code stops working.",
                  },
                  devOtpCode: {
                    type: "string",
                    description:
                      "The code itself, so the team can test without an SMS provider - paste it into `otpCode` on verify-otp. Never present in production.",
                    example: "042931",
                  },
                },
                ["expiresAt"],
              ),
            ),
          ),
          400: responseRef("ValidationError"),
          429: responseRef("TooManyRequests"),
        },
      },
    },

    "/api/v1/public/auth/verify-otp": {
      post: {
        tags: ["Auth"],
        operationId: "verifyOtp",
        summary: "Step 2 - here is the code, give me my tokens",
        description: [
          "A phone that has never been seen gets a user row here, holding nothing but the phone number - that is the account the onboarding screens then fill in.",
          "",
          "`isNewUser` tells the app whether to start onboarding; `accountState` tells it exactly which screen, including for a returning technician who is still waiting for approval.",
          "",
          "**`otpCode` must be the code from *your* step 1 - the example value below is a placeholder and always answers `Wrong code`.** Two more ways to get that same answer: sending a different `phone` than the one you asked with, or reusing an older code (only the newest code for a phone is checked, so asking twice retires the first one).",
        ].join("\n"),
        security: openToAnyone,
        requestBody: jsonBody(
          withDescriptions(
            withExamples(fromZod(verifyOtpBody), {
              phone: phoneExample,
              otpCode: "000000",
            }),
            {
              phone: "The same number you sent to /request-otp.",
              otpCode:
                "PLACEHOLDER - replace it with the `devOtpCode` from your own /request-otp response (also printed in the `npm run dev` terminal). Valid for 5 minutes, single use.",
            },
          ),
        ),
        responses: {
          200: jsonResponse(
            "Signed in.",
            accountStateEnvelope({
              isNewUser: {
                type: "boolean",
                description: "True when this call created the account.",
              },
              tokens: schemaRef("Tokens"),
            }),
          ),
          400: responseRef("ValidationError"),
          403: responseRef("Forbidden"),
          429: responseRef("TooManyRequests"),
        },
      },
    },

    "/api/v1/public/auth/refresh": {
      post: {
        tags: ["Auth"],
        operationId: "refreshSession",
        summary: "Trade a refresh token for a fresh pair",
        description: [
          "Public because an expired access token is exactly the situation this exists for - demanding a valid one would be a deadlock. The refresh token in the body is the credential, and it is checked just as strictly.",
          "",
          "`accountState` comes back too: an admin may have approved the technician since the app last looked.",
        ].join("\n"),
        security: openToAnyone,
        requestBody: jsonBody(fromZod(refreshBody)),
        responses: {
          200: jsonResponse(
            "A new pair of tokens.",
            accountStateEnvelope({ tokens: schemaRef("Tokens") }),
          ),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
        },
      },
    },

    // -----------------------------------------------------------------------
    // The rest of /api/v1/public
    // -----------------------------------------------------------------------
    "/api/v1/public/categories": {
      get: {
        tags: ["Public"],
        operationId: "listCategories",
        summary: "🔨 List the service categories",
        description: [
          "The list customers and technicians pick from during onboarding. Open, because it is needed before anyone has an account. Not paginated - there are only a handful.",
          "",
          scaffolded(1),
        ].join("\n\n"),
        security: openToAnyone,
        responses: {
          200: jsonResponse(
            "Every category, ordered by name.",
            dataOf({ type: "array", items: schemaRef("Category") }),
          ),
          501: responseRef("NotImplemented"),
        },
      },
    },

    "/api/v1/public/uploads": {
      post: {
        tags: ["Public"],
        operationId: "uploadFile",
        summary: "🔨 Upload a file",
        description: [
          "Where the technician's criminal record and photo go first: this returns a URL, and that URL is what `POST /api/v1/technician/profile` accepts - never the file itself. The national id is not uploaded at all; it is sent as 14 digits of text.",
          "",
          "Planned limits: `image/jpeg`, `image/png` or `application/pdf`, at most 5 MB. The server renames every file, so the name the client sends is ignored.",
          "",
          scaffolded(4),
        ].join("\n\n"),
        security: openToAnyone,
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: object({
                file: { type: "string", format: "binary" },
              }),
            },
          },
        },
        responses: {
          201: jsonResponse(
            "Stored.",
            dataOf(
              object({
                url: {
                  type: "string",
                  example: "/uploads/1712345678-criminal-record.pdf",
                },
              }),
            ),
          ),
          400: responseRef("ValidationError"),
          501: responseRef("NotImplemented"),
        },
      },
    },

    // -----------------------------------------------------------------------
    // /api/v1/me - the caller's own account. No `:id` anywhere in this group:
    // the id comes from the token.
    // -----------------------------------------------------------------------
    "/api/v1/me": {
      get: {
        tags: ["Me"],
        operationId: "getMe",
        summary: "Who am I, and which screen comes next?",
        description:
          "The same answer login gives, for an app that already has a token and is starting up again - it saves a trip through the SMS flow just to learn that a technician was approved.",
        responses: {
          200: jsonResponse(
            "The caller's account.",
            accountStateEnvelope({
              technicianProfile: {
                description: "Null for customers and admins.",
                oneOf: [schemaRef("TechnicianProfile"), { type: "null" }],
              },
            }),
          ),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
        },
      },
    },

    "/api/v1/me/role": {
      patch: {
        tags: ["Me"],
        operationId: "selectRole",
        summary: 'The "customer or technician?" screen',
        description: [
          "The answer decides which screen comes next:",
          "",
          "- `CUSTOMER` → `COMPLETE_PROFILE`, the profile page",
          "- `TECHNICIAN` → `SUBMIT_DOCUMENTS`, the documents form instead",
          "",
          "`ADMIN` is not accepted: this acts on the caller's own account, so allowing it would let anyone promote themselves. Answering again after onboarding has finished is a `409`.",
          "",
          "Step one of the step-by-step flow. An app that collects the role, the profile and the documents on one form can skip it and call `POST /api/v1/me/signup` instead.",
        ].join("\n"),
        requestBody: jsonBody(
          withExamples(fromZod(selectRoleBody), { role: "TECHNICIAN" }),
        ),
        responses: {
          200: jsonResponse("Role stored.", accountStateEnvelope()),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          404: responseRef("NotFound"),
          409: responseRef("Conflict"),
        },
      },
    },

    "/api/v1/me/signup": {
      post: {
        tags: ["Me"],
        operationId: "signUp",
        summary: "Finish my account in one call",
        description: [
          "Onboarding as a single `multipart/form-data` request: the profile, the customer-or-technician answer, and - for a technician - the documents as **actual file uploads**. For the app that asks for all of it on one form.",
          "",
          "It replaces this sequence, which still works:",
          "",
          "```",
          "PATCH /me/role  →  POST /customer/profile",
          "PATCH /me/role  →  POST /technician/profile   (+ one upload call per file)",
          "```",
          "",
          "Both paths reach the same rows through the same service, so an account that started step by step can finish here.",
          "",
          "### What comes back",
          "",
          "- `CUSTOMER` → the account is `ACTIVE`, `accountState` is `READY`, `technicianProfile` is null",
          "- `TECHNICIAN` → the `TechnicianProfile` is created `PENDING`, the user stays `PENDING`, and `accountState` is `WAITING_FOR_APPROVAL` until an admin verifies them",
          "",
          "### Notes",
          "",
          "- It is on `/me` rather than `/customer` or `/technician` because those groups are behind `requireRole`, and the role is what this call *sets*.",
          "- A customer sends no files, so plain `application/json` works for them too.",
          "- Uploads are JPEG, PNG or PDF, at most 5 MB each. The server renames every file; the name the client sends is ignored.",
          "- There is no `userId` field - the account is the one the access token belongs to.",
          "- Calling it once onboarding has finished is a `409`, the same as the endpoints it replaces.",
        ].join("\n"),
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: object(signUpFormFields, [
                "fullName",
                "city",
                "address",
                "latitude",
                "longitude",
                "role",
              ]),
              encoding: {
                criminalRecordFile: {
                  contentType: "image/jpeg, image/png, application/pdf",
                },
                profileImage: { contentType: "image/jpeg, image/png" },
              },
            },
          },
        },
        responses: {
          201: jsonResponse(
            "Account complete. A technician is now waiting for approval; a customer can use the app.",
            accountStateEnvelope({
              technicianProfile: {
                description: "Null when the caller signed up as a customer.",
                oneOf: [schemaRef("TechnicianProfile"), { type: "null" }],
              },
            }),
          ),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          404: responseRef("NotFound"),
          409: responseRef("Conflict"),
        },
      },
    },

    // -----------------------------------------------------------------------
    // /api/v1/customer
    // -----------------------------------------------------------------------
    "/api/v1/customer/profile": {
      post: {
        tags: ["Customer"],
        operationId: "completeCustomerProfile",
        summary: "Complete my customer profile",
        description: [
          "The twin of `POST /api/v1/technician/profile`. It does not create a user - that row exists from the moment the OTP was verified - it fills in the blanks and activates the account, which is what turns `accountState` into `READY`.",
          "",
          "There is no `userId` field: the profile belongs to the caller, taken from the token.",
          "",
          "Calling it again once onboarding has finished is a `409`: the account is no longer `PENDING`.",
          "",
          "Reached after `PATCH /api/v1/me/role`. `POST /api/v1/me/signup` does both in one call.",
        ].join("\n\n"),
        requestBody: jsonBody(
          withExamples(fromZod(createCustomerProfileBody), profileExamples),
        ),
        responses: {
          201: jsonResponse("Profile completed.", accountStateEnvelope()),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          404: responseRef("NotFound"),
          409: responseRef("Conflict"),
        },
      },
    },

    // -----------------------------------------------------------------------
    // /api/v1/customer/points - task 6, the wallet
    // -----------------------------------------------------------------------
    "/api/v1/customer/points": {
      get: {
        tags: ["Customer"],
        operationId: "getPointsBalance",
        summary: "My points balance",
        description: [
          "The number on the profile screen. `GET /api/v1/me` already carries the same figure as `user.pointsBalance`, so reach for this one on a wallet screen that shows nothing else.",
          "",
          "No `meta` here - a balance is not a list.",
        ].join("\n"),
        responses: {
          200: jsonResponse(
            "The current balance.",
            dataOf(
              object({ pointsBalance: { type: "integer", example: 250 } }),
            ),
          ),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          404: responseRef("NotFound"),
        },
      },
    },

    "/api/v1/customer/points/transactions": {
      get: {
        tags: ["Customer"],
        operationId: "listPointsTransactions",
        summary: "My points history",
        description: [
          'Where the points went, newest first. Filter with `type=SPEND` to answer "what did I spend them on".',
          "",
          "`amount` is signed, so a spend arrives as a negative number and `balanceAfter` is the balance once it had been applied.",
        ].join("\n"),
        parameters: [
          ...queryParams(listPointsQuery, {
            page: "1-based page number.",
            limit: "Rows per page, at most 100.",
            type: "Show only one kind of ledger row.",
          }),
        ],
        responses: {
          200: jsonResponse(
            "One page of ledger rows.",
            listOf(schemaRef("PointsTransaction")),
          ),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
        },
      },
    },

    // -----------------------------------------------------------------------
    // /api/v1/customer/requests - task 7, the problem and the past orders
    //
    // The other four routes in this group (AI estimation, publish, offers,
    // accept) belong to tasks 8, 10 and 11 and still answer 501, so they are
    // not described here yet.
    // -----------------------------------------------------------------------
    "/api/v1/customer/requests": {
      post: {
        tags: ["Customer"],
        operationId: "createServiceRequest",
        summary: "Describe my problem",
        description: [
          'What both buttons on the description screen post - "describe it with an AI" and "order a consultation". Only `requestType` differs.',
          "",
          "**This creates a draft.** It comes back as `PENDING`, which means nothing has reached a technician: publishing is a separate call (task 10). A draft is also hidden from the past-orders list below unless you ask for `?status=PENDING` by name.",
          "",
          "At least one image is required for both types. The AI has nothing to look at without one, and a technician pricing a visit blind will either overcharge or refuse. Upload them first with `POST /api/v1/public/uploads` and send the urls back here.",
          "",
          "The address fields are optional and default to the profile - send them only when the job is somewhere else. Whatever is used is **copied onto the request**, so moving house later does not rewrite where an old job happened. An account with no address on its profile and none in the body is a `400`.",
          "",
          "A `categoryId` that does not exist is a `409`.",
        ].join("\n"),
        requestBody: jsonBody(
          withExamples(
            fromZod(createServiceRequestBody),
            serviceRequestExamples,
          ),
        ),
        responses: {
          201: jsonResponse(
            'The draft, with `status: "PENDING"`.',
            dataOf(schemaRef("ServiceRequest")),
          ),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          404: responseRef("NotFound"),
          409: responseRef("Conflict"),
        },
      },

      get: {
        tags: ["Customer"],
        operationId: "listMyServiceRequests",
        summary: "My past orders",
        description: [
          "Everything this customer has ordered, newest first.",
          "",
          "**Drafts are left out unless you ask for them by name.** With no `status` the filter is *everything except* `PENDING`: a customer who opened the AI screen and backed out left a row behind, and it is not an order they placed. `?status=PENDING` returns exactly those, so nothing is unreachable.",
          "",
          "The rows are the smaller `ServiceRequestListItem` shape - open one with `GET /api/v1/customer/requests/{id}` for the photos, the description and the estimate.",
        ].join("\n"),
        parameters: [
          ...queryParams(listMyRequestsQuery, {
            page: "1-based page number.",
            limit: "Rows per page, at most 100.",
            status:
              "Show only one status. This is also the only way to see `PENDING` drafts.",
          }),
        ],
        responses: {
          200: jsonResponse(
            "One page of past orders.",
            listOf(schemaRef("ServiceRequestListItem")),
          ),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
        },
      },
    },

    "/api/v1/customer/requests/{id}": {
      get: {
        tags: ["Customer"],
        operationId: "getMyServiceRequest",
        summary: "One of my orders",
        description: [
          "The detail screen: the photos, the description, the AI estimate if there is one, how many technicians have answered, and - once one is chosen - who they are and how to call them.",
          "",
          "**Somebody else's request is a `404`, not a `403`.** A 403 would confirm to a stranger that the id exists.",
        ].join("\n"),
        parameters: [idPathParam("The request id.")],
        responses: {
          200: jsonResponse(
            "The request.",
            dataOf(schemaRef("ServiceRequest")),
          ),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          404: responseRef("NotFound"),
        },
      },
    },

    "/api/v1/customer/requests/{id}/cancel": {
      post: {
        tags: ["Customer"],
        operationId: "cancelServiceRequest",
        summary: "Cancel one of my orders",
        description: [
          "The Cancel button. Allowed while nobody has started work - `PENDING`, `WAITING_FOR_TECHNICIAN` and `TECHNICIAN_SELECTED`. Anything from `ON_THE_WAY` onwards means a technician is already moving, and `COMPLETED` / `CANCELLED` are done: all of those are a `409`.",
          "",
          "Every offer still open on the request is closed with it, so the job drops out of the technicians' feeds too.",
          "",
          "No body.",
        ].join("\n"),
        parameters: [idPathParam("The request id.")],
        responses: {
          200: jsonResponse("Cancelled.", dataOf(schemaRef("ServiceRequest"))),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          404: responseRef("NotFound"),
          409: responseRef("Conflict"),
        },
      },
    },

    // -----------------------------------------------------------------------
    // /api/v1/technician
    // -----------------------------------------------------------------------
    "/api/v1/technician/profile": {
      post: {
        tags: ["Technician"],
        operationId: "createTechnicianProfile",
        summary: "Submit my details and documents",
        description: [
          "A technician never sees the customer profile page, so this one call carries their personal details *and* their national ID / criminal record, and creates the TechnicianProfile row.",
          "",
          "Upload the files first with `POST /api/v1/public/uploads` and send the URLs it returns. The account then sits in `WAITING_FOR_APPROVAL` until an admin verifies it - the user's status stays `PENDING` on purpose.",
          "",
          "`POST /api/v1/me/signup` is the one-call alternative, and the only one that works today: it takes the files themselves as multipart, so it does not need the upload endpoint above, which is still scaffolded.",
        ].join("\n"),
        requestBody: jsonBody(
          withExamples(fromZod(createTechnicianProfileBody), {
            ...profileExamples,
            ...documentExamples,
          }),
        ),
        responses: {
          201: jsonResponse(
            "Documents submitted, now waiting for an admin.",
            accountStateEnvelope({
              technicianProfile: schemaRef("TechnicianProfile"),
            }),
          ),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          404: responseRef("NotFound"),
          409: responseRef("Conflict"),
        },
      },
    },

    // -----------------------------------------------------------------------
    // /api/v1/customer/requests/{id}/ai-estimation
    // -----------------------------------------------------------------------
    "/api/v1/customer/requests/{id}/ai-estimation": {
      post: {
        tags: ["Customer"],
        operationId: "estimateServiceRequest",
        summary: "Describe it with an AI",
        description: [
          "Spends `AI_ESTIMATION_POINTS_COST` points (50 by default) to have the model read the title and description and answer with a severity and a price range for this category.",
          "",
          "Only works on an `AI_ESTIMATION` draft still `PENDING`, otherwise `409`. Not enough points is `402`.",
          "",
          "**Calling it again on the same request returns the same estimate and charges nothing** (`pointsCharged: 0`) - a client that retried a timed-out call must not pay twice. The response shape is identical either way, so the app draws the same screen.",
          "",
          "The AI itself can be down or unreachable - that is `503`, and nothing is charged when it happens.",
        ].join("\n"),
        parameters: [idPathParam("The request id.")],
        responses: {
          201: jsonResponse(
            "The estimate, what it cost, and the new balance - together, so the screen needs one call.",
            dataOf(
              object({
                estimation: {
                  type: "object",
                  properties: {
                    severity: {
                      type: "string",
                      enum: Object.values(Severity),
                    },
                    minPrice: {
                      type: ["string", "null"],
                      example: "375.00",
                    },
                    maxPrice: {
                      type: ["string", "null"],
                      example: "900.00",
                    },
                    confidence: {
                      type: ["string", "null"],
                      example: "0.82",
                    },
                  },
                  required: ["severity", "minPrice", "maxPrice", "confidence"],
                },
                pointsCharged: {
                  type: "integer",
                  description: "0 on a repeated call.",
                  example: 50,
                },
                pointsBalance: {
                  type: "integer",
                  example: 50,
                },
              }),
            ),
          ),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          402: responseRef("InsufficientPoints"),
          403: responseRef("Forbidden"),
          404: responseRef("NotFound"),
          409: responseRef("Conflict"),
          503: responseRef("ServiceUnavailable"),
        },
      },
    },

    // -----------------------------------------------------------------------
    // /api/v1/admin/users
    // -----------------------------------------------------------------------
    "/api/v1/admin/users": {
      get: {
        tags: ["Admin · Users"],
        operationId: "listUsers",
        summary: "List users",
        description: "Newest first. Soft-deleted users are never returned.",
        parameters: queryParams(listUsersQuery, {
          page: "1-based page number.",
          limit: "Rows per page, at most 100.",
          role: "Only this role.",
          status: "Only this status.",
          city: "Exact city, case-insensitive.",
          search: "Matches the full name or the phone.",
        }),
        responses: {
          200: jsonResponse("One page of users.", listOf(schemaRef("User"))),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
        },
      },

      post: {
        tags: ["Admin · Users"],
        operationId: "createUser",
        summary: "Create a user",
        description:
          "The back-office way in. Normal users are created by verifying an OTP, not here. A phone that already exists is a `409`.",
        requestBody: jsonBody(
          withExamples(fromZod(createUserBody), {
            ...profileExamples,
            phone: "+201112223334",
          }),
        ),
        responses: {
          201: jsonResponse("Created.", dataOf(schemaRef("User"))),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          409: responseRef("Conflict"),
        },
      },
    },

    "/api/v1/admin/users/{id}": {
      parameters: [idPathParam("User id.")],

      get: {
        tags: ["Admin · Users"],
        operationId: "getUser",
        summary: "One user",
        responses: {
          200: jsonResponse("The user.", dataOf(schemaRef("User"))),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          404: responseRef("NotFound"),
        },
      },

      patch: {
        tags: ["Admin · Users"],
        operationId: "updateUser",
        summary: "Update a user's details",
        description:
          "Profile fields only - role and status have their own endpoints. Send at least one field; an empty body is a `400`.",
        requestBody: jsonBody(
          withExamples(fromZod(updateUserBody), profileExamples),
        ),
        responses: {
          200: jsonResponse("Updated.", dataOf(schemaRef("User"))),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          404: responseRef("NotFound"),
          409: responseRef("Conflict"),
        },
      },

      delete: {
        tags: ["Admin · Users"],
        operationId: "deleteUser",
        summary: "Soft delete a user",
        description:
          "Sets `deleted_at`; the row stays for history. Every later query filters it out, so the user disappears from the API.",
        responses: {
          204: { description: "Deleted. No body." },
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          404: responseRef("NotFound"),
        },
      },
    },

    "/api/v1/admin/users/{id}/status": {
      parameters: [idPathParam("User id.")],

      patch: {
        tags: ["Admin · Users"],
        operationId: "setUserStatus",
        summary: "Activate, block or suspend",
        description:
          "`BLOCKED` and `SUSPENDED` take effect within one access-token lifetime: the guard re-reads the user row on every request, and refreshing re-checks it too, so the session cannot be renewed.",
        requestBody: jsonBody(
          withExamples(fromZod(updateUserStatusBody), { status: "ACTIVE" }),
        ),
        responses: {
          200: jsonResponse("Updated.", dataOf(schemaRef("User"))),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          404: responseRef("NotFound"),
        },
      },
    },

    // -----------------------------------------------------------------------
    // /api/v1/admin/categories - task 1
    // -----------------------------------------------------------------------
    // -----------------------------------------------------------------------
    // /api/v1/admin/users/{id}/points - task 6, granting points
    // -----------------------------------------------------------------------
    "/api/v1/admin/users/{id}/points": {
      parameters: [idPathParam("The user whose wallet is credited.")],

      post: {
        tags: ["Admin \u00b7 Users"],
        operationId: "grantPoints",
        summary: "Grant points to a user",
        description: [
          "Support, and how you give an account points to test with before card top-ups exist. Writes an `ADMIN_GRANT` row to the ledger next to the new balance.",
          "",
          "There is no `userId` in the body: it is the `:id` in the path, and an endpoint that took both would let the two disagree.",
        ].join("\n"),
        requestBody: jsonBody(fromZod(grantPointsBody)),
        responses: {
          201: jsonResponse(
            "Points granted.",
            dataOf(
              object({ pointsBalance: { type: "integer", example: 350 } }),
            ),
          ),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          404: responseRef("NotFound"),
        },
      },
    },

    "/api/v1/admin/categories": {
      post: {
        tags: ["Admin · Categories"],
        operationId: "createCategory",
        summary: "🔨 Create a category",
        description: [
          "`name` is unique, so a duplicate is a `409` on its own - no need to look first.",
          "",
          scaffolded(1),
        ].join("\n\n"),
        requestBody: jsonBody(
          withExamples(fromZod(createCategoryBody), {
            name: "سباكة",
            homeVisitBasePrice: "150.00",
          }),
        ),
        responses: {
          201: jsonResponse("Created.", dataOf(schemaRef("Category"))),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          409: responseRef("Conflict"),
          501: responseRef("NotImplemented"),
        },
      },
    },

    "/api/v1/admin/categories/{id}": {
      parameters: [idPathParam("Category id.")],

      get: {
        tags: ["Admin · Categories"],
        operationId: "getCategory",
        summary: "🔨 One category",
        description: scaffolded(1),
        responses: {
          200: jsonResponse("The category.", dataOf(schemaRef("Category"))),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          404: responseRef("NotFound"),
          501: responseRef("NotImplemented"),
        },
      },

      patch: {
        tags: ["Admin · Categories"],
        operationId: "updateCategory",
        summary: "🔨 Update a category",
        description: [
          "The same fields as create, all optional, but an empty body is a `400`.",
          "",
          scaffolded(1),
        ].join("\n\n"),
        requestBody: jsonBody(fromZod(updateCategoryBody)),
        responses: {
          200: jsonResponse("Updated.", dataOf(schemaRef("Category"))),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          404: responseRef("NotFound"),
          409: responseRef("Conflict"),
          501: responseRef("NotImplemented"),
        },
      },

      delete: {
        tags: ["Admin · Categories"],
        operationId: "deleteCategory",
        summary: "🔨 Delete a category",
        description: [
          "A real delete - `Category` has no `deleted_at`. Deleting one that technicians or service requests still point at is a `409`, and that is the correct answer.",
          "",
          scaffolded(1),
        ].join("\n\n"),
        responses: {
          204: { description: "Deleted. No body." },
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          404: responseRef("NotFound"),
          409: responseRef("Conflict"),
          501: responseRef("NotImplemented"),
        },
      },
    },

    // -----------------------------------------------------------------------
    // /api/v1/admin/technicians - task 5, the approval queue
    // -----------------------------------------------------------------------
    "/api/v1/admin/technicians": {
      get: {
        tags: ["Admin · Technicians"],
        operationId: "listTechnicians",
        summary: "🔨 The approval queue",
        description: [
          "Technician profiles, newest first, with their user and category included. Filter by `verificationStatus=PENDING` to see only the ones waiting.",
          "",
          "This is the admin shape, so it carries the identity documents.",
          "",
          scaffolded(5),
        ].join("\n\n"),
        parameters: [
          ...queryParams(paginationQuery, {
            page: "1-based page number.",
            limit: "Rows per page, at most 100.",
          }),
          {
            name: "verificationStatus",
            in: "query",
            required: false,
            description: "Planned filter (task 5).",
            schema: {
              type: "string",
              enum: Object.values(VerificationStatus),
            },
          },
        ],
        responses: {
          200: jsonResponse(
            "One page of technician profiles.",
            listOf(schemaRef("TechnicianProfileAdmin")),
          ),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          501: responseRef("NotImplemented"),
        },
      },
    },

    "/api/v1/admin/technicians/{id}/verification": {
      parameters: [idPathParam("Technician **profile** id, not the user id.")],

      patch: {
        tags: ["Admin · Technicians"],
        operationId: "setTechnicianVerification",
        summary: "🔨 Approve or reject a technician",
        description: [
          'The other half of "waiting for approval". Two rows change together:',
          "",
          "- `VERIFIED` → the profile is verified **and** the user becomes `ACTIVE`, which is what turns `accountState` into `READY` and lets them work.",
          "- `REJECTED` → the profile is rejected and the user stays `PENDING`, so they can submit again.",
          "",
          scaffolded(5),
        ].join("\n"),
        requestBody: jsonBody(plannedVerificationBody),
        responses: {
          200: jsonResponse(
            "Decision recorded.",
            dataOf(schemaRef("TechnicianProfileAdmin")),
          ),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          404: responseRef("NotFound"),
          501: responseRef("NotImplemented"),
        },
      },
    },

    // -----------------------------------------------------------------------
    // /api/v1/admin/realtime - task 9, seeing the socket work
    // -----------------------------------------------------------------------
    "/api/v1/admin/realtime/ping": {
      post: {
        tags: ["Admin · Realtime"],
        operationId: "realtimePing",
        summary: "Send a debug event to a user's socket",
        description: [
          "Emits `debug:ping` to one user's room, so the channel can be watched before tasks 10 and 11 emit anything real. A channel you cannot see is a channel you cannot debug.",
          "",
          "Connect as that user and leave it printing:",
          "",
          "```bash",
          'node scripts/socket-test.mjs "$TOKEN"',
          "```",
          "",
          "`debug:ping` is deliberately **not** part of the app's contract - it is not in the event table above, and nothing but this endpoint and that script should know the name.",
          "",
          "`delivered` says a socket server existed to emit through, not that anybody was listening. Socket.IO cannot tell us the latter and neither can we: pinging a user with no open socket is a `200` with `delivered: true`.",
        ].join("\n"),
        requestBody: jsonBody(
          withExamples(fromZod(pingBody), {
            userId: "2",
            message: "hello",
          }),
        ),
        responses: {
          200: jsonResponse(
            "Emitted, or dropped if no socket server is running in this process.",
            dataOf(
              object({
                delivered: {
                  type: "boolean",
                  description:
                    "`false` only when this process has no socket server at all.",
                  example: true,
                },
              }),
            ),
          ),
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
        },
      },
    },
  },

  components: { schemas, responses, securitySchemes },

  /**
   * The default for the whole document: a token is required. The handful of
   * endpoints that do not need one say `security: openToAnyone` above, which
   * is the same split api/index.ts makes - `/public` and the health checks have
   * no guard, everything else is behind `requireAuth`.
   */
  security: [{ bearerAuth: [] }],
};
