import { Router } from "express";
import { AuthService } from "../services/AuthService";
import { authMiddleware } from "../middleware/AuthMiddleware";

const router = Router();

// Public routes
router.post("/register", async (req, res) => {
  try {
    const result = await AuthService.register(req.body);
    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const result = await AuthService.login(req.body);
    res.json(result);
  } catch (error: any) {
    res.status(401).json({ message: error.message });
  }
});

router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: "Refresh token required" });
    }
    const result = await AuthService.refreshAccessToken(refreshToken);
    res.json(result);
  } catch (error: any) {
    res.status(401).json({ message: error.message });
  }
});

// Protected routes
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await AuthService.me((req as any).userId);
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/logout", authMiddleware, async (req, res) => {
  try {
    await AuthService.logout((req as any).userId);
    res.json({ message: "Logged out successfully" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
