import { z } from "zod";
import { idField, idParams } from "../../core/fields.js";
import { paginationQuery } from "../../core/pagination.js";
import { RequestStatus, RequestType } from "../../generated/prisma/enums.js";

// TASKS 7, 8, 10 & 11 - service requests. See docs/INTERN-TASKS.md and, for the
// screens these serve, docs/APP-FLOW.md.

/** `:id` on every /api/v1/customer/requests/:id route. */
export const requestIdParams = idParams;

/** `/:id/offers/:offerId` - task 11, the customer accepting one. */
export const requestOfferParams = z.object({
  id: idField,
  offerId: idField,
});

/** The URL POST /public/uploads gave back. Same 255-character column as the
 * technician's documents, so the same rule - see technicians.schema.ts. */
const uploadedFileUrl = z.string().trim().min(1).max(255);

/**
 * Where the job is. All four are optional: the address defaults to the
 * customer's own profile, and these are only sent when the job is somewhere
 * else - a flat they rent out, a parent's house.
 *
 * The bounds match `latitude`/`longitude` in users.schema.ts, and `serviceCity`
 * matches the 100-character column the way `city` does there.
 */
const addressOverride = {
  serviceAddress: z.string().trim().min(1).optional(),
  serviceCity: z.string().trim().min(1).max(100).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
};

/**
 * POST /api/v1/customer/requests - the draft, behind both "describe it with AI"
 * and "order a consultation".
 *
 * No `customerId`. It is the caller, and the route reads that from the token.
 */
export const createServiceRequestBody = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(2000),
  categoryId: idField,
  requestType: z.enum(RequestType),
  // Required for both types, not just the AI one: the AI has nothing to look
  // at without a photo, and a technician pricing a visit blind will either
  // overcharge or refuse.
  images: z.array(uploadedFileUrl).min(1).max(5),
  ...addressOverride,
});

/**
 * GET /api/v1/customer/requests - the past-orders screen.
 *
 * With no status the service hides drafts - see `listCustomerRequests`.
 */
export const listMyRequestsQuery = paginationQuery.extend({
  status: z.enum(RequestStatus).optional(),
});

export type CreateServiceRequestBody = z.infer<typeof createServiceRequestBody>;
export type ListMyRequestsQuery = z.infer<typeof listMyRequestsQuery>;
