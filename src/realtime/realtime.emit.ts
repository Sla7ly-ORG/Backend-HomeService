import type { RequestStatus } from "../generated/prisma/enums.js";
import { events, roomFor, type JobClosedReason } from "./realtime.events.js";

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

function safeEmit(_room: string, event: string, _payload: unknown) {
  // TODO(task 9): once createRealtime is written, this becomes:
  //
  //   const io = getIo();
  //   if (!io) { warnOnce(event); return; }
  //   try { io.to(room).emit(event, payload); } catch (err) { console.error(...); }
  //
  // Keep the try/catch. See the note above about never throwing.
  if (!warned.has(event)) {
    warned.add(event);
    console.warn(`[realtime] ${event} dropped - the socket server is not built yet (task 9)`);
  }
}

/** -> technician: a new job in their area and field. One card each. */
export function emitJobNew(technicianIds: bigint[], job: unknown): void {
  // TODO(task 9): one emit per technician - `distanceKm` differs per recipient,
  // so the caller maps a card per id rather than sharing one object.
  for (const id of technicianIds) safeEmit(roomFor(id), events.jobNew, job);
}

/** -> technician: take that card off the screen. */
export function emitJobClosed(
  technicianIds: bigint[],
  requestId: bigint,
  reason: JobClosedReason,
): void {
  // TODO(task 9): payload { requestId: requestId.toString(), reason }
  //   - the JobClosedPayload type in realtime.events.ts
  for (const id of technicianIds) safeEmit(roomFor(id), events.jobClosed, null);
}

/** -> technician: they were chosen, and can now read the address and phone. */
export function emitJobSelected(
  technicianId: bigint,
  requestId: bigint,
  offerId: bigint,
): void {
  // TODO(task 9): payload { requestId, offerId }, both `.toString()`
  safeEmit(roomFor(technicianId), events.jobSelected, null);
}

/** -> customer: a technician sent a fee. */
export function emitOfferNew(
  customerId: bigint,
  requestId: bigint,
  offer: unknown,
): void {
  // TODO(task 9): payload { requestId: requestId.toString(), offer }
  safeEmit(roomFor(customerId), events.offerNew, offer);
}

/** -> customer: the request moved on. */
export function emitRequestUpdated(
  customerId: bigint,
  requestId: bigint,
  status: RequestStatus,
): void {
  // TODO(task 9): payload { requestId: requestId.toString(), status }
  safeEmit(roomFor(customerId), events.requestUpdated, null);
}
