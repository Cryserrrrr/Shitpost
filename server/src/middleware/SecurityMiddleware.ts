import { Request, Response, NextFunction } from "express";

// Force HTTPS in production (optional: set FORCE_HTTPS=true in .env)
export const httpsRedirect = (req: Request, res: Response, next: NextFunction) => {
  if (
    process.env.FORCE_HTTPS === "true" &&
    !req.secure &&
    req.headers["x-forwarded-proto"] !== "https"
  ) {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
};

// Sanitize a string: trim, remove null bytes, limit length
export function sanitizeString(value: unknown, maxLength = 200): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\0/g, "").slice(0, maxLength);
}

// Validate username: 2-20 chars, no spaces, alphanumeric + _ and -
export function validateUsername(username: string): string | null {
  if (!username || username.length < 2 || username.length > 20) {
    return "Username must be between 2 and 20 characters";
  }
  if (/\s/.test(username)) {
    return "Username cannot contain spaces";
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return "Username can only contain letters, numbers, _ and -";
  }
  return null; // valid
}

// Validate password
export function validatePassword(password: string): string | null {
  if (!password || password.length < 6) {
    return "Password must be at least 6 characters";
  }
  if (password.length > 128) {
    return "Password is too long";
  }
  return null;
}

// Security headers
export const securityHeaders = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
};
