import { Severity } from "../../generated/prisma/enums.js";
import { ApiError } from "../../core/errors.js";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { env } from "../../core/env.js";
import { messages } from "../../core/messages.js";

/**
 * TASK 8 - the entire AI integration, in one file.
 *
 * The same idea as modules/auth/auth.sms.ts: exactly one file knows what the
 * outside service is, so replacing it later means editing this file and no
 * other. Nothing above this line imports `fetch`.
 *
 * The contract, as the deployed service actually implements it:
 *
 *   POST {AI_SERVICE_URL}/predict
 *   { "category": "سباكة",
 *     "description": "حوض المطبخ بينقط من تحت من امبارح..." }
 *
 * `category` must be one of the **four** the service has a model for, spelled
 * its way: `سباكة`, `نجارة`, `كهرباء`, `دهانات`. It maps those to its English
 * model keys itself and answers `400 Unsupported category` to anything else -
 * `كهربا` and `نقاشة` included, so they are not interchangeable with `كهرباء`
 * and `دهانات`. `Category.name` is seeded to exactly these, so the name goes
 * out unchanged and nothing here translates anything. A fifth category in the
 * database needs a fifth model on their side first.
 *
 *   200
 *   { "request_id": "913819cb-3082-4edb-a56a-5c93a7fb0912",
 *     "category": "سباكة",
 *     "description": "...",            // echoed back, ignored here
 *     "severity": "LARGE",             // SMALL | MEDIUM | LARGE
 *     "confidence": 0.3789,            // 0..1, of the winning class
 *     "needs_review": true,            // the model's own call, not ours
 *     "probabilities": { "SMALL": 0.319, "MEDIUM": 0.302, "LARGE": 0.3789 } }
 *
 * Two things this contract does *not* have, both of which the older draft of
 * this file assumed:
 *
 *   - **No summary.** The model classifies; it does not write Arabic. The
 *     estimate screen shows a severity and the price band from
 *     `category_pricing`, and nothing is passed through to the customer
 *     verbatim. If a sentence is wanted there it has to come from somewhere
 *     else - a phrase per severity per category is a table, not a model.
 *   - **No images.** `/predict` takes category and description only, so the
 *     photo the customer uploaded is not part of the prediction. That also
 *     retires the old worry about image urls being unreachable from the AI
 *     service: nothing fetches them. Worth telling the customer the photo is
 *     for the technician, not the estimate.
 *
 * `request_id` is theirs. Every successful prediction is appended as one row to
 * `logs/prediction_logs.csv` on their side (the `prediction-logs` volume in the
 * AI compose file), keyed by it. Their own note on that file says the row is
 * meant to be "matched back to the technician's actual severity using
 * request_id" - which is exactly the pair `ai_request_id` and `actual_severity`
 * hold on our side. Storing the id is what makes the retraining set joinable at
 * all, and what makes a disputed severity traceable.
 *
 * **There is no authentication.** The service has no token, no api key and no
 * dependency guarding `/predict` - anything that can reach the port can call
 * it. That is why the AI compose file binds it to `127.0.0.1` and expects a
 * reverse proxy in front. Do not invent an `AI_SERVICE_TOKEN`: there is nothing
 * on the other side to check it. If this is ever exposed beyond localhost, the
 * auth has to be added there first, and this file gets the header then.
 *
 * **The AI does not price anything.** It returns a severity we can audit and
 * correct; the money is read out of the pricing table by the service.
 */

export type AiEstimateInput = {
  description: string;
  categoryName: string;
};

export type AiEstimateResult = {
  aiRequestId: string;
  severity: Severity;
  /** 0..1, stored as-is. */
  confidence: number;
  needsReview: boolean;
};

