import type { DefaultEventsMap, Socket } from "socket.io";
import type { User } from "../generated/prisma/client.js";
import { ApiError } from "../core/errors.js";

/**
 * TASK 9 - the handshake guard. The socket half of requireAuth.
 *
 * It reuses the HTTP guard's own pieces - `verifyToken` from
 * modules/auth/auth.tokens.js, `findUserById` from modules/users/users.service.js
 * and `assertAccountIsUsable` from modules/auth/auth.service.js - so there is
 * one auth story for both channels rather than two that drift.
 */

/**
 * What we hang off a connected socket. The socket.io equivalent of
 * `req.auth.user`, and the reason `AppSocket` below is a narrowed `Socket`
 * rather than the bare one.
 */
export type AppSocketData = { user: User };

export type AppSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  AppSocketData
>;

/**
 * TASK 9 - runs once per connection, before the socket joins anything.
 *
 * TODO(task 9):
 *
 *   const token = socket.handshake.auth?.token;
 *   const userId = verifyToken(String(token ?? ""), "access");
 *   const user = await findUserById(userId);
 *   if (!user) throw new Error("gone");
 *   assertAccountIsUsable(user);          // BLOCKED / SUSPENDED stop here
 *   socket.data.user = user;
 *   next();
 *
 * ...with the whole thing in a try/catch whose catch is exactly:
 *
 *   next(new Error("unauthorized"));
 *
 * **One message for every failure** - missing token, malformed, expired, a
 * refresh token sent by mistake, deleted account, blocked account. The client's
 * reaction is identical in every case (refresh, reconnect), and anything more
 * specific is free information for somebody probing. The app matches on that
 * exact string; it is in docs/APP-FLOW.md.
 *
 * The token is read from `handshake.auth`, not from a query string: query
 * strings end up in access logs and proxy dashboards.
 */
export async function socketAuthGuard(
  socket: AppSocket,
  next: (err?: Error) => void,
) {
  // TODO(task 9)
  throw ApiError.notImplemented();
}
