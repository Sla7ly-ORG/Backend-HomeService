import { Router } from "express";
import { ApiError } from "../../core/errors.js";
import { listTechniciansQuery, technicianIdParams, updateVerificationBody } from "./technicians.schema.js";
import { toTechnicianProfileAdminResponse } from "./technicians.mapper.js";
import { paginationMeta } from "../../core/pagination.js";
import * as techniciansService from "./technicians.service.js";

/**
 * TASK 5 - the approval queue. Mounted at /api/v1/admin/technicians.
 *
 * This is the other half of "waiting for approval": until an admin calls the
 * verification endpoint below, every technician sits in WAITING_FOR_APPROVAL.
 */
export const techniciansAdminRoutes = Router();

/** GET /api/v1/admin/technicians?verificationStatus=PENDING */
techniciansAdminRoutes.get("/", async (req, res) => {
  const query = listTechniciansQuery.parse(req.query);
  const { technicians, total } = await techniciansService.listTechnicians(query);

  res.json({
    data: technicians.map(toTechnicianProfileAdminResponse),
    meta: paginationMeta(query, total),
  });
});;

/** PATCH /api/v1/admin/technicians/:id/verification */
techniciansAdminRoutes.patch("/:id/verification", async (req, res) => {
  const { id } = technicianIdParams.parse(req.params);
  const body = updateVerificationBody.parse(req.body);
  const profile = await techniciansService.setVerificationStatus(id, body);

  res.json({ data: toTechnicianProfileAdminResponse(profile) });
});
