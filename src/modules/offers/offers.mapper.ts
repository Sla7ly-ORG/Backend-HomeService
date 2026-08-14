import type { TechnicianOffer } from "../../generated/prisma/client.js";
import { ApiError } from "../../core/errors.js";

// TASKS 10 & 11. Two audiences, two shapes, two functions - the same rule as
// toTechnicianProfileResponse and toTechnicianProfileAdminResponse in
// modules/technicians/technicians.mapper.ts. Do not add a flag to one of them.
//
// `TechnicianOffer` here is the bare row; your service `include`s the request,
// its category, its attachments, the estimation and the technician's profile.
// Widen the parameter types as you write them.

/** One fee input's prefill and its limits, computed by the service. */
export type Bounds = { suggested: string; min: string; max: string };

/**
 * Both kinds of offer, bounded. The technician picks which one they are making
 * while looking at the card, so the card carries the limits for both.
 *
 * `fullFix` is null when the category has no `category_pricing` rows - there is
 * nothing to bound a repair price with, and the app should hide that option
 * rather than send a number the service will refuse.
 */
export type OfferBounds = {
  consultation: Bounds;
  fullFix: Bounds | null;
};

/**
 * TASK 10 - one card in the technician's feed.
 *
 * Offer id and status, the problem (title, description, photos, category name),
 * the AI's severity, summary and price range - `null` on a CONSULTATION, which
 * never had an estimate - and of the customer **only** `fullName`,
 * `serviceCity` and `distanceKm`. Plus the `fee` block - both kinds, bounded -
 * so the app can build either fee input without knowing our multipliers, and
 * hide the full-fix one when `fee.fullFix` is null.
 *
 * **No phone. No `serviceAddress`. No exact coordinates.** Fifty technicians
 * receive this card and at most one gets the job; the other forty-nine have no
 * reason to hold a stranger's address. Task 11's mapper is the one that runs
 * after the choice has been made.
 *
 * Keep the AI's range and the fee block visibly apart in the shape, and name
 * them so nobody merges them: one is a guess at the repair, the other is what
 * this technician charges to show up.
 *
 * This is also the payload of the `job:new` socket event, so the app renders a
 * live card and a fetched card with one piece of code.
 */
type TechnicianJobOffer = TechnicianOffer & {
  serviceRequest: {
    id: bigint;
    title: string;
    description: string;
    requestType: string;
    serviceCity: string;
    aiSeverity: string | null;

    category: {
      name: string;
      pricing: Array<{
        severity: string;
        minPrice: any;
        maxPrice: any;
      }>;
    };

    attachments: Array<{
      imageUrl: string;
    }>;

    customer: {
      fullName: string | null;
    };
  };
};

/**
 * TASK 10 - one card in the technician's feed.
 */
export function toTechnicianJobResponse(
  offer: TechnicianJobOffer,
  distanceKm: number,
  fee: OfferBounds,
) {
  const request = offer.serviceRequest;

  const aiPricing = request.aiSeverity
    ? request.category.pricing.find(
        (pricing) => pricing.severity === request.aiSeverity,
      )
    : undefined;

  return {
    id: offer.id.toString(),

    status: offer.status,

    request: {
      id: request.id.toString(),
      title: request.title,
      description: request.description,
      categoryName: request.category.name,
      requestType: request.requestType,

      images: request.attachments.map((attachment) => attachment.imageUrl),
    },

    aiEstimation: request.aiSeverity
      ? {
          severity: request.aiSeverity,

          minPrice: aiPricing ? aiPricing.minPrice.toFixed(2) : null,

          maxPrice: aiPricing ? aiPricing.maxPrice.toFixed(2) : null,
        }
      : null,

    customer: {
      fullName: request.customer.fullName,
      serviceCity: request.serviceCity,
    },

    distanceKm: distanceKm.toFixed(2),

    fee,
  };
}

/**
 * TASK 11 - one card the customer chooses from.
 *
 * `offerType`, `price` (2dp string), `submittedAt`, and the technician's
 * `fullName`, `profileImage`, `overallRating`, `totalReviews`,
 * `pastOrdersCount`, category name, `city` and `distanceKm` (2dp string).
 *
 * Still no phone: it appears in `toServiceRequestResponse` once the offer has
 * been accepted, which is task 7's mapper and the single place that decides it.
 *
 * This is also the payload of the `offer:new` socket event. If the two ever
 * differ, the list and the live insert draw different cards.
 */
export function toOfferForCustomerResponse(
  offer: TechnicianOffer,
  distanceKm: number,
) {
  // TODO(task 11)
  throw ApiError.notImplemented();
}
