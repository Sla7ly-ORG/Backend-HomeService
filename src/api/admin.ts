import { Router } from "express";
import { adminUsersRoutes } from "../modules/users/users.admin.routes.js";
import { categoriesAdminRoutes } from "../modules/categories/categories.admin.routes.js";
import { techniciansAdminRoutes } from "../modules/technicians/technicians.admin.routes.js";
import { pointsAdminRoutes } from "../modules/points/points.admin.routes.js";
import { realtimeAdminRoutes } from "../realtime/realtime.admin.routes.js";

/**
 * Everything the back-office can do, under /api/v1/admin.
 *
 * Permissions are not checked here or in any route file - when auth arrives it
 * goes on this whole group in api/index.ts.
 */
export const adminRouter = Router();

adminRouter.use("/users", adminUsersRoutes);
// Same prefix, different file: POST /admin/users/:id/points is about a user's
// wallet, so its URL lives here and its code lives in the points module.
// Express tries the routers in order and falls through to this one.
adminRouter.use("/users", pointsAdminRoutes); // task 6
adminRouter.use("/categories", categoriesAdminRoutes); // task 1
adminRouter.use("/technicians", techniciansAdminRoutes); // task 5
adminRouter.use("/realtime", realtimeAdminRoutes); // task 9
