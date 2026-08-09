import { messages } from "./messages.js";

/**
 * The only error type you should throw on purpose.
 *
 *   throw ApiError.notFound(messages.users.notFound);
 *
 * The error handler in core/error-handler.ts turns it into a JSON response
 * with the right status code. Anything else that reaches the handler is
 * treated as an unexpected bug and becomes a 500.
 *
 * `code` is English and stays that way - it is what the app switches on. The
 * message is Arabic and comes from core/messages.ts, which is where all of the
 * user-facing wording lives; do not type a sentence inline here.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = messages.generic.badRequest, details?: unknown) {
    return new ApiError(400, "bad_request", message, details);
  }

  static unauthorized(message = messages.generic.unauthorized) {
    return new ApiError(401, "unauthorized", message);
  }

  static forbidden(message = messages.generic.forbidden) {
    return new ApiError(403, "forbidden", message);
  }

  static notFound(message = messages.generic.notFound) {
    return new ApiError(404, "not_found", message);
  }

  static conflict(message = messages.generic.conflict, details?: unknown) {
    return new ApiError(409, "conflict", message, details);
  }

  static paymentRequired(message = messages.points.notEnough) {
    return new ApiError(402, "insufficient_points", message);
  }

  /**
   * For an endpoint that exists in the route map but has not been written yet.
   * Delete the throw as soon as you implement the handler.
   */
  static notImplemented(message = messages.generic.notImplemented) {
    return new ApiError(501, "not_implemented", message);
  }
}
