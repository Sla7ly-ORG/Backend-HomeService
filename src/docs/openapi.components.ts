import { z } from "zod";
import {
  PointsTransactionType,
  UserRole,
  UserStatus,
  VerificationStatus,
} from "../generated/prisma/enums.js";

/**
 * The reusable half of the OpenAPI document - everything that ends up under
 * `components` - plus the small helpers that build the repetitive parts of an
 * operation.
 *
 * Two rules keep this file honest:
 *
 *   1. **Requests are generated, never retyped.** `fromZod` turns the very
 *      schema a route parses into JSON Schema, so the documented body cannot
 *      drift from the validated one. Change users.schema.ts and the docs page
 *      changes with it.
 *   2. **Responses are written by hand, next to the mapper they mirror.** There
 *      is no zod schema for a response - the mappers in each module decide the
 *      shape - so those live below with a pointer to the file they follow. If
 *      you add a field to a mapper, add it here too.
 */

/** A JSON Schema fragment. Loose on purpose: OpenAPI 3.1 *is* JSON Schema. */
export type JsonSchema = Record<string, unknown>;

/**
 * One of the app's real zod schemas, as JSON Schema.
 *
 * `io: "input"` is the important part: several fields are transformed while
 * parsing - `idField` arrives as a string and comes out a BigInt - and the
 * document has to describe what the client *sends*, not what the handler ends
 * up holding. `unrepresentable: "any"` keeps those transforms from throwing.
 */
export function fromZod(schema: z.ZodType): JsonSchema {
  const { $schema, ...jsonSchema } = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
    target: "draft-2020-12",
  }) as JsonSchema & { $schema?: string };

  return jsonSchema;
}

/**
 * Hangs an example on some of a generated schema's fields.
 *
 * Without this Swagger UI invents values from the constraints alone, and
 * `"latitude": -90` is a technically valid but useless thing to press Execute
 * on. Unknown field names are ignored, so a renamed field costs a dull example
 * rather than a wrong one.
 */
export function withExamples(
  schema: JsonSchema,
  examples: Record<string, unknown>,
): JsonSchema {
  return annotate(schema, examples, "example");
}

/**
 * The same, for prose. Worth spending on any field where a plausible-looking
 * example could be mistaken for a working one - the OTP code being the obvious
 * case: it has to be *your* code, and no example can supply that.
 */
export function withDescriptions(
  schema: JsonSchema,
  descriptions: Record<string, string>,
): JsonSchema {
  return annotate(schema, descriptions, "description");
}

/** Merges one keyword into the named properties of a generated schema. */
function annotate(
  schema: JsonSchema,
  values: Record<string, unknown>,
  keyword: "example" | "description",
): JsonSchema {
  const properties = {
    ...(schema.properties as Record<string, JsonSchema> | undefined),
  };

  for (const [name, value] of Object.entries(values)) {
    if (properties[name]) {
      properties[name] = { ...properties[name], [keyword]: value };
    }
  }

  return { ...schema, properties };
}

/**
 * Turns an object schema into a list of query parameters - the shape OpenAPI
 * wants for `?page=&limit=`, from the same schema the route calls `.parse` on.
 *
 * Descriptions are passed in rather than read from the schema: the zod files
 * document themselves in comments, and littering them with `.describe()` calls
 * just to feed this page would be the tail wagging the dog.
 */
export function queryParams(
  schema: z.ZodType,
  descriptions: Record<string, string> = {},
) {
  const { properties = {}, required = [] } = fromZod(schema) as {
    properties?: Record<string, JsonSchema>;
    required?: string[];
  };

  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: "query",
    required: required.includes(name),
    schema: propertySchema,
    ...(descriptions[name] ? { description: descriptions[name] } : {}),
  }));
}

/** The `:id` in a URL. Always a string here - see `idField` in core/fields.ts. */
export function idPathParam(description: string) {
  return {
    name: "id",
    in: "path",
    required: true,
    description,
    schema: { type: "string", pattern: "^\\d+$", example: "1" },
  };
}

/** `#/components/schemas/User` without the typo risk. */
export function schemaRef(name: string): JsonSchema {
  return { $ref: `#/components/schemas/${name}` };
}

/** `#/components/responses/Unauthorized`, ditto. */
export function responseRef(name: string) {
  return { $ref: `#/components/responses/${name}` };
}

