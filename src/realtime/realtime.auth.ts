import type { DefaultEventsMap, Socket } from "socket.io";
import type { User } from "../generated/prisma/client.js";
import { assertAccountIsUsable } from "../modules/auth/auth.service.js";
import { verifyToken } from "../modules/auth/auth.tokens.js";
import { findUserById } from "../modules/users/users.service.js";

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
 * The one string a rejected handshake ever sees. The app matches on it - see
 * the `connect_error` handler in docs/APP-FLOW.md.
 */
const UNAUTHORIZED = "unauthorized";

/**
 * TASK 9 - runs once per connection, before the socket joins anything.
 *
 * The three pieces below are the HTTP guard's own - `verifyToken`,
 * `findUserById`, `assertAccountIsUsable` - so a token that opens a socket is
 * exactly a token that opens an endpoint, and the two cannot drift apart.
 *
 * **One message for every failure** - missing token, malformed, expired, a
 * refresh token sent by mistake, deleted account, blocked account. The client's
 * reaction is identical in every case (refresh, reconnect), and anything more
 * specific is free information for somebody probing. That is also why the
 * `ApiError` these helpers throw is swallowed rather than forwarded: its
 * message is written for a person reading a screen, and here it would only
 * tell an attacker which half of the guess was right.
 *
 * The token is read from `handshake.auth`, not from a query string: query
 * strings end up in access logs and proxy dashboards.
 */
export async function socketAuthGuard(
  socket: AppSocket,
  next: (err?: Error) => void,
) {
  try {
    const token = socket.handshake.auth?.token;
    const userId = verifyToken(String(token ?? ""), "access");
    const user = await findUserById(userId);

    // Signed correctly, but the account has been deleted since.
    if (!user) {
      throw new Error("gone");
    }

    assertAccountIsUsable(user);

    // Read by `createRealtime` to pick the room. Never sent to the client, and
    // never taken from one - see the note on `roomFor`.
    socket.data.user = user;
    next();
  } catch {
    next(new Error(UNAUTHORIZED));
  }
}
