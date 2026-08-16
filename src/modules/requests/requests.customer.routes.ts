import { Router } from "express";
import { paginationMeta } from "../../core/pagination.js";
import { currentUser } from "../auth/auth.middleware.js";
import * as requestsService from "./requests.service.js";
import * as offersService from "../offers/offers.service.js";
import {
  toAiEstimationResponse,
  toServiceRequestListItem,
  toServiceRequestResponse,
} from "./requests.mapper.js";
import {
  createServiceRequestBody,
  listMyRequestsQuery,
  requestIdParams,
  requestOfferParams,
} from "./requests.schema.js";
import {
  emitJobClosed,
  emitRequestUpdated,
} from "../../realtime/realtime.emit.js";
import { toOfferForCustomerResponse } from "../offers/offers.mapper.js";

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
  const { request, technicianIds } = await requestsService.cancelServiceRequest(
    currentUser(req).id,
    id,
  );

  // The technicians whose offers this just closed - emit after the write.
  if (technicianIds.length > 0) {
    emitJobClosed(technicianIds, id, "CANCELLED");
  }
  emitRequestUpdated(currentUser(req).id, id, "CANCELLED");

  res.json({ data: toServiceRequestResponse(request) });
});

/** POST /api/v1/customer/requests/:id/ai-estimation */
requestsCustomerRoutes.post("/:id/ai-estimation", async (req, res) => {
  const { id } = requestIdParams.parse(req.params);
  const { request, pointsCharged, pointsBalance } =
    await requestsService.estimateServiceRequest(currentUser(req).id, id);

  res.status(201).json({
    data: {
      estimation: toAiEstimationResponse(request),
      pointsCharged,
      pointsBalance,
    },
  });
});

/** POST /api/v1/customer/requests/:id/publish - the Send button. */
requestsCustomerRoutes.post("/:id/publish", async (req, res) => {
  const { id } = requestIdParams.parse(req.params);
  const { request, technicianCount } =
    await requestsService.publishServiceRequest(currentUser(req).id, id);

  // technicianCount: 0 is a 200, not an error - see the service.
  emitRequestUpdated(currentUser(req).id, id, "WAITING_FOR_TECHNICIAN");

  res.json({
    data: { request: toServiceRequestResponse(request), technicianCount },
  });
});

/** GET /api/v1/customer/requests/:id/offers - who answered, and for how much. */
requestsCustomerRoutes.get("/:id/offers", async (req, res) => {
  const { id } = requestIdParams.parse(req.params);
  const offers = await offersService.listRequestOffers(currentUser(req).id, id);

  // No `meta`: at most MAX_OFFERS_PER_REQUEST of them ever exist.
  res.json({
    data: offers.map(({ offer, distanceKm }) =>
      toOfferForCustomerResponse(offer, distanceKm),
    ),
  });
});

/** POST /api/v1/customer/requests/:id/offers/:offerId/accept */
requestsCustomerRoutes.post("/:id/offers/:offerId/accept", async (req, res) => {
  const { id, offerId } = requestOfferParams.parse(req.params);

  // The three emits (job:selected to the winner, job:closed to the rest,
  // request:updated to the customer) happen inside the service, after the
  // commit.
  await offersService.acceptOffer(currentUser(req).id, id, offerId);

  // Re-read through the customer's own mapper so the response carries the
  // technician and their phone number - toServiceRequestResponse is the
  // single place that decides when that's visible.
  const request = await requestsService.getCustomerRequest(
    currentUser(req).id,
    id,
  );

  // `{ data: { request } }`, not a bare request: the same envelope publish
  // answers with, and the one docs/APP-FLOW.md tells the app to read.
  res.json({ data: { request: toServiceRequestResponse(request) } });
});