/** A JSON request body. Every write endpoint in this API is JSON. */
export function jsonBody(schema: JsonSchema, description?: string) {
  return {
    required: true,
    ...(description ? { description } : {}),
    content: { "application/json": { schema } },
  };
}

/** A 2xx response carrying JSON. */
export function jsonResponse(description: string, schema: JsonSchema) {
  return { description, content: { "application/json": { schema } } };
}

/** `{ "data": … }` - the envelope every successful response uses. */
export function dataOf(schema: JsonSchema): JsonSchema {
  return {
    type: "object",
    properties: { data: schema },
    required: ["data"],
  };
}

/** `{ "data": [ … ], "meta": { … } }` - the same envelope for a list endpoint. */
export function listOf(schema: JsonSchema): JsonSchema {
  return {
    type: "object",
    properties: {
      data: { type: "array", items: schema },
      meta: schemaRef("PaginationMeta"),
    },
    required: ["data", "meta"],
  };
}

/** An inline object schema, for the one-off envelopes login and /me return. */
export function object(
  properties: Record<string, JsonSchema>,
  required = Object.keys(properties),
): JsonSchema {
  return { type: "object", properties, required };
}

const bigIntId = (example: string, description: string): JsonSchema => ({
  type: "string",
  pattern: "^\\d+$",
  description,
  example,
});

const timestamp = (description: string): JsonSchema => ({
  type: "string",
  format: "date-time",
  description,
});

/** OpenAPI 3.1 spells "or null" as a type array, which is plain JSON Schema. */
const nullable = (schema: JsonSchema): JsonSchema => ({
  ...schema,
  type: [schema.type, "null"],
});

/**
 * `components.schemas`.
 *
 * The enums come from generated/prisma/enums.ts rather than being retyped, so
 * a new `UserStatus` shows up on this page as soon as it exists in the schema.
 */
