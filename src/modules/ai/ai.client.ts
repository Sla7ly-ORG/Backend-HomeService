import type { Severity } from "../../generated/prisma/enums.js";
import { ApiError } from "../../core/errors.js";

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
 * `request_id` is theirs. It keys the row the service writes into its own
 * prediction log (the `prediction-logs` volume in the AI compose file), so
 * storing it is what makes a disputed severity traceable later.
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
 *   - POST to `${AI_SERVICE_URL}/predict` with `Authorization: Bearer
 *     ${AI_SERVICE_TOKEN}` and `signal: AbortSignal.timeout(AI_TIMEOUT_MS)`.
 *   - **Parse the response with zod before returning it.** This is somebody
 *     else's service: a `severity` of "medium" or "HUGE" has to become our 503,
 *     not a Prisma enum crash three lines later. `request_id` is a uuid and the
 *     column is `@db.Uuid` - validate it as one. `confidence` is 0..1; reject
 *     anything outside it rather than storing a number that overflows
 *     `Decimal(5,4)`.
 *   - Any failure at all - timeout, non-200, unparseable body - becomes
 *     `ApiError.serviceUnavailable(messages.ai.unavailable)`. Never a 500, and
 *     never a charge: the caller only spends points after this returns.
 *   - With no `AI_SERVICE_URL` configured, return a **deterministic stub**:
 *     hash the description into a severity, confidence 0.5, `needsReview: true`,
 *     a stable fake uuid, and log that it is a stub - exactly the way
 *     `sendOtpSms` prints the OTP instead of sending it. In production an
 *     unconfigured URL throws at startup instead, in core/env.ts. Without the
 *     stub nobody can test tasks 9, 10 and 11 until the model is reachable.
 */
export async function estimateProblem(
  input: AiEstimateInput,
): Promise<AiEstimateResult> {
  // TODO(task 8)
  throw ApiError.notImplemented();
}
