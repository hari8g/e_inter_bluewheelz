import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../auth/requireAuth.js";
import { credentialsMatch, signSession } from "../auth/session.js";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  const { username, password } = parsed.data;
  if (!credentialsMatch(username, password)) {
    return res.status(401).json({ error: "invalid_credentials" });
  }
  const token = signSession(username);
  res.json({
    token,
    username: username.trim(),
    displayName: "BluWheelz",
  });
});

authRouter.get("/me", requireAuth, (req, res) => {
  const username = (req as AuthedRequest).auth?.username ?? "";
  res.json({ username, displayName: "BluWheelz" });
});