export const schemas: Record<string, JsonSchema> = {
  /**
   * Mirrors `toUserResponse` in modules/users/users.mapper.ts.
   *
   * Everything but the phone is null until onboarding finishes - that is not a
   * mistake, it is a half-filled account the app can still render.
   */
  User: {
    type: "object",
    description: "A user account. Mirrors `toUserResponse` in users.mapper.ts.",
    properties: {
      id: bigIntId("2", "BigInt primary key, sent as a string."),
      fullName: nullable({ type: "string", example: "Mona Ali" }),
      phone: { type: "string", example: "+201000000002" },
      role: { type: "string", enum: Object.values(UserRole) },
      status: { type: "string", enum: Object.values(UserStatus) },
      city: nullable({ type: "string", example: "Giza" }),
      address: nullable({ type: "string", example: "12 Nile St" }),
      latitude: nullable({ type: "number", example: 30.0131 }),
      longitude: nullable({ type: "number", example: 31.2089 }),
      pointsBalance: {
        type: "integer",
        description:
          "Task 6. The wallet balance, so the profile screen does not need a second call. A plain integer - points are counted, not paid.",
        example: 250,
      },
      createdAt: timestamp("When the account was created."),
      updatedAt: timestamp("When the row last changed."),
    },
    required: [
      "id",
      "fullName",
      "phone",
      "role",
      "status",
      "city",
      "address",
      "latitude",
      "longitude",
      "pointsBalance",
      "createdAt",
      "updatedAt",
    ],
  },

  /** Task 6. Mirrors `toPointsTransactionResponse` in points.mapper.ts. */
  PointsTransaction: {
    type: "object",
    description:
      'One row of the points ledger. `amount` and `balanceAfter` are plain integers rather than strings: points are counted, not paid, so the "money is a string" rule the rest of this document follows deliberately does not apply here.',
    properties: {
      id: bigIntId("7", "Ledger row id."),
      userId: bigIntId("2", "The wallet this row belongs to."),
      type: {
        type: "string",
        enum: Object.values(PointsTransactionType),
        description:
          "`TOPUP` bought with money, `SPEND` an AI estimation, `REFUND` we failed, `ADMIN_GRANT` support.",
      },
      amount: {
        type: "integer",
        description: "Signed: `+100` for a grant, `-50` for a spend.",
        example: 100,
      },
      balanceAfter: {
        type: "integer",
        description: "The balance once this row had been applied.",
        example: 100,
      },
      reason: nullable({ type: "string", example: "testing" }),
      serviceRequestId: nullable(
        bigIntId("12", "The request this paid for, when there was one."),
      ),
      createdAt: timestamp("When the row was written."),
    },
    required: [
      "id",
      "userId",
      "type",
      "amount",
      "balanceAfter",
      "reason",
      "serviceRequestId",
      "createdAt",
    ],
  },

  /**
   * Mirrors `toTechnicianProfileResponse` in technicians.mapper.ts - the
   * technician's own view. `nationalId` and `criminalRecordFile` are missing on
   * purpose: they are identity documents, and only the admin shape below
   * carries them.
   */
  TechnicianProfile: {
    type: "object",
    description:
      "A technician's profile as the technician sees it. Identity documents are deliberately absent - see TechnicianProfileAdmin.",
    properties: {
      id: bigIntId("7", "Profile id."),
      userId: bigIntId("3", "The user this profile belongs to."),
      categoryId: bigIntId("1", "The speciality picked during onboarding."),
      verificationStatus: {
        type: "string",
        enum: Object.values(VerificationStatus),
      },
      isAvailable: { type: "boolean" },
      overallRating: {
        type: "string",
        description: "Decimal, sent as a string so it keeps its precision.",
        example: "4.50",
      },
      totalReviews: { type: "integer", example: 12 },
      profileImage: nullable({
        type: "string",
        description: "URL returned by POST /api/v1/public/uploads.",
        example: "/uploads/1712345678-photo.jpg",
      }),
      createdAt: timestamp("When the documents were submitted."),
      updatedAt: timestamp("When the row last changed."),
    },
    required: [
      "id",
      "userId",
      "categoryId",
      "verificationStatus",
      "isAvailable",
      "overallRating",
      "totalReviews",
      "profileImage",
      "createdAt",
      "updatedAt",
    ],
  },

  /** Task 5: the same row plus the documents the admin has to look at. */
  TechnicianProfileAdmin: {
    allOf: [
      schemaRef("TechnicianProfile"),
      object({
        nationalId: {
          type: "string",
          description: "The 14 digits of the technician's national ID.",
          example: "29805150101234",
        },
        criminalRecordFile: nullable({
          type: "string",
          example: "/uploads/1712345678-criminal-record.pdf",
        }),
      }),
    ],
    description:
      "The admin view of a technician profile: everything above plus the identity documents. Mirrors `toTechnicianProfileAdminResponse` (task 5).",
  },

  /** Task 1. Mirrors the `toCategoryResponse` described in categories.mapper.ts. */
  Category: {
    type: "object",
    description: "A service category, e.g. plumbing.",
    properties: {
      id: bigIntId("1", "Category id."),
      name: { type: "string", example: "Plumbing" },
      homeVisitBasePrice: {
        type: "string",
        description:
          "Money is a Decimal in the database and a string in JSON - never a float.",
        example: "150.00",
      },
      createdAt: timestamp("When the category was created."),
      updatedAt: timestamp("When the row last changed."),
    },
    required: ["id", "name", "homeVisitBasePrice", "createdAt", "updatedAt"],
  },

  /** What `issueTokens` returns - see modules/auth/auth.tokens.ts. */
  Tokens: {
    type: "object",
    description:
      "Store both. The access token goes on every later call; the refresh token is only ever sent to POST /api/v1/public/auth/refresh.\n\n**The tokens below are shortened samples.** Your real ones arrive in the *Server response* box under the Execute button, not in this Example Value panel.",
    properties: {
      tokenType: { type: "string", enum: ["Bearer"] },
      accessToken: {
        type: "string",
        description:
          "Sent on every later call as `Authorization: Bearer <token>`. A real one is a few hundred characters - three dot-separated parts.",
        example: "eyJhbGciOiJIUzI1NiIs…",
      },
      expiresIn: {
        type: "integer",
        description:
          "Access token lifetime in seconds, so the app can refresh before it is surprised by a 401.",
        example: 900,
      },
      refreshToken: { type: "string", example: "eyJhbGciOiJIUzI1NiIs…" },
      refreshExpiresIn: {
        type: "integer",
        description: "Refresh token lifetime in seconds.",
        example: 2592000,
      },
    },
    required: [
      "tokenType",
      "accessToken",
      "expiresIn",
      "refreshToken",
      "refreshExpiresIn",
    ],
  },

  /**
   * Which screen the app shows next. Decided in one place - see
   * `resolveAccountState` in modules/users/users.state.ts.
   */
  AccountState: {
    type: "string",
    description: [
      "Where the account is in its journey, and therefore which screen comes next:",
      "",
      "| State | The app should |",
      "| --- | --- |",
      "| `COMPLETE_PROFILE` | send a customer to the profile page |",
      "| `SUBMIT_DOCUMENTS` | send a technician to the national ID / criminal record form |",
      "| `WAITING_FOR_APPROVAL` | show \"under review\" - an admin has to approve |",
      "| `VERIFICATION_REJECTED` | let the technician upload the documents again |",
      "| `READY` | open the app |",
      "| `BLOCKED` / `SUSPENDED` | show the moderation message |",
    ].join("\n"),
    enum: [
      "COMPLETE_PROFILE",
      "SUBMIT_DOCUMENTS",
      "WAITING_FOR_APPROVAL",
      "VERIFICATION_REJECTED",
      "READY",
      "BLOCKED",
      "SUSPENDED",
    ],
  },

  /** A default sentence per state. The app may show its own wording instead. */
  AccountStateMessage: {
    type: "string",
    description:
      "A ready-made sentence for the state above, in Arabic - the app ships in Egypt. Switch on the state, not on this string.",
    example: "من فضلك كمّل بياناتك",
  },

  /** From `paginationMeta` in core/pagination.ts. */
  PaginationMeta: {
    type: "object",
    properties: {
      page: { type: "integer", example: 1 },
      limit: { type: "integer", example: 20 },
      total: { type: "integer", example: 42 },
      totalPages: { type: "integer", example: 3 },
    },
    required: ["page", "limit", "total", "totalPages"],
  },

  /**
   * Every failure in the app has this shape - see core/error-handler.ts. One
   * shape means the mobile app handles errors in exactly one place.
   */
  Error: {
    type: "object",
    properties: {
      error: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "Machine-readable and always English - switch on this, never on `message`: `validation_error`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `too_many_requests`, `not_implemented`, `internal_error`.",
            example: "validation_error",
          },
          message: {
            type: "string",
            description:
              "Arabic, ready to show to the user as-is. Wording may change at any time.",
            example: "في بيانات ناقصة أو مكتوبة غلط",
          },
          details: {
            description:
              "Present on validation errors (a list of `{ field, message }`) and on some conflicts. `field` is the English JSON field name; `message` is Arabic.",
            examples: [
              [
                {
                  field: "phone",
                  message:
                    "رقم التليفون لازم يكون من 7 لـ 20 رقم، وممكن يبدأ بعلامة +",
                },
              ],
            ],
          },
        },
        required: ["code", "message"],
      },
    },
    required: ["error"],
  },
};

