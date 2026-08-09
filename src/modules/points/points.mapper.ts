import type { PointsTransaction } from "../../generated/prisma/client.js";

/**
 * TASK 6 - one row of the history screen.
 *
 * Ids become strings, the way they do everywhere. `amount` and `balanceAfter`
 * stay plain integers: points are a count, not money, so the "money is a
 * string" rule does not apply to them - and `amount` is signed, +100 for a
 * top-up and -50 for a spend, which is what lets the screen colour the row
 * without a second field telling it the direction.
 *
 * Say that in a comment when you write it. It is the one exception in the
 * codebase and the next person will assume it is a bug.
 */
export function toPointsTransactionResponse(row: PointsTransaction) {
  return {
    id: row.id.toString(),
    userId: row.userId.toString(),
    type: row.type,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    reason: row.reason,
    serviceRequestId: row.serviceRequestId?.toString() ?? null,
    createdAt: row.createdAt,
  };
}

export type PointsTransactionResponse = ReturnType<
  typeof toPointsTransactionResponse
>;
