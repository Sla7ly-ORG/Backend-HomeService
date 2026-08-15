import type { Prisma, ServiceRequest } from "../../generated/prisma/client.js";
import { ApiError } from "../../core/errors.js";
import type { ListJobsQuery, SubmitOfferBody } from "./offers.schema.js";
import { boundingBox, distanceKm } from "../../core/geo.js";
import { messages } from "../../core/messages.js";
import { prisma } from "../../core/prisma.js";
import { skipTake } from "../../core/pagination.js";
import { emitJobClosed, emitJobSelected, emitRequestUpdated } from "../../realtime/realtime.emit.js";

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
export const offerForCustomerCardInclude = {
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
} satisfies Prisma.TechnicianOfferInclude;

export const technicianJobInclude = {
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
} satisfies Prisma.TechnicianOfferInclude;

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

      include: technicianJobInclude,

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

    const basePrice = request.category.homeVisitBasePrice.toNumber();

    const minFee = basePrice * OFFER_FEE_MIN_MULTIPLIER;

    const maxFee = basePrice * OFFER_FEE_MAX_MULTIPLIER;

    return {
      offer: job,

      distanceKm: jobDistanceKm,

      feeBounds: {
        suggested: basePrice.toFixed(2),
        min: minFee.toFixed(2),
        max: maxFee.toFixed(2),
      },
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
  const result = await prisma.$transaction(async (tx) => {
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

            category: {
              select: {
                homeVisitBasePrice: true,
              },
            },
          },
        },
      },
    });

    if (!offer) {
      throw ApiError.conflict(messages.offers.noLongerAvailable);
    }

    const basePrice =
      offer.serviceRequest.category.homeVisitBasePrice.toNumber();

    const minFee = basePrice * OFFER_FEE_MIN_MULTIPLIER;

    const maxFee = basePrice * OFFER_FEE_MAX_MULTIPLIER;

    if (data.consultationFee < minFee || data.consultationFee > maxFee) {
      throw ApiError.badRequest(
        messages.offers.feeOutOfRange(minFee.toFixed(2), maxFee.toFixed(2)),
      );
    }

    /**
     * Lock the request row so concurrent technicians submitting
     * offers for the same request are serialized.
     */
    await tx.$queryRaw`
      SELECT id
      FROM service_requests
      WHERE id = ${offer.serviceRequestId}
        AND status = 'WAITING_FOR_TECHNICIAN'::"RequestStatus"
      FOR UPDATE
    `;

    /**
     * Count submitted offers while the request row is locked.
     */
    const submittedCount = await tx.technicianOffer.count({
      where: {
        serviceRequestId: offer.serviceRequestId,
        status: "SUBMITTED",
      },
    });

    /**
     * Five offers already exist.
     */
    if (submittedCount >= MAX_OFFERS_PER_REQUEST) {
      throw ApiError.conflict(messages.offers.enoughTechnicians);
    }

    /**
     * PENDING -> SUBMITTED
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
        consultationFee: data.consultationFee,
        submittedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      throw ApiError.conflict(messages.offers.noLongerAvailable);
    }

    /**
     * The current technician is now the next submitted offer.
     */
    const newSubmittedCount = submittedCount + 1;

    let closedTechnicianIds: bigint[] = [];

    /**
     * Exactly five submitted offers:
     * close all remaining PENDING invitations.
     */
    if (newSubmittedCount === MAX_OFFERS_PER_REQUEST) {
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
   */
  const updatedOffer = await prisma.technicianOffer.findUniqueOrThrow({
    where: {
      id: offerId,
    },

    include: offerForCustomerCardInclude,
  });

  const request = await prisma.serviceRequest.findUniqueOrThrow({
    where: {
      id: result.requestId,
    },

    select: {
      serviceLatitude: true,
      serviceLongitude: true,
    },
  });

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
  const request = await prisma.serviceRequest.findFirst({
    where: {
      id: requestId,
      customerId,
    },

    select: {
      serviceLatitude: true,
      serviceLongitude: true,
    },
  });

  if (!request) {
    throw ApiError.notFound(messages.requests.notFound);
  }

  const origin = {
    lat: request.serviceLatitude.toNumber(),
    lng: request.serviceLongitude.toNumber(),
  };

  const offers = await prisma.technicianOffer.findMany({
    where: {
      serviceRequestId: requestId,
      status: "SUBMITTED",
    },

    include: offerForCustomerCardInclude,
  });

  return offers
    .map((offer) => {
      const { latitude, longitude } = offer.technician;

      const offerDistanceKm =
        latitude !== null && longitude !== null
          ? distanceKm(origin, {
              lat: latitude.toNumber(),
              lng: longitude.toNumber(),
            })
          : 0;

      return { offer, distanceKm: offerDistanceKm };
    })
    .sort((a, b) => {
      if (a.distanceKm !== b.distanceKm) {
        return a.distanceKm - b.distanceKm;
      }

      const ratingA =
        a.offer.technician.technicianProfile?.overallRating.toNumber() ?? 0;
      const ratingB =
        b.offer.technician.technicianProfile?.overallRating.toNumber() ?? 0;

      return ratingB - ratingA;
    });
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
  const result = await prisma.$transaction(async (tx) => {
    /**
     * Read the offer inside the transaction.
     *
     * We need the technician id and the consultation fee because:
     * - technicianId is copied to the request
     * - consultationFee becomes the request's visitFee
     *
     * The fee MUST come from the database, never from the request body.
     */
    const offer = await tx.technicianOffer.findFirst({
      where: {
        id: offerId,
        serviceRequestId: requestId,
        status: "SUBMITTED",
      },
      select: {
        technicianId: true,
        consultationFee: true,
      },
    });

    if (!offer) {
       throw ApiError.conflict(messages.offers.notSubmitted);
    }

    /**
     * Read the request coordinates so we can snapshot the distance
     * onto the request.
     */
    const request = await tx.serviceRequest.findFirst({
      where: {
        id: requestId,
        customerId,
      },
      select: {
        serviceLatitude: true,
        serviceLongitude: true,
      },
    });

    if (!request) {
      throw ApiError.notFound(messages.requests.notFound);
    }

    /**
     * Technician location is needed only to calculate the distance
     * that gets stored on the request.
     */
    const technician = await tx.user.findUnique({
      where: {
        id: offer.technicianId,
      },
      select: {
        latitude: true,
        longitude: true,
      },
    });

    const acceptedDistanceKm =
      technician?.latitude != null &&
      technician?.longitude != null
        ? distanceKm(
            {
              lat: request.serviceLatitude.toNumber(),
              lng: request.serviceLongitude.toNumber(),
            },
            {
              lat: technician.latitude.toNumber(),
              lng: technician.longitude.toNumber(),
            },
          )
        : 0;

    /**
     * The request is the lock.
     *
     * Only one customer action can change:
     * WAITING_FOR_TECHNICIAN + technicianId null
     *
     * into:
     * TECHNICIAN_SELECTED + technicianId set.
     *
     * If another accept already won, count === 0.
     */
    const { count: assignedCount } =
      await tx.serviceRequest.updateMany({
        where: {
          id: requestId,
          customerId,
          status: "WAITING_FOR_TECHNICIAN",
          technicianId: null,
        },
        data: {
          technicianId: offer.technicianId,
          status: "TECHNICIAN_SELECTED",
          visitFee: offer.consultationFee,
          distanceKm: acceptedDistanceKm,
        },
      });

    if (assignedCount === 0) {
      throw ApiError.conflict(messages.offers.alreadyAssigned);
    }

    /**
     * Now close the selected offer.
     *
     * It must still be SUBMITTED.
     */
    const { count: selectedCount } =
      await tx.technicianOffer.updateMany({
        where: {
          id: offerId,
          serviceRequestId: requestId,
          technicianId: offer.technicianId,
          status: "SUBMITTED",
        },
        data: {
          status: "SELECTED",
        },
      });

    if (selectedCount === 0) {
      throw ApiError.conflict(messages.offers.notSubmitted);
    }

    /**
     * Collect the other technicians before closing their offers.
     *
     * PENDING = still waiting in technician feed
     * SUBMITTED = technician already sent a fee
     *
     * Both disappear after somebody is selected.
     */
    const losingOffers = await tx.technicianOffer.findMany({
      where: {
        serviceRequestId: requestId,
        id: { not: offerId },
        status: {
          in: ["PENDING", "SUBMITTED"],
        },
      },
      select: {
        technicianId: true,
      },
    });

    await tx.technicianOffer.updateMany({
      where: {
        serviceRequestId: requestId,
        id: { not: offerId },
        status: {
          in: ["PENDING", "SUBMITTED"],
        },
      },
      data: {
        status: "NOT_SELECTED",
      },
    });

    return {
      winnerTechnicianId: offer.technicianId,
      loserTechnicianIds: losingOffers.map(
        (losingOffer) => losingOffer.technicianId,
      ),
    };
  });

  /**
   * Emit ONLY after the transaction commits.
   *
   * If the transaction rolls back, nobody should receive
   * events describing a selection that never happened.
   */
  emitJobSelected(
    result.winnerTechnicianId,
    requestId,
    offerId,
  );

  if (result.loserTechnicianIds.length > 0) {
    emitJobClosed(
      result.loserTechnicianIds,
      requestId,
      "TAKEN",
    );
  }

  emitRequestUpdated(
    customerId,
    requestId,
    "TECHNICIAN_SELECTED",
  );
}
