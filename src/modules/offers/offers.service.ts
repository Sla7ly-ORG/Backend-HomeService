import type { Prisma, ServiceRequest } from "../../generated/prisma/client.js";
import type { Severity } from "../../generated/prisma/enums.js";
import { ApiError } from "../../core/errors.js";
import type { ListJobsQuery, SubmitOfferBody } from "./offers.schema.js";
import type { OfferBounds } from "./offers.mapper.js";
import { boundingBox, distanceKm } from "../../core/geo.js";
import { messages } from "../../core/messages.js";
import { prisma } from "../../core/prisma.js";
import { skipTake } from "../../core/pagination.js";

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
export const FANOUT_RADIUS_KM = 25;
export const FANOUT_MAX_TECHNICIANS = 50;
export const MAX_OFFERS_PER_REQUEST = 5;
export const OFFER_FEE_MIN_MULTIPLIER = 0.5;
export const OFFER_FEE_MAX_MULTIPLIER = 3;

const PAST_JOBS_WHERE: Prisma.ServiceRequestWhereInput = {
  status: {
    notIn: ["PENDING", "WAITING_FOR_TECHNICIAN", "CANCELLED"],
  },
};

type PricedCategory = {
  homeVisitBasePrice: Prisma.Decimal;
  pricing: Array<{
    severity: Severity;
    minPrice: Prisma.Decimal;
    maxPrice: Prisma.Decimal;
  }>;
};

/**
 * TASK 10 - what the technician is allowed to charge, for each kind of offer.
 *
 * Two different questions with two different answers. A consultation is priced
 * off `homeVisitBasePrice`, because coming out costs about the same whatever
 * turns out to be wrong. A full fix is priced off `category_pricing`, because
 * it *is* the repair - and when the AI has already sized the problem, the band
 * for that severity is the honest range to hold them to.
 *
 * With no severity - a CONSULTATION request never asks the model, and an
 * AI_ESTIMATION the customer never paid for has no answer either - the widest
 * band the category has is the only defensible bound. The technician has looked
 * at a photo we have not classified, so we are in no position to tell them the
 * job is a MEDIUM; all we can say is that plumbing work in this country does not
 * cost 40 000 pounds.
 */
function offerBounds(
  category: PricedCategory,
  aiSeverity: Severity | null,
): OfferBounds {
  const basePrice = category.homeVisitBasePrice.toNumber();

  const consultation = {
    suggested: basePrice.toFixed(2),
    min: (basePrice * OFFER_FEE_MIN_MULTIPLIER).toFixed(2),
    max: (basePrice * OFFER_FEE_MAX_MULTIPLIER).toFixed(2),
  };

  if (category.pricing.length === 0) {
    return { consultation, fullFix: null };
  }

  const band = aiSeverity
    ? category.pricing.find((row) => row.severity === aiSeverity)
    : undefined;

  const min = band
    ? band.minPrice.toNumber()
    : Math.min(...category.pricing.map((row) => row.minPrice.toNumber()));

  const max = band
    ? band.maxPrice.toNumber()
    : Math.max(...category.pricing.map((row) => row.maxPrice.toNumber()));

  return {
    consultation,
    fullFix: {
      // The middle of the band, not its floor: a prefill at the minimum reads
      // as the expected price and quietly pushes every quote down.
      suggested: ((min + max) / 2).toFixed(2),
      min: min.toFixed(2),
      max: max.toFixed(2),
    },
  };
}

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
): Promise<bigint[]> {
  const origin = {
    lat: request.serviceLatitude.toNumber(),
    lng: request.serviceLongitude.toNumber(),
  };

  /**
   * First use the bounding box so PostgreSQL can prefilter candidates.
   * Then use the real Haversine distance in JS to remove the corners.
   */
  const box = boundingBox(origin, FANOUT_RADIUS_KM);

  const candidates = await tx.technicianProfile.findMany({
    where: {
      categoryId: request.categoryId,
      verificationStatus: "VERIFIED",
      isAvailable: true,

      user: {
        status: "ACTIVE",
        deletedAt: null,

        latitude: {
          not: null,
          gte: box.minLat,
          lte: box.maxLat,
        },

        longitude: {
          not: null,
          gte: box.minLng,
          lte: box.maxLng,
        },
      },
    },

    select: {
      userId: true,

      user: {
        select: {
          latitude: true,
          longitude: true,
        },
      },
    },
  });

  /**
   * Remove technicians without coordinates,
   * calculate the real distance,
   * keep only technicians inside the radius,
   * nearest first,
   * then take at most 50.
   */
  const nearbyTechnicians = candidates
    .map((candidate) => {
      const { latitude, longitude } = candidate.user;

      if (latitude === null || longitude === null) {
        return null;
      }

      return {
        technicianId: candidate.userId,

        distanceKm: distanceKm(origin, {
          lat: latitude.toNumber(),
          lng: longitude.toNumber(),
        }),
      };
    })
    .filter(
      (
        technician,
      ): technician is {
        technicianId: bigint;
        distanceKm: number;
      } => technician !== null,
    )
    .filter((technician) => technician.distanceKm <= FANOUT_RADIUS_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, FANOUT_MAX_TECHNICIANS);

  /**
   * Zero technicians nearby is NOT an error.
   *
   * The request stays open, but a technician who signs up later
   * will not see this already-published request because the fan-out
   * has already happened.
   *
   * Re-running fan-out later would be a separate future feature.
   */
  if (nearbyTechnicians.length === 0) {
    return [];
  }

  const technicianIds = nearbyTechnicians.map(
    (technician) => technician.technicianId,
  );

  await tx.technicianOffer.createMany({
    data: technicianIds.map((technicianId) => ({
      serviceRequestId: request.id,
      technicianId,
      status: "PENDING",
    })),

    skipDuplicates: true,
  });

  /**
   * Return user ids because publishServiceRequest needs them
   * to emit job:new to each technician.
   */
  return technicianIds;
}

