import type { TechnicianProfile } from "../../generated/prisma/client.js";


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
 * TODO(task 5): the same fields plus `nationalId` and `criminalRecordFile`,
 * because the admin has to look at them to approve the technician.
 *
 * This is exactly why mappers exist: same row, two audiences, two shapes. Do
 * not be tempted to add a flag to the function above.
 */
export function toTechnicianProfileAdminResponse(profile: TechnicianProfile) {
  return {
    ...toTechnicianProfileResponse(profile),
    nationalId: profile.nationalId,
    criminalRecordFile: profile.criminalRecordFile,
  };
}
