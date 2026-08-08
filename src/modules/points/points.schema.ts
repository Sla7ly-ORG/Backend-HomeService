import { z } from "zod";
import { idParams } from "../../core/fields.js";
import { paginationQuery } from "../../core/pagination.js";

// TASK 6 - the points wallet. See docs/INTERN-TASKS.md, "Task 6".
//
// The screen calls them tokens or credits; everything on this side of the wire
// says points. Keep the word "token" for JWTs.

/** `:id` on POST /api/v1/admin/users/:id/points - whose wallet to credit. */
export const pointsUserIdParams = idParams;

/**
 * GET /api/v1/customer/points/transactions
 *
 * TODO(task 6): extend with an optional `type` filter so the history screen can
 * show just top-ups or just spends:
 *
 *   paginationQuery.extend({ type: z.enum(PointsTransactionType).optional() })
 *
 * `PointsTransactionType` comes from generated/prisma/enums.js once you have
 * added the model and run the migration. Copy listUsersQuery in
 * users.schema.ts for the shape.
 */
export const listPointsQuery = paginationQuery;

/**
 * POST /api/v1/admin/users/:id/points - support, and how you give yourself
 * points to test task 8 with before payments exist.
 *
 * TODO(task 6): { amount: int, 1..100000, required
 *                 reason?: string, trimmed, <= 255 }
 *
 * No `userId` in the body - it is the `:id` in the URL, parsed with
 * `pointsUserIdParams` above. An admin endpoint that took both would let the
 * two disagree.
 */
export const grantPointsBody = z.object({});

export type ListPointsQuery = z.infer<typeof listPointsQuery>;
export type GrantPointsBody = z.infer<typeof grantPointsBody>;
