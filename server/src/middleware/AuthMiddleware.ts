import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/AuthService";
// @ts-ignore
import jwt from "jsonwebtoken";

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = AuthService.verifyToken(token);

    if (!decoded || !decoded.userId) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    // Add user info to request
    (req as any).userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Authentication failed" });
  }
};
