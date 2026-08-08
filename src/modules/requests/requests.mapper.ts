import type {
  AiEstimation,
  ServiceRequest,
} from "../../generated/prisma/client.js";
import { ApiError } from "../../core/errors.js";

// TASKS 7 & 8. Reference: src/modules/users/users.mapper.ts.
//
// The parameter types below are the bare rows. Your service `include`s
// attachments, the category, the technician, the estimation and `_count`, so
// widen them as you go - a `ServiceRequest & { category: Category; ... }`, or
// Prisma's `GetPayload` helper if you prefer. The rows are typed here only so
// the file compiles before any of that exists.

/**
 * TASK 7 - the customer's own view of one request: the detail screen, and what
 * comes back from create, publish, cancel and accept.
 *
 * Ids as strings. `visitFee` and `distanceKm` as strings or null - money and
 * measurements never become floats. Attachments as a plain array of urls.
 * `aiEstimation` nested through the mapper below, or null.
 *
 * **The assigned technician's `phone` belongs here, and only once `status` is
 * `TECHNICIAN_SELECTED` or past it.** That is the moment the two of them are
 * supposed to talk, and this function is the single place in the codebase that
 * decides it - fifty technicians saw this job and the other forty-nine never
 * get a number.
 */
export function toServiceRequestResponse(request: ServiceRequest) {
  // TODO(task 7)
  throw ApiError.notImplemented();
}

/**
 * TASK 7 - one row of the past-orders list: id, title, category name, status,
 * requestType, createdAt, visitFee, technician name, and `offersCount` from
 * `_count`.
 *
 * Deliberately smaller than the response above. A list of twenty does not need
 * twenty sets of attachments, and the row only renders one line of each.
 */
export function toServiceRequestListItem(request: ServiceRequest) {
  // TODO(task 7)
  throw ApiError.notImplemented();
}

/**
 * TASK 8 - the AI's answer, as the estimate screen shows it.
 *
 * `severity`, `summary`, then `minPrice` / `maxPrice` / `confidence` as
 * strings. The prices are money and the confidence is a Decimal; neither
 * survives being turned into a float.
 *
 * `summary` is the sentence the customer actually reads and it arrives already
 * written in Arabic - pass it through untouched.
 */
export function toAiEstimationResponse(estimation: AiEstimation) {
  // TODO(task 8): `summary` is added to the model by this task's migration.
  throw ApiError.notImplemented();
}
