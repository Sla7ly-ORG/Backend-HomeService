import { z } from "zod";
import { idField } from "../core/fields.js";

/**
 * TASK 9 - the one body the realtime module parses.
 *
 * The socket itself has no schemas because it never receives anything: this is
 * the debug endpoint's body, and it is an ordinary HTTP request like every
 * other write in the app.
 */
export const pingBody = z.object({
  /** Whose room to send it to. Any user - this is an admin tool. */
  userId: idField,
  message: z.string().trim().min(1).max(200),
});

export type PingBody = z.infer<typeof pingBody>;
