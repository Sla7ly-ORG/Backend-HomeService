import { Router } from "express";
import { techniciansTechnicianRoutes } from "../modules/technicians/technicians.technician.routes.js";
import { offersTechnicianRoutes } from "../modules/offers/offers.technician.routes.js";

/**
 * Technician-facing endpoints, under /api/v1/technician.
 */
export const technicianRouter = Router();

// POST /api/v1/technician/profile - the technician half of "create my
// profile". Its twin is POST /api/v1/customer/profile in api/customer.ts.
technicianRouter.use("/profile", techniciansTechnicianRoutes); // task 3

// The job feed, and answering one with a fee. "Jobs" on this side of the wire,
// `technician_offers` in the database - see the module for why.
technicianRouter.use("/jobs", offersTechnicianRoutes); // task 10
