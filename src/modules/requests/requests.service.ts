import { ApiError } from "../../core/errors.js";
import { env } from "../../core/env.js";
import { messages } from "../../core/messages.js";
import { skipTake } from "../../core/pagination.js";
import { prisma } from "../../core/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { RequestStatus } from "../../generated/prisma/enums.js";
import type {
  CreateServiceRequestBody,
  ListMyRequestsQuery,
} from "./requests.schema.js";
import { estimateProblem } from "../ai/ai.client.js";
import { spendPoints } from "../points/points.service.js";
import {
  fanOutOffers,
  OFFER_FEE_MAX_MULTIPLIER,
  OFFER_FEE_MIN_MULTIPLIER,
  technicianJobInclude,
} from "../offers/offers.service.js";
import { toTechnicianJobResponse } from "../offers/offers.mapper.js";
import { emitJobNew } from "../../realtime/realtime.emit.js";
import { distanceKm } from "../../core/geo.js";
/**
 * TASKS 7, 8 & 10 - all database access for service requests.
 *
 * The one rule the whole file hangs off: **a request is a draft until it is
 * published.** `PENDING` means the customer is still filling it in, and
 * `WAITING_FOR_TECHNICIAN` means it is out there. Nothing reaches a technician
 * until `publishServiceRequest`.
 */

/**
 * Everything the detail screen shows. Exported because requests.mapper.ts
 * derives its parameter type from it - add a relation here and the mapper is a
 * type error until it handles it, which is the point.
 */
export const requestDetailInclude = {
  attachments: true,
  // The three price bands, not just the category name. The AI returns a
  // severity and no money, so the range on the estimate screen is looked up
  // here rather than stored - three rows per category, already in memory by the
  // time the mapper needs one.
  category: { include: { pricing: true } },
  technician: true,
  _count: { select: { offers: true } },
} satisfies Prisma.ServiceRequestInclude;

/**
 * Deliberately smaller: no attachments. A page of twenty rows renders one line
 * of each, and twenty sets of image urls is twenty joins nobody looks at.
 */
export const requestListInclude = {
  // No pricing bands either: the row shows a title and a status, and the
  // estimate's price range belongs to the detail screen.
  category: true,
  technician: true,
  _count: { select: { offers: true } },
} satisfies Prisma.ServiceRequestInclude;

export type ServiceRequestDetail = Prisma.ServiceRequestGetPayload<{
  include: typeof requestDetailInclude;
}>;

export type ServiceRequestListRow = Prisma.ServiceRequestGetPayload<{
  include: typeof requestListInclude;
}>;

/**
 * Cancelling is only meaningful while nobody has started work. `ON_THE_WAY` and
 * everything after it means a technician is already moving, and `COMPLETED` /
 * `CANCELLED` are done - all four are a 409.
 */
const CANCELLABLE_STATUSES: RequestStatus[] = [
  "PENDING",
  "WAITING_FOR_TECHNICIAN",
  "TECHNICIAN_SELECTED",
];

/**
 * The offer states a live request can leave behind. `ACCEPTED` is what a
 * technician's submitted fee is called today; task 10 renames the enum value to
 * `SUBMITTED` and this list changes with it.
 */
const OPEN_OFFER_STATUSES = ["PENDING", "SUBMITTED"] as const;

/**
 * TASK 7 - the draft, created the moment the customer submits the description
 * screen. Both buttons land here; only `requestType` differs.
 *
 * **The address is a snapshot, not a join.** It defaults from the user's
 * profile when the body did not override it, but the values are copied onto the
 * request: the customer may move house next year, and the job happened where it
 * happened. Same reasoning as `visitFee` in task 11.
 *
 * A `categoryId` that does not exist is a Prisma P2003 and the error handler
 * already turns it into a 409, so there is no pre-check for it here.
 */
