import { Router } from "express";
import { ApiError } from "../../core/errors.js";

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
pointsAdminRoutes.post("/:id/points", async (_req, res) => {
  // TODO(task 6): parse pointsUserIdParams + grantPointsBody, then run
  // creditPoints in a `prisma.$transaction` with type "ADMIN_GRANT" and reply
  // 201 with the new balance:
  //
  //   res.status(201).json({ data: { pointsBalance } });
  //
  // creditPoints takes a transaction client, so it needs one even when it is
  // the only write in it. That is deliberate: the signature is what stops
  // somebody calling it outside a transaction later, when it is not.
  throw ApiError.notImplemented();
});
