import { ApiError } from "../../core/errors.js";
import type {
  CreateServiceRequestBody,
  ListMyRequestsQuery,
} from "./requests.schema.js";

/**
 * TASKS 7, 8 & 10 - all database access for service requests.
 *
 * The one rule the whole file hangs off: **a request is a draft until it is
 * published.** `PENDING` means the customer is still filling it in, and
 * `WAITING_FOR_TECHNICIAN` means it is out there. Nothing reaches a technician
 * until `publishServiceRequest`.
 */

/**
 * TASK 7 - the draft, created the moment the customer submits the description
 * screen. Both buttons land here; only `requestType` differs.
 *
 * One `prisma.$transaction`:
 *   1. create the request with `status: "PENDING"`
 *   2. `tx.requestAttachment.createMany` for the images
 *
 * **The address is a snapshot, not a join.** Default it from the user's profile
 * when the body did not override it, but copy the values onto the request: the
 * customer may move house next year, and the job happened where it happened.
 * Same reasoning as `visitFee` in task 11.
 *
 * A `categoryId` that does not exist is a Prisma P2003 and the error handler
 * already turns it into a 409. Do not pre-check it.
 */
export async function createServiceRequest(
  customerId: bigint,
  data: CreateServiceRequestBody,
) {
  // TODO(task 7)
  throw ApiError.notImplemented();
}

/**
 * TASK 7 - the past-orders screen. A page plus a total, newest first.
 *
 * `where: { customerId, ... }` always - scope it in the query, never fetch and
 * then compare in JS. `include: { category: true, technician: true,
 * aiEstimation: true, _count: { select: { offers: true } } }`.
 *
 * **Drafts are excluded unless they are asked for by name.** With no
 * `query.status`, filter `status: { not: "PENDING" }`: a customer who opened
 * the AI screen and backed out left a row behind, and it is not an order they
 * placed. `?status=PENDING` still returns them, so nothing is unreachable.
 */
export async function listCustomerRequests(
  customerId: bigint,
  query: ListMyRequestsQuery,
) {
  // TODO(task 7): returns { requests, total }
  throw ApiError.notImplemented();
}

/**
 * TASK 7 - one request, with everything the detail screen shows: attachments,
 * estimation, category, technician, and `_count: { select: { offers: true } }`.
 *
 * `findFirst({ where: { id: requestId, customerId } })`. Somebody else's
 * request is a **404, not a 403** - a 403 confirms to a stranger that the id
 * exists.
 */
export async function getCustomerRequest(customerId: bigint, requestId: bigint) {
  // TODO(task 7)
  throw ApiError.notImplemented();
}

/**
 * TASK 7 - the Cancel button on the waiting screen.
 *
 * Allowed from `PENDING`, `WAITING_FOR_TECHNICIAN` and `TECHNICIAN_SELECTED`;
 * anything else is a 409. One transaction:
 *   - the request to `CANCELLED`
 *   - every offer still `PENDING` or `SUBMITTED` to `NOT_SELECTED`, so it drops
 *     out of the technicians' feeds too
 *
 * **Return the ids of the technicians whose offers it just closed.** Collect
 * them with a `findMany({ select: { technicianId: true } })` *inside* the
 * transaction and *before* the `updateMany`, or nothing will match any more.
 * Task 10 hands them to `emitJobClosed(ids, requestId, "CANCELLED")` so the
 * card disappears from the screens people are actually looking at.
 */
export async function cancelServiceRequest(
  customerId: bigint,
  requestId: bigint,
) {
  // TODO(task 7)
  throw ApiError.notImplemented();
}

/**
 * TASK 8 - "describe it with an AI". The order of operations *is* the task:
 *
 *  1. Load the request with its category and attachments, scoped by
 *     `customerId`. Missing -> 404.
 *  2. `requestType !== "AI_ESTIMATION"` or `status !== "PENDING"` -> 409.
 *  3. **Already has an `aiEstimation` -> return it and charge nothing.** Not a
 *     409: a customer whose app retried a timed-out request must not pay twice.
 *     `AiEstimation.serviceRequestId` is unique, so the database agrees with
 *     you. The route reports `pointsCharged: 0` for this case.
 *  4. Cheap balance check -> 402 before calling the AI. Do not spend somebody
 *     else's GPU on a customer who cannot pay for it. This is a courtesy check,
 *     not the guard.
 *  5. `await estimateProblem(...)` - **outside any transaction.** A 15-second
 *     HTTP call inside `$transaction` holds a Postgres connection open for 15
 *     seconds; do that a hundred times at once and the pool is gone.
 *  6. One `prisma.$transaction`:
 *       - `spendPoints(tx, customerId, AI_ESTIMATION_POINTS_COST, { serviceRequestId })`
 *         - the real guard. A 402 here means a concurrent estimation won.
 *       - `tx.categoryPricing.findUnique({ where: { categoryId_severity: ... } })`
 *         for the min/max. A missing row is `ApiError.conflict(
 *         messages.requests.pricingMissing)` - the bands are seeded for every
 *         category by prisma/seed-categories.ts, so a gap is a deployment fault,
 *         not something the customer did.
 *       - `tx.aiEstimation.create({ ... })`, including the AI's `summary`.
 *
 *     All three or none: if the pricing lookup fails, the 50 points are never
 *     taken, because the transaction rolls back the decrement with it.
 *
 * Return the estimation, what was charged, and the new balance - the screen
 * shows the estimate and the wallet together and should not need a second call.
 */
export async function estimateServiceRequest(
  customerId: bigint,
  requestId: bigint,
) {
  // TODO(task 8)
  throw ApiError.notImplemented();
}

/**
 * TASK 10 - the Send button.
 *
 * Guards: owned by the caller, `status === "PENDING"`, and - when `requestType`
 * is `AI_ESTIMATION` - an `aiEstimation` row exists. Publishing an AI request
 * with no estimate would send technicians a card with an empty severity on it.
 * `CONSULTATION` skips that check; there is nothing to wait for.
 *
 * One transaction: set `status: "WAITING_FOR_TECHNICIAN"`, then
 * `fanOutOffers(tx, request)`. Return the request and the technician ids it
 * reached - ids, not a count, because the caller has to emit to them.
 *
 * Then, **after the commit**, `emitJobNew(...)` per technician. Outside the
 * transaction, always: emit inside it and a rollback leaves fifty technicians
 * looking at a job that does not exist. `distanceKm` differs per technician, so
 * map the card per recipient instead of sending one shared object carrying
 * somebody else's distance.
 *
 * **Zero technicians nearby is not an error.** Publish anyway and return
 * `technicianCount: 0` so the app can say "nobody in your area yet" instead of
 * a 409 the customer cannot act on. Note in a comment that the fan-out has
 * already happened by then, so a technician who signs up an hour later will not
 * see this request - it is the first thing somebody will report as a bug, and
 * re-running the fan-out on a timer is the fix if it ever matters.
 */
export async function publishServiceRequest(
  customerId: bigint,
  requestId: bigint,
) {
  // TODO(task 10)
  throw ApiError.notImplemented();
}
