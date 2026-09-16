import type { NextFunction, Request, Response } from "express";
import { bearerToken, verifySession } from "./session.js";

export type AuthedRequest = Request & { auth?: { username: string } };

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = bearerToken(req.header("authorization") ?? undefined);
  if (!token) return res.status(401).json({ error: "unauthorized" });
  const session = verifySession(token);
  if (!session) return res.status(401).json({ error: "unauthorized" });
  (req as AuthedRequest).auth = session;
  next();
}