/**
 * TASK 10 - the technician's feed.
 *
 *   where: { technicianId,
 *            status: query.status ?? "PENDING",
 *            serviceRequest: { status: "WAITING_FOR_TECHNICIAN" } }
 *
 * `include` the request with its category (and its `pricing` bands - the job
 * card's price range is looked up from them, the same way the customer's detail
 * screen does it), attachments and customer. The AI's answer is columns on the
 * request now, so it arrives with the row and needs no include of its own.
 * Paginated, newest first.
 *
 * That second condition is belt and braces: a cancelled request should never
 * render even if one of its offers was somehow missed by the cancel.
 */
export async function listTechnicianJobs(
  technicianId: bigint,
  query: ListJobsQuery,
) {
  const status = query.status ?? "PENDING";

  const { skip, take } = skipTake(query);

  const where: Prisma.TechnicianOfferWhereInput = {
    technicianId,
    status,

    serviceRequest: {
      status: "WAITING_FOR_TECHNICIAN",
    },
  };

  /**
   * We need the technician's coordinates once so that each
   * returned card can contain its own distanceKm.
   */
  const technician = await prisma.user.findUnique({
    where: {
      id: technicianId,
    },

    select: {
      latitude: true,
      longitude: true,
    },
  });

  const [jobs, total] = await Promise.all([
    prisma.technicianOffer.findMany({
      where,

      include: {
        serviceRequest: {
          include: {
            category: {
              include: {
                pricing: true,
              },
            },

            attachments: true,

            customer: {
              select: {
                fullName: true,
              },
            },
          },
        },
      },

      orderBy: {
        createdAt: "desc",
      },

      skip,
      take,
    }),

    prisma.technicianOffer.count({
      where,
    }),
  ]);

  const enrichedJobs = jobs.map((job) => {
    const request = job.serviceRequest;

    let jobDistanceKm = 0;

    if (
      technician?.latitude !== null &&
      technician?.latitude !== undefined &&
      technician?.longitude !== null &&
      technician?.longitude !== undefined
    ) {
      jobDistanceKm = distanceKm(
        {
          lat: technician.latitude.toNumber(),
          lng: technician.longitude.toNumber(),
        },
        {
          lat: request.serviceLatitude.toNumber(),
          lng: request.serviceLongitude.toNumber(),
        },
      );
    }

    return {
      offer: job,

      distanceKm: jobDistanceKm,

      // Both sets, every card: the technician decides which kind of offer to
      // make while looking at the job, so the app needs both inputs bounded
      // before they have picked one.
      feeBounds: offerBounds(request.category, request.aiSeverity),
    };
  });

  return {
    jobs: enrichedJobs,
    total,
  };
}

