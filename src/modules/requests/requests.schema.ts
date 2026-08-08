import { z } from "zod";
import { idField, idParams } from "../../core/fields.js";
import { paginationQuery } from "../../core/pagination.js";

// TASKS 7, 8, 10 & 11 - service requests. See docs/INTERN-TASKS.md and, for the
// screens these serve, docs/APP-FLOW.md.

/** `:id` on every /api/v1/customer/requests/:id route. */
export const requestIdParams = idParams;

/** `/:id/offers/:offerId` - task 11, the customer accepting one. */
export const requestOfferParams = z.object({
  id: idField,
  offerId: idField,
});

/**
 * POST /api/v1/customer/requests - the draft, behind both "describe it with AI"
 * and "order a consultation".
 *
 * TODO(task 7):
 *   title        3..120,   trimmed
 *   description  10..2000, trimmed
 *   categoryId   idField
 *   requestType  z.enum(RequestType) - AI_ESTIMATION | CONSULTATION, after the
 *                rename in this task's migration
 *   images       array of the URL strings POST /public/uploads gave back,
 *                **1..5 for both types**. The AI has nothing to look at without
 *                one, and a technician pricing a visit blind will either
 *                overcharge or refuse. Reuse the `uploadedFileUrl` idea from
 *                technicians.schema.ts - same 255-character column.
 *   serviceAddress / serviceCity / latitude / longitude, all optional: the
 *                address defaults to the customer's own profile, and these are
 *                only sent when the job is somewhere else.
 *
 * No `customerId`. It is the caller, and the route reads that from the token.
 */
export const createServiceRequestBody = z.object({});

/**
 * GET /api/v1/customer/requests - the past-orders screen.
 *
 * TODO(task 7): extend with an optional `status` filter
 * (`z.enum(RequestStatus).optional()`).
 *
 * With no status the service hides drafts - see `listCustomerRequests`.
 */
export const listMyRequestsQuery = paginationQuery;

export type CreateServiceRequestBody = z.infer<typeof createServiceRequestBody>;
export type ListMyRequestsQuery = z.infer<typeof listMyRequestsQuery>;
