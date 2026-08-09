import { Router } from "express";
import { grantPointsBody, pointsUserIdParams } from "./points.schema.js";
import { prisma } from "../../core/prisma.js";
import * as pointsService from "./points.service.js";

/**
 * TASK 6 - granting points, mounted at /api/v1/admin/users.
 *
 * Same prefix as users.admin.routes.ts, different file: the URL belongs to a
 * user, the behaviour belongs to the wallet. Both routers are mounted on
 * "/users" in api/admin.ts and Express tries them in order.
 *
 * Until Paymob exists (see "Recharging" in the task description) this is the
 * only way points enter the system, and it is how you get a balance to test
 * task 8 with.
 */
export const pointsAdminRoutes = Router();

/** POST /api/v1/admin/users/:id/points */
pointsAdminRoutes.post("/:id/points", async (req, res) => {
  const { id } = pointsUserIdParams.parse(req.params);
  const { amount, reason } = grantPointsBody.parse(req.body);

  const pointsBalance = await prisma.$transaction((tx) =>
    pointsService.creditPoints(tx, id, amount, {
      type: "ADMIN_GRANT",
      reason,
    }),
  );

  res.status(201).json({ data: { pointsBalance } });
});
