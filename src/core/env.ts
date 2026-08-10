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

export const env = parsed.data;

export const isProduction = env.NODE_ENV === "production";