export async function createServiceRequest(
  customerId: bigint,
  data: CreateServiceRequestBody,
) {
  const customer = await prisma.user.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { address: true, city: true, latitude: true, longitude: true },
  });

  if (!customer) {
    throw ApiError.notFound(messages.users.notFound);
  }

  const serviceAddress = data.serviceAddress ?? customer.address;
  const serviceCity = data.serviceCity ?? customer.city;
  const serviceLatitude = data.latitude ?? customer.latitude?.toNumber();
  const serviceLongitude = data.longitude ?? customer.longitude?.toNumber();

  // Every profile column here is nullable, so the four defaults can all come
  // back empty. In practice onboarding fills them in, but a half-finished
  // account must not create a job with nowhere to send anyone.
  if (
    serviceAddress === null ||
    serviceCity === null ||
    serviceLatitude === undefined ||
    serviceLongitude === undefined
  ) {
    throw ApiError.badRequest(messages.requests.addressMissing);
  }

  const id = await prisma.$transaction(async (tx) => {
    const { id } = await tx.serviceRequest.create({
      data: {
        customerId,
        categoryId: data.categoryId,
        requestType: data.requestType,
        title: data.title,
        description: data.description,
        serviceAddress,
        serviceCity,
        serviceLatitude,
        serviceLongitude,
        // A draft, always. Publishing is task 10's separate call, and this one
        // must not put anything in front of a technician.
        status: "PENDING",
      },
      select: { id: true },
    });

    await tx.requestAttachment.createMany({
      data: data.images.map((imageUrl) => ({ requestId: id, imageUrl })),
    });

    return id;
  });

  // Read back rather than reusing the row `create` returned: the attachments
  // were written after it, so that row does not know about them.
  //
  // **Outside the transaction on purpose.** A multi-relation `include` makes
  // Prisma load the relations concurrently, and inside `$transaction` those all
  // share one pg client - which pg deprecates and drops in pg@9. Reading after
  // the commit also keeps the write's locks as short as they can be.
  return prisma.serviceRequest.findUniqueOrThrow({
    where: { id },
    include: requestDetailInclude,
  });
}

/**
 * TASK 7 - the past-orders screen. A page plus a total, newest first.
 *
 * **Drafts are excluded unless they are asked for by name.** With no
 * `query.status` the filter is `status: { not: "PENDING" }`: a customer who
 * opened the AI screen and backed out left a row behind, and it is not an order
 * they placed. `?status=PENDING` still returns them, so nothing is unreachable.
 */
export async function listCustomerRequests(
  customerId: bigint,
  query: ListMyRequestsQuery,
) {
  // Scoped in the query, never fetched and then compared in JS.
  const where: Prisma.ServiceRequestWhereInput = {
    customerId,
    status: query.status ?? { not: "PENDING" },
  };

  const [requests, total] = await Promise.all([
    prisma.serviceRequest.findMany({
      where,
      include: requestListInclude,
      orderBy: { createdAt: "desc" },
      ...skipTake(query),
    }),
    prisma.serviceRequest.count({ where }),
  ]);

  return { requests, total };
}

/**
 * TASK 7 - one request, with everything the detail screen shows.
 *
 * Somebody else's request is a **404, not a 403** - a 403 confirms to a
 * stranger that the id exists, and `customerId` is in the `where` rather than
 * in an `if`, so there is no shape of this function that leaks one.
 */
export async function getCustomerRequest(customerId: bigint, requestId: bigint) {
  const request = await prisma.serviceRequest.findFirst({
    where: { id: requestId, customerId },
    include: requestDetailInclude,
  });

  if (!request) {
    throw ApiError.notFound(messages.requests.notFound);
  }

  return request;
}

/**
 * TASK 7 - the Cancel button on the waiting screen.
 *
 * Returns the updated request together with **the ids of the technicians whose
 * offers it just closed**. Nothing uses them today; task 10 hands them to
 * `emitJobClosed(ids, requestId, "CANCELLED")` so the card disappears from the
 * screens people are actually looking at.
 */
export async function cancelServiceRequest(
  customerId: bigint,
  requestId: bigint,
) {
  const technicianIds = await prisma.$transaction(async (tx) => {
    const existing = await tx.serviceRequest.findFirst({
      where: { id: requestId, customerId },
      select: { status: true },
    });

    if (!existing) {
      throw ApiError.notFound(messages.requests.notFound);
    }

    if (!CANCELLABLE_STATUSES.includes(existing.status)) {
      throw ApiError.conflict(messages.requests.cannotCancel);
    }

    // Collected *before* the updateMany below, and inside this transaction:
    // once those rows are NOT_SELECTED nothing matches the filter any more and
    // the list comes back empty.
    const openOffers = await tx.technicianOffer.findMany({
      where: {
        serviceRequestId: requestId,
        status: { in: [...OPEN_OFFER_STATUSES] },
      },
      select: { technicianId: true },
    });

    await tx.technicianOffer.updateMany({
      where: {
        serviceRequestId: requestId,
        status: { in: [...OPEN_OFFER_STATUSES] },
      },
      data: { status: "NOT_SELECTED" },
    });

    await tx.serviceRequest.update({
      where: { id: requestId },
      data: { status: "CANCELLED" },
      select: { id: true },
    });

    return openOffers.map((offer) => offer.technicianId);
  });

  // After the commit, for the same reason as in `createServiceRequest`: the
  // detail `include` must not run on the transaction's client.
  const request = await prisma.serviceRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: requestDetailInclude,
  });

  return { request, technicianIds };
}

