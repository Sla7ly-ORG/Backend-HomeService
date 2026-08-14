import "dotenv/config";
import { z } from "zod";

// Every environment variable the app needs is declared here. If one is missing
// or malformed the process exits immediately with a readable message, instead
// of failing later with a confusing runtime error.
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),

  // Signs and verifies every JWT. Changing it logs everyone out, which is the
  // only "revoke all sessions" button this app has - see auth.tokens.ts.
  // Generate one with: node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),

  // Short, because an access token cannot be revoked before it expires.
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  // Long, because the alternative is sending another SMS.
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Where uploaded documents and photos are written. Relative paths resolve
  // against the working directory the process was started from. In Docker this
  // wants to point at a mounted volume, or every deploy throws the files away -
  // see the `uploads` volume in docker-compose.yml.
  UPLOAD_DIR: z.string().min(1).default("uploads"),

  // Comma-separated origins allowed to open a socket, or `*` for any.
  //
  // A native app does not send an `Origin` header, so this changes nothing for
  // the phone. It matters for a browser: the Socket.IO handshake is an ordinary
  // HTTP request before it is a socket, so a dashboard served from another host
  // is refused at that handshake unless its origin is listed here.
  SOCKET_CORS_ORIGIN: z.string().min(1).default("*"),

  // The classifier behind "describe it with an AI" - see
  // src/modules/ai/ai.client.ts, the only file that knows it exists. Optional
  // in development: an unconfigured URL falls back to a deterministic stub so
  // tasks 9-11 can be built before the model is reachable. Required in
  // production - checked below, once parsing succeeds.
  AI_SERVICE_URL: z.string().url().optional(),
  AI_SERVICE_TOKEN: z.string().min(1).optional(),
  // How long to wait for a prediction before treating the service as down.
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  // What "describe it with an AI" costs the customer, in points.
  AI_ESTIMATION_POINTS_COST: z.coerce.number().int().positive().default(50),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("Copy .env.example to .env and fill in the values.");
  process.exit(1);
}

// A missing AI_SERVICE_URL is a convenience in development - see the stub in
// ai.client.ts. In production it would silently serve every estimate off the
// stub and never tell anyone, so it fails loudly at startup instead.
if (parsed.data.NODE_ENV === "production" && !parsed.data.AI_SERVICE_URL) {
  console.error(
    "AI_SERVICE_URL is required in production - the AI estimation stub must never run for real customers.",
  );
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === "production";
