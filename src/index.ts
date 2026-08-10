import { app } from "./app.js";
import { env } from "./core/env.js";
import { prisma } from "./core/prisma.js";
import { createRealtime, closeRealtime } from "./realtime/realtime.server.js";

const server = app.listen(env.PORT, () => {
  console.log(`Server listening on http://localhost:${env.PORT}`);
});

// The socket server shares this HTTP server, so there is no second port and
// nothing to change in Docker or the load balancer.
createRealtime(server);

async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down.`);
  server.close();
  await closeRealtime();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