/**
 * TASK 8 - "describe it with an AI". The order of operations *is* the task:
 *
 *  1. Load the request with its category and attachments, scoped by
 *     `customerId`. Missing -> 404.
 *  2. `requestType !== "AI_ESTIMATION"` or `status !== "PENDING"` -> 409.
 *  3. **`aiSeverity` already set -> return it and charge nothing.** Not a 409: a
 *     customer whose app retried a timed-out request must not pay twice. The
 *     route reports `pointsCharged: 0` for this case.
 *  4. Cheap balance check -> 402 before calling the AI. Do not spend somebody
 *     else's GPU on a customer who cannot pay for it. This is a courtesy check,
 *     not the guard.
 *  5. `await estimateProblem(...)` - **outside any transaction.** A 15-second
 *     HTTP call inside `$transaction` holds a Postgres connection open for 15
 *     seconds; do that a hundred times at once and the pool is gone.
 *  6. One `prisma.$transaction`:
 *       - `spendPoints(tx, customerId, AI_ESTIMATION_POINTS_COST, { serviceRequestId })`
 *         - the real guard. A 402 here means a concurrent estimation won.
 *       - `tx.serviceRequest.update({ where: { id, aiSeverity: null }, ... })`
 *         writing `aiRequestId`, `aiSeverity`, `aiConfidence` and
 *         `aiNeedsReview` from the result. **Never `actualSeverity`** - that
 *         column means "a human looked", and pre-filling it with the model's
 *         own answer destroys the only labels worth retraining on.
 *
 *     Both or neither: the update and the decrement roll back together.
 *
 * There is no pricing lookup here any more, and no min/max to store: the
 * severity is the whole answer, and `toAiEstimationResponse` reads the band out
 * of `category_pricing` when the screen is drawn. A category missing its band
 * is then a `null` price on one screen instead of a 409 that costs the customer
 * an estimate they already paid for.
 *
 * Return the request, what was charged, and the new balance - the screen shows
 * the estimate and the wallet together and should not need a second call.
 */
export async function estimateServiceRequest(
  customerId: bigint,
  requestId: bigint,
) {
  const request = await prisma.serviceRequest.findFirst({
    where: { id: requestId, customerId },
    include: requestDetailInclude,
  });

  if (!request) {
    throw ApiError.notFound(messages.requests.notFound);
  }

  if (request.requestType !== "AI_ESTIMATION" || request.status !== "PENDING") {
    throw ApiError.conflict(messages.requests.notEstimable);
  }

  // Already estimated - hand it back and charge nothing. A retried request
  // (a client that timed out waiting the first time) must not pay twice.
  if (request.aiSeverity !== null) {
    const customer = await prisma.user.findUniqueOrThrow({
      where: { id: customerId },
      select: { pointsBalance: true },
    });

    return { request, pointsCharged: 0, pointsBalance: customer.pointsBalance };
  }

  // A courtesy check, not the guard - the real one is the conditional update
  // inside spendPoints below. This just avoids calling out to the model for a
  // customer who plainly cannot pay for the answer.
  const customer = await prisma.user.findUniqueOrThrow({
    where: { id: customerId },
    select: { pointsBalance: true },
  });
  if (customer.pointsBalance < env.AI_ESTIMATION_POINTS_COST) {
    throw ApiError.paymentRequired();
  }

  // Outside any transaction: this can take up to AI_TIMEOUT_MS, and holding a
  // Postgres connection open for that long, a hundred times at once, empties
  // the pool.
  const estimate = await estimateProblem({
    description: request.description,
    categoryName: request.category.name,
  });

  const pointsBalance = await prisma.$transaction(async (tx) => {
    const balance = await spendPoints(
      tx,
      customerId,
      env.AI_ESTIMATION_POINTS_COST,
      { reason: "AI estimation", serviceRequestId: requestId },
    );

    // Conditional on aiSeverity still being null: a concurrent call that won
    // the race already wrote it, and this one should not overwrite it with a
    // second (possibly different) prediction after having also just paid -
    // throwing here rolls the spend above back too, since both are in this
    // transaction.
    const { count } = await tx.serviceRequest.updateMany({
      where: { id: requestId, aiSeverity: null },
      data: {
        aiRequestId: estimate.aiRequestId,
        aiSeverity: estimate.severity,
        aiConfidence: estimate.confidence,
        aiNeedsReview: estimate.needsReview,
        // Never actualSeverity - that column means "a human looked".
      },
    });

    if (count === 0) {
      throw ApiError.conflict(messages.requests.notEstimable);
    }

    return balance;
  });

  // Outside the transaction, same reasoning as everywhere else in this file:
  // the detail `include` must not run on the transaction's client.
  const updated = await prisma.serviceRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: requestDetailInclude,
  });

  return {
    request: updated,
    pointsCharged: env.AI_ESTIMATION_POINTS_COST,
    pointsBalance,
  };
}

