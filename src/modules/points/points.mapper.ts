import { ApiError } from "../../core/errors.js";

// TASK 6. Reference: src/modules/users/users.mapper.ts.

/**
 * TODO(task 6): delete this and import the generated row type instead, once the
 * model has been added and migrated:
 *
 *   import type { PointsTransaction } from "../../generated/prisma/client.js";
 *
 * It is written out here so the shape you are migrating towards is visible
 * while you write it.
 */
export type PointsTransactionRow = {
  id: bigint;
  userId: bigint;
  type: string;
  amount: number;
  balanceAfter: number;
  reason: string | null;
  serviceRequestId: bigint | null;
  createdAt: Date;
};

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
export function toPointsTransactionResponse(row: PointsTransactionRow) {
  // TODO(task 6)
  throw ApiError.notImplemented();
}
