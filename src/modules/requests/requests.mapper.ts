import type { AiEstimation } from "../../generated/prisma/client.js";
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

    aiEstimation: request.aiEstimation
      ? toAiEstimationResponse(request.aiEstimation)
      : null,

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
 * `minPrice` / `maxPrice` / `confidence` as strings. The prices are money and
 * the confidence is a Decimal; neither survives being turned into a float.
 *
 * Written in task 7 because `toServiceRequestResponse` nests it and the seed
 * already creates estimation rows - without it every seeded AI request would
 * answer `501` on the detail screen. Task 8 adds `summary` to the model, and
 * this is where it goes: the sentence the customer actually reads, already
 * written in Arabic, passed through untouched.
 */
export function toAiEstimationResponse(estimation: AiEstimation) {
  return {
    id: estimation.id.toString(),
    severity: estimation.severity,
    // TODO(task 8): `summary` - added to the model by that task's migration.
    minPrice: estimation.minPrice.toFixed(2),
    maxPrice: estimation.maxPrice.toFixed(2),
    confidence: estimation.confidence.toFixed(2),
    createdAt: estimation.createdAt,
  };
}

export type ServiceRequestResponse = ReturnType<
  typeof toServiceRequestResponse
>;
export type ServiceRequestListItem = ReturnType<
  typeof toServiceRequestListItem
>;
