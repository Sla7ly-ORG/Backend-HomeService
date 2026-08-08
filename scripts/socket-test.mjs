// Watch the socket from a terminal.
//
//   node scripts/socket-test.mjs "$TOKEN"
//
// Prints every event the server sends to that user, so you can leave one copy
// running as a customer and another as a technician while you curl your way
// through tasks 10 and 11. See docs/INTERN-TASKS.md, task 9.
import { io } from "socket.io-client";

const token = process.argv[2];
const url = process.argv[3] ?? "http://localhost:3000";

if (!token) {
  console.error('Usage: node scripts/socket-test.mjs <accessToken> [url]');
  process.exit(1);
}

const socket = io(url, { auth: { token }, transports: ["websocket"] });

socket.on("connect", () => console.log("connected", socket.id));
socket.on("disconnect", (reason) => console.log("disconnected:", reason));
socket.on("connect_error", (err) => console.log("connect_error:", err.message));

// Everything else, whatever it is called.
socket.onAny((event, payload) =>
  console.log(event, JSON.stringify(payload, null, 2)),
);
