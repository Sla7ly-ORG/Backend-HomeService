import { Router } from "express";
import * as pointsService from "./points.service.js";
import { currentUser } from "../auth/auth.middleware.js";
import { listPointsQuery } from "./points.schema.js";
import { toPointsTransactionResponse } from "./points.mapper.js";
import { paginationMeta } from "../../core/pagination.js";

/**
 * TASK 6 - the customer's own wallet, mounted at /api/v1/customer/points.
 *
 * The balance is also on `GET /me`, because the profile screen needs it at the
 * same moment it needs everything else. These two exist for the wallet screen
 * itself and for refreshing the number after it has been spent.
 */
export const pointsCustomerRoutes = Router();

/** GET /api/v1/customer/points */
pointsCustomerRoutes.get("/", async (req, res) => {
  const pointsBalance = await pointsService.getPointsBalance(
    currentUser(req).id,
  );

  res.json({ data: { pointsBalance } });
});

/** GET /api/v1/customer/points/transactions - paginated history. */
pointsCustomerRoutes.get("/transactions", async (req, res) => {
  const query = listPointsQuery.parse(req.query);
  const { transactions, total } = await pointsService.listPointsTransactions(
    currentUser(req).id,
    query,
  );

  res.json({
    data: transactions.map(toPointsTransactionResponse),
    meta: paginationMeta(query, total),
  });
});