/**
 * TASK 8 - ask the model to size up a problem.
 *
 * TODO(task 8):
 *   - POST to `${AI_SERVICE_URL}/predict` with `signal:
 *     AbortSignal.timeout(AI_TIMEOUT_MS)`. No auth header - see above.
 *   - **Parse the response with zod before returning it.** This is somebody
 *     else's service: a `severity` of "medium" or "HUGE" has to become our 503,
 *     not a Prisma enum crash three lines later. `request_id` is a uuid and the
 *     column is `@db.Uuid` - validate it as one. `confidence` is 0..1; reject
 *     anything outside it rather than storing a number that overflows
 *     `Decimal(5,4)`.
 *   - Any failure at all - timeout, non-200, unparseable body - becomes
 *     `ApiError.serviceUnavailable(messages.ai.unavailable)`. Never a 500, and
 *     never a charge: the caller only spends points after this returns.
 *   - **Log a 400 loudly before converting it.** They answer 400 for exactly two
 *     things, and both are our fault, not an outage: a category their
 *     `CATEGORY_MAP` does not have, and an empty description. The categories are
 *     seeded to match theirs, so a 400 means the two lists have drifted - which
 *     the customer cannot fix and nobody will notice if it is filed under "the
 *     AI is down". The customer still gets the 503 and still keeps their points.
 *   - With no `AI_SERVICE_URL` configured, return a **deterministic stub**:
 *     hash the description into a severity, confidence 0.5, `needsReview: true`,
 *     a stable fake uuid, and log that it is a stub - exactly the way
 *     `sendOtpSms` prints the OTP instead of sending it. In production an
 *     unconfigured URL throws at startup instead, in core/env.ts. Without the
 *     stub nobody can test tasks 9, 10 and 11 until the model is reachable.
 */
/** What `/predict` actually answers, validated before anything downstream sees it. */
const predictResponseSchema = z.object({
  request_id: z.string().uuid(),
  severity: z.enum(Severity),
  confidence: z.number().min(0).max(1),
  needs_review: z.boolean(),
  // Echoed back and not used here, but present on the wire.
  category: z.string().optional(),
  description: z.string().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
});

/**
 * A stable, offline stand-in for the model - same input, same answer, every
 * time, so the estimate screen and tasks 9-11 are testable without a real
 * service behind AI_SERVICE_URL.
 */
function stubEstimate(input: AiEstimateInput): AiEstimateResult {
  const hash = createHash("sha256").update(input.description).digest("hex");
  const severities = [Severity.SMALL, Severity.MEDIUM, Severity.LARGE];
  const severity =
    severities[parseInt(hash.slice(0, 2), 16) % severities.length]!;

  const aiRequestId = randomUUID();
  const result: AiEstimateResult = {
    aiRequestId,
    severity,
    confidence: 0.5,
    needsReview: true,
  };

  console.log(
    `[ai] AI_SERVICE_URL not configured - stub estimate for "${input.categoryName}": ${severity}`,
  );

  return result;
}

export async function estimateProblem(
  input: AiEstimateInput,
): Promise<AiEstimateResult> {
  if (!env.AI_SERVICE_URL) {
    return stubEstimate(input);
  }

  let response: Response;
  try {
    response = await fetch(`${env.AI_SERVICE_URL}/predict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: input.categoryName,
        description: input.description,
      }),
      signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
    });
  } catch {
    // Network error, DNS failure, or the timeout above firing.
    throw ApiError.serviceUnavailable(messages.ai.unavailable);
  }

  if (!response.ok) {
    // A 400 here is ours, not an outage: an unsupported category or an empty
    // description - the two things their /predict rejects. Log it loudly so
    // it gets noticed as a category drift and not filed under "AI is down",
    // then still hand the customer the same 503 and keep their points.
    if (response.status === 400) {
      const body = await response.text().catch(() => "");
      console.error(
        `[ai] /predict rejected the request as 400 for category "${input.categoryName}": ${body}`,
      );
    }
    throw ApiError.serviceUnavailable(messages.ai.unavailable);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw ApiError.serviceUnavailable(messages.ai.unavailable);
  }

  const parsed = predictResponseSchema.safeParse(json);
  if (!parsed.success) {
    console.error("[ai] /predict returned an unparseable body:", parsed.error);
    throw ApiError.serviceUnavailable(messages.ai.unavailable);
  }

  return {
    aiRequestId: parsed.data.request_id,
    severity: parsed.data.severity,
    confidence: parsed.data.confidence,
    needsReview: parsed.data.needs_review,
  };
}
