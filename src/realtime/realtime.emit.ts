import type { RequestStatus } from "../generated/prisma/enums.js";
import {
  events,
  roomFor,
  type JobClosedPayload,
  type JobClosedReason,
  type JobSelectedPayload,
  type OfferNewPayload,
  type RequestUpdatedPayload,
} from "./realtime.events.js";
import { getIo } from "./realtime.server.js";

/**
 * TASK 9 - the only file tasks 10 and 11 import.
 *
 * Every function here takes ids and an **already-mapped** payload. That is what
 * keeps the realtime module free of Prisma and guarantees the socket card and
 * the REST card are the same object: both come out of the same mapper.
 *
 * Two rules, and they are the reason these are not just `io.to(...).emit(...)`
 * at the call site:
 *
 *   **Emit after the commit, never inside the transaction.** A rollback with an
 *   event already sent leaves fifty technicians looking at a job that does not
 *   exist.
 *
 *   **An emit must never throw.** By the time one of these runs, the write has
 *   succeeded and the customer has been charged; a socket problem must not turn
 *   that into a 500. Hence `safeEmit` below, and hence these return `void`
 *   rather than a promise - nothing waits on them.
 */

/** So a missing server logs once, not once per publish. */
const warned = new Set<string>();

function safeEmit(room: string, event: string, payload: unknown) {
  const io = getIo();

  // No server: a script, a seed, a test. Not a failure - the caller's write has
  // already committed and the screens will catch up on their next REST fetch,
  // which is what docs/APP-FLOW.md tells every screen to do on open anyway.
  if (!io) {
    if (!warned.has(event)) {
      warned.add(event);
      console.warn(`[realtime] ${event} dropped - no socket server in this process`);
    }

    return;
  }

  try {
    io.to(room).emit(event, payload);
  } catch (err) {
    // Deliberately swallowed. See the header: by the time this runs the
    // transaction is committed, and a socket fault must not rewrite a 200
    // into a 500 for something the caller already got.
    console.error(`[realtime] ${event} failed`, err);
  }
}

/**
 * -> technician: a new job in their area and field. One card each.
 *
 * One emit per technician rather than one to a shared room: `distanceKm` is
 * different for every recipient, so task 10 maps a card per id and this loop
 * delivers each to its own person.
 */
export function emitJobNew(technicianIds: bigint[], job: unknown): void {
  for (const id of technicianIds) safeEmit(roomFor(id), events.jobNew, job);
}

/** -> technician: take that card off the screen. */
export function emitJobClosed(
  technicianIds: bigint[],
  requestId: bigint,
  reason: JobClosedReason,
): void {
  const payload: JobClosedPayload = {
    // Ids are strings on the wire, exactly as they are in every HTTP response.
    // `core/serialize.ts` taught `JSON.stringify` about BigInt, but Socket.IO
    // does not use it - so the conversion happens here.
    requestId: requestId.toString(),
    reason,
  };

  for (const id of technicianIds) safeEmit(roomFor(id), events.jobClosed, payload);
}

/** -> technician: they were chosen, and can now read the address and phone. */
export function emitJobSelected(
  technicianId: bigint,
  requestId: bigint,
  offerId: bigint,
): void {
  const payload: JobSelectedPayload = {
    requestId: requestId.toString(),
    offerId: offerId.toString(),
  };

  safeEmit(roomFor(technicianId), events.jobSelected, payload);
}

/** -> customer: a technician sent a fee. */
export function emitOfferNew(
  customerId: bigint,
  requestId: bigint,
  offer: unknown,
): void {
  const payload: OfferNewPayload = {
    requestId: requestId.toString(),
    offer,
  };

  safeEmit(roomFor(customerId), events.offerNew, payload);
}

/** -> customer: the request moved on. */
export function emitRequestUpdated(
  customerId: bigint,
  requestId: bigint,
  status: RequestStatus,
): void {
  const payload: RequestUpdatedPayload = {
    requestId: requestId.toString(),
    status,
  };

  safeEmit(roomFor(customerId), events.requestUpdated, payload);
}
