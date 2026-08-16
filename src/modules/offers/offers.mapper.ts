import type { Prisma } from "../../generated/prisma/client.js";
import type {
  offerForCustomerCardInclude,
  technicianJobInclude,
} from "./offers.service.js";
import { toAiEstimationResponse } from "../requests/requests.mapper.js";

// TASKS 10 & 11. Two audiences, two shapes, two functions - the same rule as
// toTechnicianProfileResponse and toTechnicianProfileAdminResponse in
// modules/technicians/technicians.mapper.ts. Do not add a flag to one of them.
//
// Both parameter types are derived from the `include`s the service exports, the
// same way requests.mapper.ts derives its own: widen the include over there and
// this file is a type error until it handles the new relation. The imports are
// `import type` on purpose - only `typeof` needs them, and a value import would
// pull the whole service (Prisma, realtime) into a file that talks to neither.

/** The fee input's prefill and its limits, computed by the service. */
export type FeeBounds = { suggested: string; min: string; max: string };

type TechnicianJobRow = Prisma.TechnicianOfferGetPayload<{
  include: typeof technicianJobInclude;
}>;

/**
 * TASK 10 - one card in the technician's feed.
 *
 * Offer id, status and `createdAt`, then everything about the job under
 * `request`: the problem (title, description, photos, category name), the AI's
 * severity, confidence and price range - `null` on a CONSULTATION, which never
 * had an estimate - and of the customer **only** `fullName`, the city the job
 * is in, and `distanceKm`. Plus the `fee` block, so the app can build the fee
 * input without knowing our multipliers.
 *
 * **No phone. No `serviceAddress`. No exact coordinates.** Fifty technicians
 * receive this card and at most one gets the job; the other forty-nine have no
 * reason to hold a stranger's address. Task 11's mapper is the one that runs
 * after the choice has been made.
 *
 * The AI's range and the fee block are deliberately far apart in the shape, and
 * named so nobody merges them: one is a guess at the repair, the other is what
 * this technician charges to show up.
 *
 * The estimate comes from `toAiEstimationResponse`, the same function the
 * customer's own screen uses, rather than a second lookup here. That is not
 * tidiness: it reads `actualSeverity ?? aiSeverity`, so once a human has
 * corrected a prediction both sides are priced off the corrected one. Two
 * lookups meant the technician quoting from a band the customer never saw.
 *
 * This is also the payload of the `job:new` socket event, so the app renders a
 * live card and a fetched card with one piece of code.
 */
export function toTechnicianJobResponse(
  offer: TechnicianJobRow,
  distanceKm: number,
  fee: FeeBounds,
) {
  const request = offer.serviceRequest;

  return {
    id: offer.id.toString(),

    status: offer.status,

    createdAt: offer.createdAt,

    request: {
      id: request.id.toString(),
      title: request.title,
      description: request.description,
      categoryName: request.category.name,
      requestType: request.requestType,

      images: request.attachments.map((attachment) => attachment.imageUrl),

      aiEstimation: toAiEstimationResponse(request),

      customer: {
        fullName: request.customer.fullName,

        // The city the job is in, not the one on the customer's profile - the
        // request carries its own address snapshot, and that is the one a
        // technician is deciding whether to drive to.
        city: request.serviceCity,

        distanceKm: distanceKm.toFixed(2),
      },
    },

    fee,
  };
}

type OfferForCustomerRow = Prisma.TechnicianOfferGetPayload<{
  include: typeof offerForCustomerCardInclude;
}>;

/**
 * TASK 11 - one card the customer chooses from.
 *
 * `consultationFee` (2dp string), `submittedAt`, and the technician: their
 * `fullName`, `profileImage`, `overallRating`, `totalReviews`,
 * `pastOrdersCount`, category name, `city` and `distanceKm` (2dp string).
 * `distanceKm` sits inside `technician` because that is whose distance it is -
 * five cards on one screen, each measured from the same request.
 *
 * Still no phone: it appears in `toServiceRequestResponse` once the offer has
 * been accepted, which is task 7's mapper and the single place that decides it.
 *
 * This is also the payload of the `offer:new` socket event. If the two ever
 * differ, the list and the live insert draw different cards.
 */
export function toOfferForCustomerResponse(
  offer: OfferForCustomerRow,
  distanceKm: number,
) {
  const technician = offer.technician;
  const profile = technician.technicianProfile;

  return {
    id: offer.id.toString(),
    consultationFee: offer.consultationFee?.toFixed(2) ?? null,
    submittedAt: offer.submittedAt,

    technician: {
      id: technician.id.toString(),
      fullName: technician.fullName,
      profileImage: profile?.profileImage ?? null,
      overallRating: profile?.overallRating.toFixed(2) ?? "0.00",
      totalReviews: profile?.totalReviews ?? 0,
      pastOrdersCount: technician._count.requestsAsTechnician,
      categoryName: profile?.category.name ?? null,
      city: technician.city,
      distanceKm: distanceKm.toFixed(2),
    },
  };
}
