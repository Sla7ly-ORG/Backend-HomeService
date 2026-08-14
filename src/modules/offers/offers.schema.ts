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
 * POST /api/v1/technician/jobs/:id/offer - the technician's price, and what it
 * buys.
 *
 * `offerType` decides which: `CONSULTATION` is the old behaviour - "I will come
 * and look for this much" - and `FULL_FIX` is a technician who recognised the
 * problem from the photo quoting the whole repair, so the customer is not asked
 * to pay a second time when the visit is over.
 *
 * The bounds that actually matter are **not** here, and now there are two sets
 * of them: a consultation is half to three times the category's
 * `homeVisitBasePrice`, a full fix is bounded by the `category_pricing` band.
 * Both depend on rows a schema cannot see. Shape is validated here; the range is
 * validated in the service, against the type that came with it.
 */
const price = z.coerce
  .number()
  .positive()
  .max(99_999_999.99)
  .refine((n) => Number(n.toFixed(2)) === n, {
    message: messages.fields.feeDecimals,
  });

export const submitOfferBody = z.object({
  offerType: z.enum(["CONSULTATION", "FULL_FIX"]),
  price,
});

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
