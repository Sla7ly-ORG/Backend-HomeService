import type { Prisma } from "../../generated/prisma/client.js";
import { ApiError } from "../../core/errors.js";
import type { ListPointsQuery } from "./points.schema.js";

/**
 * TASK 6 - all database access for the wallet.
 *
 * Two things are stored, on purpose: `User.pointsBalance` is the number every
 * read needs and the one the conditional decrement below locks on, and
 * `points_transactions` is the ledger that answers "where did my 50 points go".
 * A balance with no history cannot be audited; a history with no balance costs
 * a SUM on every request.
 */

/**
 * TODO(task 6): delete this and import the generated enum instead, once the
 * model in the task description has been added and migrated:
 *
 *   import type { PointsTransactionType } from "../../generated/prisma/enums.js";
 */
export type PointsTransactionType = "TOPUP" | "SPEND" | "REFUND" | "ADMIN_GRANT";

/**
 * TASK 6 - the number on the profile screen.
 *
 * One `select: { pointsBalance: true }`, nothing else. 404 when the user is
 * gone or soft-deleted - `deletedAt: null`, like every other read of users.
 */
export async function getPointsBalance(userId: bigint) {
  // TODO(task 6): returns Promise<number>
  throw ApiError.notImplemented();
}

/**
 * TASK 6 - the history screen. One page plus the total, newest first.
 *
 * Copy `listUsers` in users.service.ts: build the `where`, then run findMany
 * and count together with Promise.all, and return `{ transactions, total }` so
 * the route can build its `meta`.
 */
export async function listPointsTransactions(
  userId: bigint,
  query: ListPointsQuery,
) {
  // TODO(task 6)
  throw ApiError.notImplemented();
}

/**
 * TASK 6 - take points off a balance, as part of a bigger write.
 *
 * **Takes a transaction client, never `prisma` directly.** Spending points is
 * always half of something: task 8 charges for an estimation *and* writes the
 * estimation, and if the second half fails the first must roll back with it.
 *
 * The guard is one conditional update, not a read followed by an `if`:
 *
 *   const { count } = await tx.user.updateMany({
 *     where: { id: userId, deletedAt: null, pointsBalance: { gte: amount } },
 *     data: { pointsBalance: { decrement: amount } },
 *   });
 *   if (count === 0) throw ApiError.paymentRequired(messages.points.notEnough);
 *
 * That is the entire race-condition story. Two estimations fired at the same
 * second cannot both pass, because the second `updateMany` matches zero rows.
 * A `findUnique` and an `if` would let both through and hand out 50 free points.
 *
 * Then insert the SPEND row with the balance the update returned, and return
 * the new balance so the caller can put it in the response.
 */
export async function spendPoints(
  tx: Prisma.TransactionClient,
  userId: bigint,
  amount: number,
  meta: { reason?: string; serviceRequestId?: bigint },
) {
  // TODO(task 6): returns Promise<number> - the balance after the spend.
  // `ApiError.paymentRequired()` (402, code `insufficient_points`) and the
  // `messages.points` block are part of this task too - see core/errors.ts and
  // core/messages.ts.
  throw ApiError.notImplemented();
}

/**
 * TASK 6 - the mirror image: `increment`, a positive amount, and a row whose
 * `type` says where the points came from.
 *
 * `ADMIN_GRANT` is what the admin endpoint writes today. `TOPUP` is what a
 * Paymob webhook will write when payments exist - see "Recharging" in the task
 * description, and note that the webhook, not the app, is what credits a wallet.
 */
export async function creditPoints(
  tx: Prisma.TransactionClient,
  userId: bigint,
  amount: number,
  meta: { type: PointsTransactionType; reason?: string },
) {
  // TODO(task 6): returns Promise<number> - the balance after the credit.
  throw ApiError.notImplemented();
}