/**
 * TASK 10 - the technician names their fee. One transaction:
 *
 *  1. Read the request's category and severity for the bounds - see
 *     `offerBounds`, which answers for both kinds of offer. Outside the band
 *     for the kind that was sent -> 400 `messages.offers.feeOutOfRange` or
 *     `fixPriceOutOfRange`. A FULL_FIX on a category with no price bands is
 *     refused outright: there is nothing to bound it with.
 *  2. `updateMany({ where: { id: offerId, technicianId, status: "PENDING",
 *     serviceRequest: { status: "WAITING_FOR_TECHNICIAN" } },
 *     data: { status: "SUBMITTED", offerType, price, submittedAt: new Date() } })`
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
  const result = await prisma.$transaction(async (tx) => {
    /**
     * We need the category price to calculate the dynamic bounds.
     *
     * This is NOT used to decide whether the offer is still available.
     * The actual availability check happens in the conditional update below.
     */
    const offer = await tx.technicianOffer.findFirst({
      where: {
        id: offerId,
        technicianId,
      },

      select: {
        id: true,
        serviceRequestId: true,

        serviceRequest: {
          select: {
            customerId: true,

            // The severity the bounds narrow to, when the customer paid for
            // one. Null on a CONSULTATION, and on an estimate never bought.
            aiSeverity: true,

            category: {
              select: {
                homeVisitBasePrice: true,
                pricing: true,
              },
            },
          },
        },
      },
    });

    if (!offer) {
      throw ApiError.conflict(messages.offers.noLongerAvailable);
    }

    const bounds = offerBounds(
      offer.serviceRequest.category,
      offer.serviceRequest.aiSeverity,
    );

    /**
     * Category-dependent validation belongs in the service,
     * not in Zod - and which band applies depends on what the technician says
     * they are selling.
     */
    if (data.offerType === "FULL_FIX" && bounds.fullFix === null) {
      throw ApiError.badRequest(messages.offers.fullFixUnavailable);
    }

    const band =
      data.offerType === "FULL_FIX" ? bounds.fullFix! : bounds.consultation;

    if (data.price < Number(band.min) || data.price > Number(band.max)) {
      throw ApiError.badRequest(
        data.offerType === "FULL_FIX"
          ? messages.offers.fixPriceOutOfRange(band.min, band.max)
          : messages.offers.feeOutOfRange(band.min, band.max),
      );
    }

    /**
     * The important concurrency guard.
     *
     * All of these must still be true:
     * - this offer belongs to this technician
     * - it is still PENDING
     * - the request is still WAITING_FOR_TECHNICIAN
     *
     * If another action changed any of them, count === 0.
     */
    const updated = await tx.technicianOffer.updateMany({
      where: {
        id: offerId,
        technicianId,
        status: "PENDING",

        serviceRequest: {
          status: "WAITING_FOR_TECHNICIAN",
        },
      },

      data: {
        status: "SUBMITTED",
        offerType: data.offerType,
        price: data.price,
        submittedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      throw ApiError.conflict(messages.offers.noLongerAvailable);
    }

    /**
     * Count submitted offers after this technician successfully
     * submitted theirs.
     */
    const submittedCount = await tx.technicianOffer.count({
      where: {
        serviceRequestId: offer.serviceRequestId,
        status: "SUBMITTED",
      },
    });

    /**
     * More than the allowed number should never remain committed.
     * Throwing here rolls the whole transaction back.
     */
    if (submittedCount > MAX_OFFERS_PER_REQUEST) {
      throw ApiError.conflict(messages.offers.enoughTechnicians);
    }

    let closedTechnicianIds: bigint[] = [];

    /**
     * Exactly 5 submitted offers:
     * close all remaining PENDING invitations.
     */
    if (submittedCount === MAX_OFFERS_PER_REQUEST) {
      const pendingOffers = await tx.technicianOffer.findMany({
        where: {
          serviceRequestId: offer.serviceRequestId,
          status: "PENDING",
        },

        select: {
          technicianId: true,
        },
      });

      closedTechnicianIds = pendingOffers.map((offer) => offer.technicianId);

      await tx.technicianOffer.updateMany({
        where: {
          serviceRequestId: offer.serviceRequestId,
          status: "PENDING",
        },

        data: {
          status: "NOT_SELECTED",
        },
      });
    }

    return {
      requestId: offer.serviceRequestId,
      customerId: offer.serviceRequest.customerId,
      closedTechnicianIds,
    };
  });

  /**
   * Everything below happens AFTER the transaction commits.
   *
   * Never emit inside the transaction.
   */
  const updatedOffer = await prisma.technicianOffer.findUniqueOrThrow({
    where: {
      id: offerId,
    },

    include: {
      technician: {
        include: {
          technicianProfile: {
            include: {
              category: true,
            },
          },

          _count: {
            select: {
              requestsAsTechnician: {
                where: PAST_JOBS_WHERE,
              },
            },
          },
        },
      },
    },
  });

  /**
   * Get request coordinates for the customer-side offer mapper.
   */
  const request = await prisma.serviceRequest.findUniqueOrThrow({
    where: {
      id: result.requestId,
    },

    select: {
      serviceLatitude: true,
      serviceLongitude: true,
    },
  });

  /**
   * Get technician coordinates.
   */
  const technician = await prisma.user.findUnique({
    where: {
      id: updatedOffer.technicianId,
    },

    select: {
      latitude: true,
      longitude: true,
    },
  });

  let jobDistanceKm = 0;

  if (
    technician?.latitude !== null &&
    technician?.latitude !== undefined &&
    technician?.longitude !== null &&
    technician?.longitude !== undefined
  ) {
    jobDistanceKm = distanceKm(
      {
        lat: request.serviceLatitude.toNumber(),
        lng: request.serviceLongitude.toNumber(),
      },
      {
        lat: technician.latitude.toNumber(),
        lng: technician.longitude.toNumber(),
      },
    );
  }

  /**
   * Task 10 realtime events.
   */
  const { emitOfferNew, emitJobClosed } =
    await import("../../realtime/realtime.emit.js");

  const { toOfferForCustomerResponse } = await import("./offers.mapper.js");

  emitOfferNew(
    result.customerId,
    result.requestId,
    toOfferForCustomerResponse(updatedOffer, jobDistanceKm),
  );

  if (result.closedTechnicianIds.length > 0) {
    emitJobClosed(result.closedTechnicianIds, result.requestId, "FULL");
  }

  return updatedOffer;
}

