import { Router } from "express";
import { ApiError } from "../../core/errors.js";
import { paginationMeta } from "../../core/pagination.js";
import { currentUser } from "../auth/auth.middleware.js";
import * as requestsService from "./requests.service.js";
import {
  toServiceRequestListItem,
  toServiceRequestResponse,
} from "./requests.mapper.js";
import {
  createServiceRequestBody,
  listMyRequestsQuery,
  requestIdParams,
} from "./requests.schema.js";

/**
 * TASKS 7, 8, 10 & 11 - everything a customer does with their own requests,
 * mounted at /api/v1/customer/requests.
 *
 * The screens these serve, in order, are in docs/APP-FLOW.md:
 *
 *   POST /                       describe the problem      -> a draft
 *   POST /:id/ai-estimation      "describe it with AI"     -> -50 points
 *   POST /:id/publish            the Send button           -> out to technicians
 *   GET  /:id/offers             the fees coming back
 *   POST /:id/offers/:offerId/accept
 *   POST /:id/cancel
 *   GET  /                       past orders
 *   GET  /:id                    one order
 *
 * Whose requests these are is never in the URL or the body: the group is behind
 * requireAuth + requireRole("CUSTOMER"), so it is `currentUser(req).id`.
 */
export const requestsCustomerRoutes = Router();

/** POST /api/v1/customer/requests - the draft. */
requestsCustomerRoutes.post("/", async (req, res) => {
  const body = createServiceRequestBody.parse(req.body);
  const request = await requestsService.createServiceRequest(
    currentUser(req).id,
    body,
  );

  res.status(201).json({ data: toServiceRequestResponse(request) });
});

/** GET /api/v1/customer/requests - past orders, paginated. */
requestsCustomerRoutes.get("/", async (req, res) => {
  const query = listMyRequestsQuery.parse(req.query);
  const { requests, total } = await requestsService.listCustomerRequests(
    currentUser(req).id,
    query,
  );

  res.json({
    data: requests.map(toServiceRequestListItem),
    meta: paginationMeta(query, total),
  });
});

/** GET /api/v1/customer/requests/:id */
requestsCustomerRoutes.get("/:id", async (req, res) => {
  const { id } = requestIdParams.parse(req.params);
  // Somebody else's request is a 404 - the service answers that way, and the
  // caller's id never comes off the URL.
  const request = await requestsService.getCustomerRequest(
    currentUser(req).id,
    id,
  );

  res.json({ data: toServiceRequestResponse(request) });
});

/** POST /api/v1/customer/requests/:id/cancel */
requestsCustomerRoutes.post("/:id/cancel", async (req, res) => {
  const { id } = requestIdParams.parse(req.params);
  const { request } = await requestsService.cancelServiceRequest(
    currentUser(req).id,
    id,
  );

  // TODO(task 10): the service also hands back `technicianIds` - the
  // technicians whose offers this just closed. Emit to them here, after the
  // write:
  //   emitJobClosed(technicianIds, id, "CANCELLED");
  //   emitRequestUpdated(currentUser(req).id, id, "CANCELLED");
  res.json({ data: toServiceRequestResponse(request) });
});

/** POST /api/v1/customer/requests/:id/ai-estimation */
requestsCustomerRoutes.post("/:id/ai-estimation", async (_req, res) => {
  // TODO(task 8): estimateServiceRequest, then 201 with all three numbers the
  // screen needs at once:
  //
  //   { data: { estimation: toAiEstimationResponse(request),
  //             pointsCharged, pointsBalance } }
  //
  // `pointsCharged` is 0 when the estimate already existed. Same status, same
  // body shape - the app draws the same screen either way.
  throw ApiError.notImplemented();
});

/** POST /api/v1/customer/requests/:id/publish - the Send button. */
requestsCustomerRoutes.post("/:id/publish", async (_req, res) => {
  // TODO(task 10): publishServiceRequest ->
  //   res.json({ data: { request: toServiceRequestResponse(request),
  //                      technicianCount } });
  // technicianCount: 0 is a 200, not an error. See the service.
  throw ApiError.notImplemented();
});

/** GET /api/v1/customer/requests/:id/offers - who answered, and for how much. */
requestsCustomerRoutes.get("/:id/offers", async (_req, res) => {
  // TODO(task 11): listRequestOffers ->
  //   res.json({ data: offers.map(...toOfferForCustomerResponse) });
  // No `meta`: at most MAX_OFFERS_PER_REQUEST of them ever exist.
  throw ApiError.notImplemented();
});

/** POST /api/v1/customer/requests/:id/offers/:offerId/accept */
requestsCustomerRoutes.post("/:id/offers/:offerId/accept", async (_req, res) => {
  // TODO(task 11): parse requestOfferParams, call acceptOffer, reply with the
  // request - which now carries the technician and their phone number.
  //
  // The three emits (job:selected to the winner, job:closed to the rest,
  // request:updated to the customer) belong in the service, after the commit.
  throw ApiError.notImplemented();
});
