import type { Prisma, ServiceRequest } from "../../generated/prisma/client.js";
import { ApiError } from "../../core/errors.js";
import type { ListJobsQuery, SubmitOfferBody } from "./offers.schema.js";

/**
 * TASKS 10 & 11 - the fan-out, the technician's feed, and the customer's
 * choice.
 *
 * Every guard in this file is a **conditional write, not a read**. Two people
 * tapping at the same second is the normal case here, not the edge case: five
 * technicians race to answer one job, and a customer can double-tap accept on a
 * slow connection. `updateMany` with the expected state in its `where`, then
 * `count === 0` -> 409, is what makes that safe. A `findFirst` and an `if` lets
 * both through.
 *
 * TODO(task 10): the constants, named here, never typed inline:
 *   FANOUT_RADIUS_KM        25
 *   FANOUT_MAX_TECHNICIANS  50
 *   MAX_OFFERS_PER_REQUEST   5
 *   OFFER_FEE_MIN_MULTIPLIER 0.5
 *   OFFER_FEE_MAX_MULTIPLIER 3
 */

/**
 * TASK 10 - one PENDING offer row per eligible technician, inside the publish
 * transaction.
 *
 * Eligible means **all** of: `TechnicianProfile.categoryId ===
 * request.categoryId`, `verificationStatus: "VERIFIED"`, `isAvailable: true`,
 * `user.status: "ACTIVE"`, `user.deletedAt: null`, and inside
 * `FANOUT_RADIUS_KM` - nearest `FANOUT_MAX_TECHNICIANS` if more qualify.
 *
 * Filter with `boundingBox` in the `where` first, then trim with `distanceKm`
 * in JS - see core/geo.ts for why that order and not the other one. Then
 * `createMany({ ..., skipDuplicates: true })`.
 *
 * **Return the technician user ids**, not a count: the caller has to emit to
 * them, and you cannot emit to a number.
 *
 * Why rows at all, rather than every technician running a live query against
 * open requests: `@@unique([serviceRequestId, technicianId])` and
 * `OfferStatus.PENDING` already exist for this, a declined offer needs a row to
 * stay hidden anyway, and "it disappeared from the other technicians' screens"
 * becomes one `updateMany` instead of a filter that every reader has to
 * remember. It is also what a reconnecting phone re-reads, and what push
 * notifications will hang off later. The cost is one `createMany` of at most
 * fifty rows per publish.
 */
export async function fanOutOffers(
  tx: Prisma.TransactionClient,
  request: ServiceRequest,
) {
  // TODO(task 10): returns Promise<bigint[]>
  throw ApiError.notImplemented();
}

/**
 * TASK 10 - the technician's feed.
 *
 *   where: { technicianId,
 *            status: query.status ?? "PENDING",
 *            serviceRequest: { status: "WAITING_FOR_TECHNICIAN" } }
 *
 * `include` the request with its category, attachments, `aiEstimation` and
 * customer. Paginated, newest first.
 *
 * That second condition is belt and braces: a cancelled request should never
 * render even if one of its offers was somehow missed by the cancel.
 */
export async function listTechnicianJobs(
  technicianId: bigint,
  query: ListJobsQuery,
) {
  // TODO(task 10): returns { jobs, total }
  throw ApiError.notImplemented();
}

/**
 * TASK 10 - the technician names their fee. One transaction:
 *
 *  1. Read the request's category for the bounds -
 *     `homeVisitBasePrice * OFFER_FEE_MIN_MULTIPLIER` up to
 *     `* OFFER_FEE_MAX_MULTIPLIER`. Outside them -> 400
 *     `messages.offers.feeOutOfRange(min, max)`.
 *  2. `updateMany({ where: { id: offerId, technicianId, status: "PENDING",
 *     serviceRequest: { status: "WAITING_FOR_TECHNICIAN" } },
 *     data: { status: "SUBMITTED", consultationFee, submittedAt: new Date() } })`
 *     `count === 0` -> 409 `messages.offers.noLongerAvailable`, which covers
 *     all of: not mine, already answered, request cancelled, technician already
 *     chosen. One message, because the technician's next move is the same in
 *     every case: the card is gone.
 *  3. Count the `SUBMITTED` offers on that request. Over
 *     `MAX_OFFERS_PER_REQUEST` -> roll back with a 409
 *     `messages.offers.enoughTechnicians`. Exactly at it -> close the rest:
 *     `updateMany({ where: { serviceRequestId, status: "PENDING" },
 *     data: { status: "NOT_SELECTED" } })`, collecting those technician ids
 *     first. It fires here rather than at selection so four other people are
 *     not left waiting on one customer's decision.
 *
 * After the commit: `emitOfferNew(customerId, requestId, card)` with the
 * customer's version of the offer (task 11's mapper), and - if the request just
 * filled up - `emitJobClosed(closedIds, requestId, "FULL")`.
 */
