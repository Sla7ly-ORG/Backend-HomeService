import { Router } from "express";
import { jobIdParams, listJobsQuery, submitOfferBody } from "./offers.schema.js";
import * as offersService from "./offers.service.js";
import { currentUser } from "../auth/auth.middleware.js";
import { toTechnicianJobResponse } from "./offers.mapper.js";
import { paginationMeta } from "../../core/pagination.js";

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
offersTechnicianRoutes.get("/", async (req, res) => {
  const query = listJobsQuery.parse(req.query);
  const { jobs, total } = await offersService.listTechnicianJobs(
    currentUser(req).id,
    query,
  );

  // `distanceKm` and `feeBounds` are per job - the service hands them out
  // alongside each row, the mapper does not compute anything.
  res.json({
    data: jobs.map(({ offer, distanceKm, feeBounds }) =>
      toTechnicianJobResponse(offer, distanceKm, feeBounds),
    ),
    meta: paginationMeta(query, total),
  });
});

/** POST /api/v1/technician/jobs/:id/offer - "I will do it for this much." */
offersTechnicianRoutes.post("/:id/offer", async (req, res) => {
  const { id } = jobIdParams.parse(req.params);
  const body = submitOfferBody.parse(req.body);

  // 409 when the card is stale, 400 when the fee is out of range. Both come
  // from the service; this file only parses and replies.
  const offer = await offersService.submitOffer(currentUser(req).id, id, body);

  res.json({
    data: {
      id: offer.id.toString(),
      status: offer.status,
      consultationFee: offer.consultationFee?.toFixed(2) ?? null,
      submittedAt: offer.submittedAt,
    },
  });
});

/** POST /api/v1/technician/jobs/:id/decline */
offersTechnicianRoutes.post("/:id/decline", async (req, res) => {
  const { id } = jobIdParams.parse(req.params);
  const offer = await offersService.declineOffer(currentUser(req).id, id);

  res.json({ data: { id: offer.id.toString(), status: offer.status } });
});
