import type {
  Prisma,
  TechnicianProfile,
} from "../../generated/prisma/client.js";
import { toUserResponse } from "../users/users.mapper.js";

// TASKS 3 & 5. Reference: src/modules/users/users.mapper.ts.

/**
 * The technician's own view of their profile.
 *
 * Deliberately NOT returned: `nationalId` and `criminalRecordFile`. They are
 * identity documents - only the admin mapper below should ever expose them.
 * `profileImage` is different: it is the photo of themselves that the app
 * displays, so it belongs in every response.
 */
export function toTechnicianProfileResponse(profile: TechnicianProfile) {
  return {
    id: profile.id.toString(),
    userId: profile.userId.toString(),
    categoryId: profile.categoryId.toString(),
    verificationStatus: profile.verificationStatus,
    isAvailable: profile.isAvailable,
    // Decimal, never a float - a rating of 4.50 must not arrive as 4.5000001.
    overallRating: profile.overallRating.toString(),
    totalReviews: profile.totalReviews,
    profileImage: profile.profileImage,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export type TechnicianProfileResponse = ReturnType<
  typeof toTechnicianProfileResponse
>;

/**
 * The admin's view: the same fields plus `nationalId`, `criminalRecordFile`,
 * and the account and category behind the row, because the admin has to look at
 * all of it to approve the technician.
 *
 * This is exactly why mappers exist: same row, two audiences, two shapes. Do
 * not be tempted to add a flag to the function above.
 */
type TechnicianProfileWithRelations = Prisma.TechnicianProfileGetPayload<{
  include: {
    user: true;
    category: true;
  };
}>;

export function toTechnicianProfileAdminResponse(
  profile: TechnicianProfileWithRelations,
) {
  return {
    ...toTechnicianProfileResponse(profile),

    user: toUserResponse(profile.user),

    category: {
      id: profile.category.id.toString(),
      name: profile.category.name,
    },

    nationalId: profile.nationalId,
    criminalRecordFile: profile.criminalRecordFile,
  };
}
