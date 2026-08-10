import type { Server as HttpServer } from "node:http";
import { Server, type DefaultEventsMap } from "socket.io";
import { env, isProduction } from "../core/env.js";
import { socketAuthGuard, type AppSocketData } from "./realtime.auth.js";
import { roomFor } from "./realtime.events.js";

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
 * Two details that are easy to skip and painful later:
 *
 * **Clients never join rooms themselves.** There is no `socket.on("join", ...)`
 * handler here, and adding one - however innocent it looks - is a subscription
 * to somebody else's jobs. The room comes from the token, in the guard.
 *
 * **A socket is disconnected once its access token would have expired.** A
 * socket is authenticated once, at the handshake; without the timer below, one
 * authenticated a week ago is still being fed after the account was blocked.
 * The HTTP side promises "a blocked account stops working within 15 minutes"
 * because the guard re-reads the user row on every request - this is how the
 * socket keeps the same promise. The app already expects it and reconnects with
 * a fresh token; that is the `connect_error` handler in docs/APP-FLOW.md.
 */
export function createRealtime(httpServer: HttpServer): AppServer {
  io = new Server(httpServer, {
    // `*` is the default and the right one for a native app, which sends no
    // Origin at all. A browser dashboard on another host needs listing.
    cors: { origin: env.SOCKET_CORS_ORIGIN.split(",").map((o) => o.trim()) },
  });

  io.use(socketAuthGuard);

  io.on("connection", (socket) => {
    const { user } = socket.data;

    socket.join(roomFor(user.id));

    // Same lifetime as the token that opened the connection. `disconnect(true)`
    // closes the underlying transport rather than just the namespace, so a
    // client cannot keep the socket alive by ignoring the event.
    const expiry = setTimeout(
      () => socket.disconnect(true),
      env.ACCESS_TOKEN_TTL_MINUTES * 60_000,
    );

    socket.on("disconnect", (reason) => {
      clearTimeout(expiry);

      if (!isProduction) {
        console.log(`[realtime] user ${user.id} disconnected: ${reason}`);
      }
    });

    if (!isProduction) {
      console.log(`[realtime] user ${user.id} connected: ${socket.id}`);
    }
  });

  return io;
}

/** Stops accepting connections and closes the open ones. Called on shutdown. */
export async function closeRealtime() {
  await io?.close();
  io = null;
}
