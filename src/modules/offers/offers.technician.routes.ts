import { Router } from "express";
import { ApiError } from "../../core/errors.js";

/**
 * TASK 10 - the technician's home screen, mounted at /api/v1/technician/jobs.
 *
 * "Jobs" here, "offers" in the database: the row is an invitation until a fee
 * lands on it, and the technician's screen calls the whole thing a job. The
 * `:id` in these URLs is the **offer** id - it is what the card carries, and it
 * is the row a conditional update can lock on.
 *
 * The feed fills up live over the socket (task 9), but every card in it is also
 * one row of `GET /`. The socket is a speed-up; this endpoint is the truth, and
 * the app re-reads it on every reconnect.
 */
export const offersTechnicianRoutes = Router();

/** GET /api/v1/technician/jobs?status=PENDING */
offersTechnicianRoutes.get("/", async (_req, res) => {
  // TODO(task 10): parse listJobsQuery, call listTechnicianJobs, then
  //   res.json({ data: jobs.map(...toTechnicianJobResponse),
  //              meta: paginationMeta(query, total) });
  //
  // `distanceKm` and the fee bounds are per job, so the service has to hand
  // them out alongside each row - the mapper does not compute anything.
  throw ApiError.notImplemented();
});

/** POST /api/v1/technician/jobs/:id/offer - "I will do it for this much." */
offersTechnicianRoutes.post("/:id/offer", async (_req, res) => {
  // TODO(task 10): parse jobIdParams + submitOfferBody, call submitOffer,
  // reply 200 with the updated offer.
  //
  // 409 when the card is stale, 400 when the fee is out of range. Both come
  // from the service; this file only parses and replies.
  throw ApiError.notImplemented();
});

/** POST /api/v1/technician/jobs/:id/decline */
offersTechnicianRoutes.post("/:id/decline", async (_req, res) => {
  // TODO(task 10): declineOffer -> 200 with the updated offer.
  throw ApiError.notImplemented();
});
