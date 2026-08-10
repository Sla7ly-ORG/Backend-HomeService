import { Router } from "express";
import { roomFor } from "./realtime.events.js";
import { pingBody } from "./realtime.schema.js";
import { getIo } from "./realtime.server.js";

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
realtimeAdminRoutes.post("/ping", async (req, res) => {
  const body = pingBody.parse(req.body);
  const io = getIo();

  // Straight through `io` rather than through realtime.emit.ts: `debug:ping` is
  // deliberately not in `events`. It is not part of the app's contract, and
  // nothing but this route and scripts/socket-test.mjs should know the name.
  io?.to(roomFor(body.userId)).emit("debug:ping", { message: body.message });

  // `delivered` says a server existed to emit through, not that anybody was
  // listening - Socket.IO cannot tell us the latter, and neither can we. An
  // empty room is a 200 with `delivered: true`.
  res.json({ data: { delivered: io !== null } });
});
