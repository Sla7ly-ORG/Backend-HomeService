import { Router } from "express";
import { ApiError } from "../../core/errors.js";
import { messages } from "../../core/messages.js";
import { publicUrlFor, upload } from "./uploads.storage.js";

/**
 * TASK 4 - the standalone upload endpoint, for a client that uploads a document
 * and *then* submits the form, rather than sending both at once.
 *
 * Mounted at /api/v1/public/uploads.
 *
 * **The storage layer already exists** - POST /api/v1/me/signup needed it, so
 * multer is installed and modules/uploads/uploads.storage.ts holds all of it:
 * the configured instance, the JPEG/PNG/PDF filter, the 5 MB limit, the
 * rename-on-disk, `publicUrlFor` and `discardUploads`. app.ts already serves
 * the folder under `uploadUrlPath`, and core/error-handler.ts already turns a
 * MulterError into a 400.
 *
 * So import `upload` and `publicUrlFor` from ./uploads.storage.js. Do **not**
 * configure a second multer here: two instances means two sets of limits, and
 * the laxer one becomes the way in.
 */
export const uploadsPublicRoutes = Router();

/** POST /api/v1/public/uploads - multipart/form-data, field name "file" */
uploadsPublicRoutes.post(
  "/",
  upload.single("file"),
  async (req, res) => {
    // upload.single leaves req.file undefined when no file was sent - the
    // filter never runs in that case, so nothing rejects it on its own.
    if (!req.file) {
      throw ApiError.badRequest(messages.uploads.fileRequired);
    }

    res.status(201).json({ data: { url: publicUrlFor(req.file) } });
  },
);
