import { Router } from "express";
import { ApiError } from "../core/errors.js";

/**
 * TASK 9 - a way to see the socket working, mounted at /api/v1/admin/realtime.
 *
 * Tasks 10 and 11 are the real emitters, but they are days away and a channel
 * you cannot watch is a channel you cannot debug. This one sends a `debug:ping`
 * to any user's room, so the test script in the task description prints
 * something the moment the handshake works.
 *
 * Admin-guarded by api/index.ts, so it can stay.
 */
export const realtimeAdminRoutes = Router();

/** POST /api/v1/admin/realtime/ping - { userId, message } */
realtimeAdminRoutes.post("/ping", async (_req, res) => {
  // TODO(task 9): parse a small body ({ userId: idField, message: string }),
  // then emit straight through the io instance:
  //
  //   getIo()?.to(roomFor(userId)).emit("debug:ping", { message });
  //   res.json({ data: { delivered: getIo() !== null } });
  //
  // `debug:ping` is deliberately not in `events` - it is not part of the app's
  // contract, and nothing but this route and the test script should know it.
  throw ApiError.notImplemented();
});
