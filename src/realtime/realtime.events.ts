import type { RequestStatus } from "../generated/prisma/enums.js";

/**
 * TASK 9 - the socket contract, and nothing else.
 *
 * This file has no imports from `modules/`, no Prisma client, no `io`. It is
 * the list of things the server can say, so that the app team and the emitters
 * are reading the same page - the matching table for the app is in
 * docs/APP-FLOW.md, "Live updates".
 *
 * **Nothing here is a client -> server message.** The socket only ever
 * announces what an HTTP call already committed; an event that changed a row
 * would be a second API with none of the guards on it.
 */

/**
 * One room per user, both audiences. The name is derived from the token at the
 * handshake and never sent to a client: a client that could name its own room
 * could subscribe to somebody else's jobs.
 */
export const roomFor = (userId: bigint) => `user:${userId}`;

export const events = {
  /** -> technician: a job landed in your feed. Payload: one `GET /technician/jobs` card. */
  jobNew: "job:new",
  /** -> technician: take that card off the screen. */
  jobClosed: "job:closed",
  /** -> technician: you got it. */
  jobSelected: "job:selected",
  /** -> customer: a technician sent a fee. Payload: one `GET .../offers` card. */
  offerNew: "offer:new",
  /** -> customer: the request moved on. */
  requestUpdated: "request:updated",
} as const;

/**
 * Why a card is being taken away. The app shows a different sentence for each,
 * which is the only reason this is not a single "gone" event:
 *
 *   TAKEN      another technician was chosen
 *   CANCELLED  the customer cancelled
 *   FULL       MAX_OFFERS_PER_REQUEST fees are in; the customer is deciding
 */
export type JobClosedReason = "TAKEN" | "CANCELLED" | "FULL";

/**
 * Ids are strings on the wire, exactly as they are in every HTTP response.
 * `core/serialize.ts` taught `JSON.stringify` about BigInt, but Socket.IO does
 * not use it - so the emitters convert, and these types are the reminder.
 */
export type JobClosedPayload = {
  requestId: string;
  reason: JobClosedReason;
};

export type JobSelectedPayload = {
  requestId: string;
  offerId: string;
};

export type OfferNewPayload = {
  requestId: string;
  /** One element of `GET /customer/requests/:id/offers`, same mapper. */
  offer: unknown;
};

export type RequestUpdatedPayload = {
  requestId: string;
  status: RequestStatus;
};
