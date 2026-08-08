import { z } from "zod";
import { messages } from "./messages.js";

/**
 * Field rules that more than one module needs. Keeping them here means a rule
 * is changed once, not hunted down in three schemas.
 *
 * Anything used by a single module belongs in that module's own schema file.
 */

/**
 * Phone is the only identity in this app, so the rule matters.
 *
 * Egyptian mobiles only, in international form: `+20`, then one of the four
 * network prefixes (`10` Vodafone, `11` Etisalat, `12` Orange, `15` WE), then
 * eight digits. The app ships in Egypt and a technician is dispatched to an
 * Egyptian address, so a number we could never call is not worth storing.
 *
 * Note what this does not accept: the local `01012345678` that everyone
 * actually types. Nothing normalises it before we get here, so the client has
 * to send the `+20` form - which is what docs/APP-FLOW.md shows and what
 * prisma/seed.ts generates.
 */
export const phoneField = z
  .string()
  .trim()
  .regex(/^\+201(?:0|1|2|5)\d{8}$/, messages.fields.phone);

/** Our primary keys are BigInt, but a URL always hands us a string. */
export const idField = z
  .string()
  .regex(/^\d+$/, messages.fields.id)
  .transform(BigInt);

/** `:id` in a URL. Reuse with `z.object({ id: idField })` shape below. */
export const idParams = z.object({ id: idField });
