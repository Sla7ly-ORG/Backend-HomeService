import { z } from "zod";
import { idField, idParams } from "../../core/fields.js";
import { nationalIdField } from "../../core/national-id.js";
import { paginationQuery } from "../../core/pagination.js";
import { profileFields } from "../users/users.schema.js";
import { VerificationStatus } from "../../generated/prisma/enums.js";

// TASKS 3 & 5 - Technician profiles. See docs/ONBOARDING-FLOW.md.

export const technicianIdParams = idParams;

/**
 * A file the client already uploaded: the URL that POST /public/uploads gave
 * back, e.g. "/uploads/1712345678-criminal-record.pdf". Never the file itself.
 * 255 is the column width.
 */
const uploadedFileUrl = z.string().trim().min(1).max(255);

/**
 * The two files a technician profile can carry, as the URLs they are stored
 * under. Both are optional: the criminal record and the technician's own photo
 * are nullable columns, so the app may send them later or not at all. The
 * national id is not here - it is the number itself, `nationalIdField` below.
 *
 * Its own schema because two endpoints end up holding exactly this shape:
 * `POST /technician/profile`, where the client sends URLs it got from
 * `POST /public/uploads`, and `POST /me/signup`, where the files themselves
 * arrive as multipart and the route converts them to URLs. Both hand the
 * result to the same service.
 */
const technicianDocuments = z.object({
  criminalRecordFile: uploadedFileUrl.optional(),
  profileImage: uploadedFileUrl.optional(),
});

/**
 * POST /technician/profile - screen 5b.
 *
 * A technician never sees the customer profile page, so this one form collects
 * *everything*: the same personal details a customer fills in, plus their
 * documents. That is the "more inputs" half of the technician branch.
 *
 * `profileFields` is imported rather than retyped, so the name/city/address
 * rules can never drift apart from the customer form.
 */
export const createTechnicianProfileBody = z.object({
  // No `userId`: the profile always belongs to the caller, and the route reads
  // that from the token with `currentUser(req)`. Accepting it as a field would
  // let a technician file documents against somebody else's account.
  ...profileFields,

  // The speciality picked back on screen 3.
  categoryId: idField,

  // The 14 digits off the card, typed in - not a photo of it. See
  // core/national-id.ts for what makes them valid.
  nationalId: nationalIdField,

  ...technicianDocuments.shape,
});

/**
 * PATCH /admin/technicians/:id/verification - task 5, the admin decides.
 *
 * TODO(task 5): { verificationStatus: "VERIFIED" | "REJECTED" }
 * Use `z.enum(VerificationStatus)` from generated/prisma/enums.js, then narrow
 * it - PENDING is not a decision an admin can submit.
 */
export const updateVerificationBody = z.object({
  verificationStatus: z.enum([
    VerificationStatus.VERIFIED,
    VerificationStatus.REJECTED,
  ]),
});

/**
 * GET /admin/technicians - task 5, the approval queue.
 *
 * TODO(task 5): extend with an optional `verificationStatus` filter so admins
 * can list just the PENDING ones. Copy listUsersQuery.
 */
export const listTechniciansQuery = paginationQuery.extend({
  verificationStatus: z.enum(VerificationStatus).optional(),
});


export type CreateTechnicianProfileBody = z.infer<
  typeof createTechnicianProfileBody
>;
export type TechnicianDocuments = z.infer<typeof technicianDocuments>;
export type UpdateVerificationBody = z.infer<typeof updateVerificationBody>;
export type ListTechniciansQuery = z.infer<typeof listTechniciansQuery>;

