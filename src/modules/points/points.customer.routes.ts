import { Router } from "express";
import { ApiError } from "../../core/errors.js";

/**
 * TASK 6 - the customer's own wallet, mounted at /api/v1/customer/points.
 *
 * The balance is also on `GET /me`, because the profile screen needs it at the
 * same moment it needs everything else. These two exist for the wallet screen
 * itself and for refreshing the number after it has been spent.
 */
export const pointsCustomerRoutes = Router();

/** GET /api/v1/customer/points */
pointsCustomerRoutes.get("/", async (_req, res) => {
  // TODO(task 6): getPointsBalance(currentUser(req).id), then
  //   res.json({ data: { pointsBalance } });
  //
  // No mapper for a single integer, and no `meta` - it is not a list.
  throw ApiError.notImplemented();
});

/** GET /api/v1/customer/points/transactions - paginated history. */
pointsCustomerRoutes.get("/transactions", async (_req, res) => {
  // TODO(task 6): parse listPointsQuery, call listPointsTransactions, then
  //   res.json({ data: transactions.map(toPointsTransactionResponse),
  //              meta: paginationMeta(query, total) });
  // Copy the list handler in users.admin.routes.ts.
  throw ApiError.notImplemented();
});
