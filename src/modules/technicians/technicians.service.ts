import { prisma } from "../../core/prisma.js";
import { ApiError } from "../../core/errors.js";
import { messages } from "../../core/messages.js";
import type {
  CreateTechnicianProfileBody,
  ListTechniciansQuery,
  UpdateVerificationBody,
} from "./technicians.schema.js";
import { Prisma } from "../../generated/prisma/client.js";
import { skipTake } from "../../core/pagination.js";

// TASKS 3 & 5 - all database access for technician profiles.
// Reference: src/modules/users/users.service.ts.

/**
 * The technician submits their details and documents in one go.
 *
 * Two rows change together and must not half-happen, so both live in one
 * transaction:
 *
 *   1. the personal details land on the User row (the same five a customer
 *      would type on the profile page), along with `role: TECHNICIAN`
 *   2. the TechnicianProfile row is created with the documents, PENDING
 *
 * The user's `status` deliberately stays PENDING: role TECHNICIAN plus
 * verificationStatus PENDING is what makes the app show "waiting for approval"
 * - see resolveAccountState in modules/users/users.state.ts. Only an admin
 * (task 5) can move them on.
 *
 * Returns the updated user as well as the profile so the route can hand both
 * to resolveAccountState instead of hardcoding the state.
 */
export async function createTechnicianProfile(
  userId: bigint,
  data: CreateTechnicianProfileBody,
) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
  });

  // `tx.user.update` cannot express the soft-delete filter, so the check
  // happens here - a deleted user must not be resurrected as a technician.
  if (!user) {
    throw ApiError.notFound(messages.users.notFound);
  }

  // The same guard selectRole uses. Without it an account that already
  // finished signing up as a customer would be silently turned into a
  // technician and pushed back to the waiting screen.
  if (user.status !== "PENDING") {
    throw ApiError.conflict(messages.users.signUpAlreadyFinished);
  }

  // Submitting twice hits the unique index on userId (P2002 -> 409), and an
  // unknown categoryId hits the foreign key (P2003 -> 409). Neither needs a
  // check up front; the error handler turns both into the right response.
  return prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        fullName: data.fullName,
        city: data.city,
        address: data.address,
        latitude: data.latitude,
        longitude: data.longitude,
        // Already TECHNICIAN from the role screen; setting it again is
        // harmless and keeps this endpoint correct on its own.
        role: "TECHNICIAN",
      },
    });

    const technicianProfile = await tx.technicianProfile.create({
      data: {
        userId,
        categoryId: data.categoryId,
        nationalId: data.nationalId,
        criminalRecordFile: data.criminalRecordFile,
        profileImage: data.profileImage,
        verificationStatus: "PENDING",
      },
    });

    return { user: updatedUser, technicianProfile };
  });
}

/** The profile belonging to a user, or null. Used to build the account state. */
export async function findTechnicianProfileByUserId(userId: bigint) {
  return prisma.technicianProfile.findUnique({ where: { userId } });
}

/**
 * TASK 5 - the approval queue. One page of technician profiles, newest first,
 * optionally filtered by verificationStatus, plus the total count.
 *
 * `include: { user: true, category: true }` so the admin sees who and what.
 */
export async function listTechnicians(query: ListTechniciansQuery) {
  const where: Prisma.TechnicianProfileWhereInput = {
    ...(query.verificationStatus
      ? { verificationStatus: query.verificationStatus }
      : {}),
  };

  const [technicians, total] = await Promise.all([
    prisma.technicianProfile.findMany({
      where,
      include: {
        user: true,
        category: true,
      },
      orderBy: { createdAt: "desc" },
      ...skipTake(query),
    }),
    prisma.technicianProfile.count({ where }),
  ]);

  return { technicians, total };
}

/**
 * TASK 5 - the admin approves or rejects.
 *
 * Another transaction, because approving touches two rows:
 *
 *   VERIFIED  -> profile.verificationStatus = VERIFIED
 *                AND user.status = ACTIVE      (this is what lets them work)
 *   REJECTED  -> profile.verificationStatus = REJECTED
 *                leave user.status as PENDING so they can submit again
 */

export async function setVerificationStatus(
  technicianProfileId: bigint,
  data: UpdateVerificationBody,
) {
  return prisma.$transaction(async (tx) => {
    const profile = await tx.technicianProfile.update({
      where: { id: technicianProfileId },
      data: {
        verificationStatus: data.verificationStatus,
      },
      include: {
        user: true,
        category: true,
      },
    });

    if (data.verificationStatus === "VERIFIED") {
      await tx.user.update({
        where: { id: profile.userId },
        data: {
          status: "ACTIVE",
        },
      });
    }

    return profile;
  });
}