/**
 * TASK 10 - "not interested". `PENDING` -> `DECLINED`, the same conditional
 * update shape as above.
 *
 * Nothing else changes and nothing is emitted: it hides one card, on the screen
 * that asked for it.
 */
export async function declineOffer(technicianId: bigint, offerId: bigint) {
  const { count } = await prisma.technicianOffer.updateMany({
    where: {
      id: offerId,
      technicianId,
      status: "PENDING",

      serviceRequest: {
        status: "WAITING_FOR_TECHNICIAN",
      },
    },

    data: {
      status: "DECLINED",
    },
  });

  if (count === 0) {
    throw ApiError.conflict(messages.offers.noLongerAvailable);
  }

  return prisma.technicianOffer.findUniqueOrThrow({
    where: {
      id: offerId,
    },
  });
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
 * `visitFee` is **the accepted offer's `price`**, read off the offer row inside
 * the transaction and copied onto the request. Not the category's base price,
 * and never a number from the request body - a fee the client sends is a fee
 * the client chose. It is a snapshot for the same reason the address is: that
 * technician will price their next job differently, and last month's job must
 * not move with them.
 *
 * **Copy `offerType` across as `agreedOfferType` in the same write.** The
 * number alone is ambiguous now that a technician can quote the repair: 850
 * means "he is coming for 850" or "the whole job is 850", and the customer's
 * screen has to say which. Two columns written together, or the request
 * remembers a price whose meaning it has lost.
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
