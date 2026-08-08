import { Router } from "express";
import { toUserResponse } from "../users/users.mapper.js";
import {
  accountStateMessage,
  resolveAccountState,
} from "../users/users.state.js";
import * as authService from "./auth.service.js";
import { refreshBody, requestOtpBody, verifyOtpBody } from "./auth.schema.js";

/**
 * Phone login, mounted at /api/v1/public/auth. Open by definition - this is
 * how a user gets in, so it cannot require being in.
 *
 * Two steps: ask for a code, then send it back. The second one hands over the
 * tokens every other endpoint asks for; /refresh renews them without a new SMS.
 */
export const authPublicRoutes = Router();

/** POST /api/v1/public/auth/request-otp */
authPublicRoutes.post("/request-otp", async (req, res) => {
  const { phone } = requestOtpBody.parse(req.body);
  const result = await authService.requestOtp(phone);

  res.json({ data: result });
});

/** POST /api/v1/public/auth/verify-otp */
authPublicRoutes.post("/verify-otp", async (req, res) => {
  const { phone, otpCode } = verifyOtpBody.parse(req.body);
  const { user, technicianProfile, isNewUser, tokens } =
    await authService.verifyOtp(phone, otpCode);

  const accountState = resolveAccountState(user, technicianProfile);

  res.json({
    data: {
      user: toUserResponse(user),
      isNewUser,
      // Which screen to show next. A technician who already sent their
      // documents gets WAITING_FOR_APPROVAL every time they open the app,
      // until an admin approves them - they are never asked to onboard twice.
      accountState,
      message: accountStateMessage[accountState],
      // Store both. `accessToken` goes on every later call as
      // `Authorization: Bearer <token>`; `refreshToken` is only ever sent to
      // /refresh below.
      tokens,
    },
  });
});

/**
 * POST /api/v1/public/auth/refresh
 *
 * Public because an expired access token is exactly the situation it exists
 * for - requiring a valid one here would be a deadlock. The refresh token in
 * the body is the credential, and it is verified just as strictly.
 */
authPublicRoutes.post("/refresh", async (req, res) => {
  const { refreshToken } = refreshBody.parse(req.body);
  const { user, technicianProfile, tokens } =
    await authService.refreshSession(refreshToken);

  const accountState = resolveAccountState(user, technicianProfile);

  res.json({
    data: {
      user: toUserResponse(user),
      // Sent back for the same reason login sends it: an admin may have
      // approved (or rejected) the technician since the app last looked.
      accountState,
      message: accountStateMessage[accountState],
      tokens,
    },
  });
});
