import type { Severity } from "../../generated/prisma/enums.js";
import { ApiError } from "../../core/errors.js";

/**
 * TASK 8 - the entire AI integration, in one file.
 *
 * The same idea as modules/auth/auth.sms.ts: exactly one file knows what the
 * outside service is, so replacing it later means editing this file and no
 * other. Nothing above this line imports `fetch`.
 *
 * The contract to hand the AI engineer:
 *
 *   POST {AI_SERVICE_URL}/estimate
 *   { "category": "Plumbing",
 *     "title": "Kitchen sink leaking",
 *     "description": "Water under the sink since yesterday...",
 *     "images": ["https://api.example.com/uploads/1712-sink.jpg"] }
 *
 *   200
 *   { "severity": "MEDIUM",        // SMALL | MEDIUM | LARGE
 *     "confidence": 0.82,          // 0..1
 *     "summary": "..." }           // Egyptian Arabic, shown to the customer
 *
 * Three things that are ours to enforce and theirs to respect: the summary is
 * displayed verbatim, so it is written in Arabic; it must never contain a
 * price, because the price comes from our own `category_pricing` table and two
 * different numbers on one screen is a support ticket; and it is at most a
 * short paragraph, because it renders on a phone under the photo.
 *
 * **The AI does not price anything.** It returns a severity we can audit and
 * correct; the money is read out of the pricing table by the service.
 */

export type AiEstimateInput = {
  title: string;
  description: string;
  categoryName: string;
  imageUrls: string[];
};

export type AiEstimateResult = {
  severity: Severity;
  confidence: number;
  summary: string;
};

/**
 * TASK 8 - ask the model to size up a problem.
 *
 * TODO(task 8):
 *   - POST to `${AI_SERVICE_URL}/estimate` with `Authorization: Bearer
 *     ${AI_SERVICE_TOKEN}` and `signal: AbortSignal.timeout(AI_TIMEOUT_MS)`.
 *   - **Parse the response with zod before returning it.** This is somebody
 *     else's service: a `severity` of "medium" or "HUGE" has to become our 503,
 *     not a Prisma enum crash three lines later. Trim `summary` and cap it
 *     (1..2000).
 *   - Any failure at all - timeout, non-200, unparseable body - becomes
 *     `ApiError.serviceUnavailable(messages.ai.unavailable)`. Never a 500, and
 *     never a charge: the caller only spends points after this returns.
 *   - With no `AI_SERVICE_URL` configured, return a **deterministic stub**:
 *     hash the title into a severity, confidence 0.5, a fixed Arabic sentence,
 *     and log that it is a stub - exactly the way `sendOtpSms` prints the OTP
 *     instead of sending it. In production an unconfigured URL throws at
 *     startup instead, in core/env.ts. Without the stub nobody can test tasks
 *     9, 10 and 11 until the model exists.
 *
 * One thing to settle before a real model is wired in: those image URLs have to
 * be reachable *from the AI service*. Today the files sit on the app
 * container's local disk and the stored value is a path (`/uploads/...`), so a
 * remote model cannot fetch it. Either add a `PUBLIC_BASE_URL` and make the
 * folder publicly readable, or POST the bytes. Same limitation as the "one node
 * only" note in docs/ONBOARDING-FLOW.md, and S3 fixes both at once.
 */
export async function estimateProblem(
  input: AiEstimateInput,
): Promise<AiEstimateResult> {
  // TODO(task 8)
  throw ApiError.notImplemented();
}
