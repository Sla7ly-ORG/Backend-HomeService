import { Router } from "express";
import { usersCustomerRoutes } from "../modules/users/users.customer.routes.js";
import { pointsCustomerRoutes } from "../modules/points/points.customer.routes.js";
import { requestsCustomerRoutes } from "../modules/requests/requests.customer.routes.js";

/**
 * Customer-facing endpoints, under /api/v1/customer.
 */
export const customerRouter = Router();

// POST /api/v1/customer/profile - the customer half of "create my profile".
// Its twin is POST /api/v1/technician/profile in api/technician.ts.
customerRouter.use("/profile", usersCustomerRoutes); // task 2

// The wallet: the balance on the profile screen, and its history.
customerRouter.use("/points", pointsCustomerRoutes); // task 6

// Service requests - the draft, the AI estimate, publishing, the offers that
// come back, and past orders. Tasks 7, 8, 10 and 11 all land in this one file.
customerRouter.use("/requests", requestsCustomerRoutes);