export async function submitOffer(
  technicianId: bigint,
  offerId: bigint,
  data: SubmitOfferBody,
) {
  // TODO(task 10)
  throw ApiError.notImplemented();
}

/**
 * TASK 10 - "not interested". `PENDING` -> `DECLINED`, the same conditional
 * update shape as above.
 *
 * Nothing else changes and nothing is emitted: it hides one card, on the screen
 * that asked for it.
 */
export async function declineOffer(technicianId: bigint, offerId: bigint) {
  // TODO(task 10)
  throw ApiError.notImplemented();
}

/**
 * TASK 11 - the offers a customer chooses between.
 *
 * The `SUBMITTED` offers on that request, with the technician's `User`, their
 * `TechnicianProfile` and the profile's `Category`. **Not paginated** -
 * `MAX_OFFERS_PER_REQUEST` is five.
 *
 * Compute `distanceKm` for each from the request's stored coordinates, sort
 * ascending, and break ties on `overallRating` descending. Sorting in JS is
 * right here and wrong in `fanOutOffers`: five rows, versus every technician in
 * the governorate.
 *
 * Count each technician's past jobs in the same query, with a filtered relation
 * count:
 *
 *   _count: { select: { requestsAsTechnician: {
 *     where: { status: { notIn: ["PENDING", "WAITING_FOR_TECHNICIAN", "CANCELLED"] } },
 *   } } }
 *
 * Jobs they were *given*, not jobs they finished: `COMPLETED` is unreachable
 * until the job lifecycle exists, and a screen full of "0 past orders" helps
 * nobody choose. Tighten that `where` when completion lands - one place, one
 * line. If it ever shows up in a slow query log, the answer is a counter column
 * on `TechnicianProfile`, not a cleverer query.
 */
export async function listRequestOffers(customerId: bigint, requestId: bigint) {
  // TODO(task 11)
  throw ApiError.notImplemented();
}

/**
 * TASK 11 - the customer hires one. One transaction, in this order:
 *
 *  1. `tx.serviceRequest.updateMany({ where: { id: requestId, customerId,
 *     status: "WAITING_FOR_TECHNICIAN", technicianId: null },
 *     data: { technicianId, status: "TECHNICIAN_SELECTED", visitFee,
 *     distanceKm } })`. `count === 0` -> 409
 *     `messages.offers.alreadyAssigned`. **The request goes first on purpose**:
 *     it is the lock. Two taps on a slow connection cannot both assign, because
 *     the second no longer matches `technicianId: null`.
 *  2. The chosen offer `SUBMITTED` -> `SELECTED`, conditionally. `count === 0`
 *     means no fee was ever sent on it -> 409 `messages.offers.notSubmitted`.
 *  3. Every other offer on the request -> `NOT_SELECTED`, collecting those
 *     technician ids on the way.
 *
 * `visitFee` is **the accepted offer's `consultationFee`**, read off the offer
 * row inside the transaction and copied onto the request. Not the category's
 * base price, and never a number from the request body - a fee the client sends
 * is a fee the client chose. It is a snapshot for the same reason the address
 * is: that technician will price their next job differently, and last month's
 * job must not move with them.
 *
 * After the commit, the three emits that make the job vanish from everyone
 * else's screen - the one part of this requirement the app cannot do itself:
 *
 *   emitJobSelected(winnerId, requestId, offerId);
 *   emitJobClosed(loserIds, requestId, "TAKEN");
 *   emitRequestUpdated(customerId, requestId, "TECHNICIAN_SELECTED");
 */
export async function acceptOffer(
  customerId: bigint,
  requestId: bigint,
  offerId: bigint,
) {
  // TODO(task 11)
  throw ApiError.notImplemented();
}
