import { z } from "zod";
import { idParams } from "../../core/fields.js";
import { paginationQuery } from "../../core/pagination.js";
import { messages } from "../../core/messages.js";

// TASKS 10 & 11 - offers. One row per (request, technician).
//
// A row starts life as an *invitation*: the fan-out creates it PENDING, with no
// fee on it. It becomes an offer when the technician submits one.

/** `:id` on /api/v1/technician/jobs/:id - the **offer** id, not the request. */
export const jobIdParams = idParams;

/**
 * POST /api/v1/technician/jobs/:id/offer - the technician's price for coming
 * out.
 *
 * TODO(task 10): { consultationFee: positive, at most 2 decimal places, capped
 * at 99999999.99 to match the Decimal(10, 2) column - copy the price rules from
 * categories.schema.ts. }
 *
 * The bounds that actually matter - half to three times the category's
 * `homeVisitBasePrice` - are **not** here. They depend on the category, which
 * depends on which offer row this is, and a schema cannot see the database.
 * Shape is validated here; the range is validated in the service.
 */
const consultationFee = z.coerce
  .number()
  .positive()
  .max(99_999_999.99)
  .refine((n) => Number(n.toFixed(2)) === n, {
    message: messages.fields.feeDecimals,
  });
export const submitOfferBody = z.object({ consultationFee });

/**
 * GET /api/v1/technician/jobs - the feed.
 *
 * TODO(task 10): extend with an optional `status` filter, narrowed to
 * PENDING | SUBMITTED | DECLINED. Default PENDING - the new ones.
 *
 * Not SELECTED or NOT_SELECTED: those are the customer's side of the story and
 * there is no screen for them.
 */
export const listJobsQuery = paginationQuery.extend({
  status: z.enum(["PENDING", "SUBMITTED", "DECLINED"]).optional(),
});

export type SubmitOfferBody = z.infer<typeof submitOfferBody>;
export type ListJobsQuery = z.infer<typeof listJobsQuery>;
