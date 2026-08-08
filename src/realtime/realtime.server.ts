import type { Server as HttpServer } from "node:http";
import type { DefaultEventsMap, Server } from "socket.io";
import { ApiError } from "../core/errors.js";
import type { AppSocketData } from "./realtime.auth.js";

/**
 * TASK 9 - the socket server itself.
 *
 * It shares the HTTP server the API already listens on, so there is no second
 * port to open and nothing to change in Docker or the load balancer.
 */

/** The instance type, carrying our `socket.data` shape through to every handler. */
export type AppServer = Server<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  AppSocketData
>;

let io: AppServer | null = null;

/**
 * The instance, or `null` before `createRealtime` has run.
 *
 * Null on purpose rather than a throw: a script, a seed or a test can import an
 * emitter without a server being up, and the emitters no-op when this is null.
 * Nothing that has already committed a transaction should fail because a socket
 * is missing.
 */
export function getIo(): AppServer | null {
  return io;
}

/**
 * TASK 9 - build the server, guard it, and put every connection in its own room.
 *
 * TODO(task 9):
 *
 *   io = new Server(httpServer, {          // imported as a value, not a type
 *     cors: { origin: env.SOCKET_CORS_ORIGIN.split(",") },
 *   });
 *   io.use(socketAuthGuard);
 *   io.on("connection", (socket) => {
 *     const user = socket.data.user!;          // the guard put it there
 *     socket.join(roomFor(user.id));
 *     // ...and a disconnect log while you are developing.
 *   });
 *   return io;
 *
 * Two details that are easy to skip and painful later:
 *
 * **Clients never join rooms themselves.** There is no `socket.on("join", ...)`
 * handler here, and adding one - however innocent it looks - is a subscription
 * to somebody else's jobs. The room comes from the token, in the guard.
 *
 * **Disconnect a socket once its access token would have expired.** Arm a
 * `setTimeout` for `env.ACCESS_TOKEN_TTL_MINUTES` at connection and call
 * `socket.disconnect(true)` when it fires (clearing it on `disconnect`). A
 * socket is authenticated once, at the handshake; without this, one
 * authenticated a week ago is still being fed after the account was blocked.
 * The HTTP side promises "a blocked account stops working within 15 minutes"
 * because the guard re-reads the user row on every request - this timer is how
 * the socket keeps the same promise. The app already expects it and reconnects
 * with a fresh token; that is the `connect_error` handler in docs/APP-FLOW.md.
 */
export function createRealtime(httpServer: HttpServer): AppServer {
  // TODO(task 9)
  throw ApiError.notImplemented();
}

/** Stops accepting connections and closes the open ones. Called on shutdown. */
export async function closeRealtime() {
  await io?.close();
  io = null;
}