/** An error response body, ready to drop into `components.responses`. */
function errorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: schemaRef("Error") } },
  };
}

/**
 * `components.responses` - the failures shared by many endpoints, declared once.
 *
 * Which of these an endpoint can return is not a guess: 401 and 403 come from
 * the guards in api/index.ts, 400 from `schema.parse`, 404/409 from the service,
 * and 501 from an endpoint that is still scaffolded.
 */
export const responses: Record<string, unknown> = {
  ValidationError: errorResponse(
    "The body, query or `:id` failed validation. `details` lists the offending fields.",
  ),
  Unauthorized: errorResponse(
    "No access token, or one that is expired or invalid. Refresh it, then sign in again if that fails too.",
  ),
  Forbidden: errorResponse(
    "The token is valid but the account may not call this - the wrong role for this audience group, or a blocked/suspended account.",
  ),
  NotFound: errorResponse("No such record."),
  Conflict: errorResponse(
    "The write clashes with the current state: a duplicate phone or name, a row that is still referenced, or an account that already finished signing up.",
  ),
  TooManyRequests: errorResponse(
    "Rate limited: another OTP was asked for too soon, or too many wrong codes were tried.",
  ),
  NotImplemented: errorResponse(
    "This endpoint is scaffolded but not written yet. See docs/INTERN-TASKS.md.",
  ),
};

/**
 * The only security scheme: the access token from `verify-otp`, sent as
 * `Authorization: Bearer <accessToken>`.
 */
export const securitySchemes = {
  bearerAuth: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description:
      "The `data.tokens.accessToken` from POST /api/v1/public/auth/verify-otp. Paste it into **Authorize** and Swagger UI will send it on every call below.",
  },
};
