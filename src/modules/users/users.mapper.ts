import type { User } from "../../generated/prisma/client.js";

/**
 * Database rows are not API responses. A mapper is the one place that decides
 * which columns leave the server and in what format:
 *
 *   - BigInt ids become strings (they do not fit in a JavaScript number)
 *   - Decimal coordinates become plain numbers
 *   - `deletedAt` never leaves - it is an internal soft-delete flag
 *
 * When an audience needs a different shape (say customers should only see a
 * technician's name and rating), add a second function here rather than
 * spreading `select` clauses through the routes.
 */
export function toUserResponse(user: User) {
  return {
    id: user.id.toString(),
    // Everything but the phone is null until onboarding is finished, so the
    // app can render a half-filled profile without special-casing anything.
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    status: user.status,
    city: user.city,
    address: user.address,
    latitude: user.latitude?.toNumber() ?? null,
    longitude: user.longitude?.toNumber() ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    pointsBalance: user.pointsBalance,
  };
}

export type UserResponse = ReturnType<typeof toUserResponse>;
