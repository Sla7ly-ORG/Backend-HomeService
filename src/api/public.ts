import { Router } from "express";
import { authPublicRoutes } from "../modules/auth/auth.public.routes.js";
import { categoriesPublicRoutes } from "../modules/categories/categories.public.routes.js";
import { uploadsPublicRoutes } from "../modules/uploads/uploads.public.routes.js";
import { requireAuth } from "../modules/auth/auth.middleware.js";

/**
 * Endpoints open to anyone, under /api/v1/public.
 *
 * Login lives here because it is how a user gets in - it cannot require
 * already being in, and neither can refreshing an expired token. The category
 * list is here because onboarding shows it before the account is finished.
 *
 * Everything else needs a token. The rest of onboarding - picking a role,
 * submitting a profile - moved to /me and the role groups once auth landed:
 * those steps act on *the caller*, and there is no way to say who that is
 * without a token.
 */
export const publicRouter = Router();

publicRouter.use("/auth", authPublicRoutes);
publicRouter.use("/categories", categoriesPublicRoutes); // task 1

// Task 4. Behind `requireAuth` despite sitting under /public: it is the one
// endpoint here that writes to disk, and letting a stranger do that is how the
// folder fills up. A technician always has a token by the time they upload
// their documents, so the guard costs them nothing. The URL stays where the
// task documents it.
//
// This is the one exception to "all access control lives in api/index.ts" -
// the group is public, a single route in it is not.
publicRouter.use("/uploads", requireAuth, uploadsPublicRoutes);
