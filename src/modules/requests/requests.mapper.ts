import type { RequestStatus } from "../../generated/prisma/enums.js";
import type {
  ServiceRequestDetail,
  ServiceRequestListRow,
} from "./requests.service.js";

// TASKS 7 & 8. Reference: src/modules/users/users.mapper.ts.
//
// The parameter types come from the `include`s the service exports, so adding a
// relation over there is a type error here until this file handles it.

/**
 * The statuses at which the customer and the technician are meant to talk.
 *
 * `CANCELLED` is deliberately absent even though a cancelled job may well have
 * had a technician on it: the moment the job is off, the reason for handing out
 * a phone number is off with it.
 */
const CONTACT_VISIBLE_STATUSES: RequestStatus[] = [
  "TECHNICIAN_SELECTED",
  "ON_THE_WAY",
  "ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
];

/**
 * TASK 7 - the customer's own view of one request: the detail screen, and what
 * comes back from create, publish, cancel and accept.
 *
 * Ids as strings. `visitFee` and `distanceKm` as strings or null - money and
 * measurements never become floats. `toFixed(2)` rather than `toString()`, to
 * match both the `Decimal(10, 2)` columns and `toCategoryResponse`: a fee of
 * 200 has to read `"200.00"`, not `"200"`, or the app formats two prices two
 * different ways on the same screen. The coordinates are the exception and stay
 * numbers, the way they are on `User` - they are read as a map pin, not as an
 * amount.
 *
 * **The assigned technician's `phone` is here, and only once `status` is
 * `TECHNICIAN_SELECTED` or past it.** That is the moment the two of them are
 * supposed to talk, and this function is the single place in the codebase that
 * decides it - fifty technicians saw this job and the other forty-nine never
 * get a number.
 */
export function toServiceRequestResponse(request: ServiceRequestDetail) {
  const contactVisible = CONTACT_VISIBLE_STATUSES.includes(request.status);

  return {
    id: request.id.toString(),
    customerId: request.customerId.toString(),
    categoryId: request.categoryId.toString(),
    categoryName: request.category.name,
    requestType: request.requestType,
    title: request.title,
    description: request.description,
    status: request.status,

    // The address as it was when the job was filed, not a join onto the
    // customer's profile - see `createServiceRequest`.
    serviceAddress: request.serviceAddress,
    serviceCity: request.serviceCity,
    serviceLatitude: request.serviceLatitude.toNumber(),
    serviceLongitude: request.serviceLongitude.toNumber(),

    distanceKm: request.distanceKm?.toFixed(2) ?? null,
    visitFee: request.visitFee?.toFixed(2) ?? null,

    images: request.attachments.map((attachment) => attachment.imageUrl),

    aiEstimation: toAiEstimationResponse(request),

    technician: request.technician
      ? {
          id: request.technician.id.toString(),
          fullName: request.technician.fullName,
          phone: contactVisible ? request.technician.phone : null,
        }
      : null,

    offersCount: request._count.offers,

    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

/**
 * TASK 7 - one row of the past-orders list.
 *
 * Deliberately smaller than the response above. A list of twenty does not need
 * twenty sets of attachments, and the row only renders one line of each.
 */
export function toServiceRequestListItem(request: ServiceRequestListRow) {
  return {
    id: request.id.toString(),
    title: request.title,
    categoryName: request.category.name,
    status: request.status,
    requestType: request.requestType,
    visitFee: request.visitFee?.toFixed(2) ?? null,
    technicianName: request.technician?.fullName ?? null,
    offersCount: request._count.offers,
    createdAt: request.createdAt,
  };
}

/**
 * TASK 8 - the AI's answer, as the estimate screen shows it.
 *
 * Assembled from the request's own `ai_*` columns; there is no `ai_estimations`
 * row to read any more. `null` when the model has not answered - a
 * `CONSULTATION`, or an `AI_ESTIMATION` the customer has not paid for yet - and
 * the screen shows the photo and description alone.
 *
 * **The severity shown is `actualSeverity ?? aiSeverity`.** Once a human has
 * corrected a prediction, the customer sees the corrected one and is priced off
 * it; the raw `aiSeverity` stays in the row for whoever retrains the model, and
 * is not what anybody is quoted from.
 *
 * The price range is looked up from the category's bands, not stored: the model
 * returns a severity and no money, and `category_pricing` is the one place that
 * knows what a severity costs. A category missing the band is `null` prices
 * rather than a throw - a seeding gap should not take down a detail screen that
 * renders fine without a number.
 *
 * `minPrice` / `maxPrice` / `confidence` as strings: money is a Decimal and the
 * confidence is one too, and neither survives being turned into a float.
 * `confidence` is the service's own 0..1, printed to four places, *not* a
 * percentage - the old column stored 0-100 and the app has to be told once.
 *
 * `needsReview` and the raw `aiSeverity` are deliberately not here. Whether the
 * model doubted itself is for the review queue, not for the customer reading
 * the estimate they just bought.
 */
export function toAiEstimationResponse(
  request: Pick<
    ServiceRequestDetail,
    "aiSeverity" | "actualSeverity" | "aiConfidence" | "category"
  >,
) {
  if (request.aiSeverity === null) return null;

  const severity = request.actualSeverity ?? request.aiSeverity;
  const band = request.category.pricing.find(
    (row) => row.severity === severity,
  );

  return {
    severity,
    minPrice: band?.minPrice.toFixed(2) ?? null,
    maxPrice: band?.maxPrice.toFixed(2) ?? null,
    confidence: request.aiConfidence?.toFixed(4) ?? null,
  };
}

export type ServiceRequestResponse = ReturnType<
  typeof toServiceRequestResponse
>;
export type ServiceRequestListItem = ReturnType<
  typeof toServiceRequestListItem
>;