/**
 * TASK 10 - the Send button.
 *
 * Guards: owned by the caller, `status === "PENDING"`, and - when `requestType`
 * is `AI_ESTIMATION` - `aiSeverity` is not null. Publishing an AI request with
 * no estimate would send technicians a card with an empty severity on it.
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
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.serviceRequest.findFirst({
      where: {
        id: requestId,
        customerId,
      },
    });

    if (!existing) {
      throw ApiError.notFound(messages.requests.notFound);
    }

    if (existing.status !== "PENDING") {
      throw ApiError.conflict(messages.requests.notDraft);
    }

    /**
     * AI_ESTIMATION requests must have an AI result before publishing.
     * CONSULTATION requests do not need an estimate.
     */
    if (
      existing.requestType === "AI_ESTIMATION" &&
      existing.aiSeverity === null
    ) {
      throw ApiError.conflict(messages.requests.estimationMissing);
    }

    /**
     * Publish first, then fan-out inside the same transaction.
     */
    const request = await tx.serviceRequest.update({
      where: {
        id: requestId,
      },

      data: {
        status: "WAITING_FOR_TECHNICIAN",
      },
    });

    const technicianIds = await fanOutOffers(tx, request);

    return {
      request,
      technicianIds,
    };
  });

  /**
   * Never emit before the transaction commits.
   *
   * Re-read the request after commit so all relations required by the
   * technician card are available.
   */
  const request = await prisma.serviceRequest.findUniqueOrThrow({
    where: {
      id: requestId,
    },

    include: requestDetailInclude,
  });

  /**
   * No nearby technicians is valid.
   * The request remains WAITING_FOR_TECHNICIAN.
   */
  if (result.technicianIds.length === 0) {
    return {
      request,
      technicianCount: 0,
    };
  }

  /**
   * Load the created offers with exactly the shape required
   * by toTechnicianJobResponse.
   */
  const offers = await prisma.technicianOffer.findMany({
    where: {
      serviceRequestId: requestId,
      technicianId: {
        in: result.technicianIds,
      },
    },

    include: technicianJobInclude,
  });

  /**
   * Load technician locations once.
   * Each technician receives a card containing THEIR distance.
   */
  const technicians = await prisma.user.findMany({
    where: {
      id: {
        in: result.technicianIds,
      },
    },

    select: {
      id: true,
      latitude: true,
      longitude: true,
    },
  });

  const locationById = new Map(
    technicians.map((technician) => [
      technician.id.toString(),
      technician,
    ]),
  );

  const origin = {
    lat: request.serviceLatitude.toNumber(),
    lng: request.serviceLongitude.toNumber(),
  };

  const basePrice = request.category.homeVisitBasePrice.toNumber();

  const fee = {
    suggested: basePrice.toFixed(2),
    min: (basePrice * OFFER_FEE_MIN_MULTIPLIER).toFixed(2),
    max: (basePrice * OFFER_FEE_MAX_MULTIPLIER).toFixed(2),
  };

  /**
   * job:new is emitted AFTER the transaction.
   *
   * Distance is calculated separately for every technician.
   */
  for (const offer of offers) {
    const technician = locationById.get(
      offer.technicianId.toString(),
    );

    let jobDistanceKm = 0;

    if (
      technician?.latitude !== null &&
      technician?.latitude !== undefined &&
      technician?.longitude !== null &&
      technician?.longitude !== undefined
    ) {
      jobDistanceKm = distanceKm(origin, {
        lat: technician.latitude.toNumber(),
        lng: technician.longitude.toNumber(),
      });
    }

    emitJobNew(
      [offer.technicianId],
      toTechnicianJobResponse(
        offer,
        jobDistanceKm,
        fee,
      ),
    );
  }

  return {
    request,
    technicianCount: result.technicianIds.length,
  };
}
