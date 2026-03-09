import { Router } from "express";
import { AuthService } from "../services/AuthService";
import { authMiddleware } from "../middleware/AuthMiddleware";
import { sanitizeString, validateUsername, validatePassword } from "../middleware/SecurityMiddleware";
import { prisma } from "../services/PrismaService";

const router = Router();

// Public routes
router.post("/register", async (req, res) => {
  try {
    const username = sanitizeString(req.body.username, 20);
    const password = req.body.password;

    const usernameError = validateUsername(username);
    if (usernameError) return res.status(400).json({ message: usernameError });

    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ message: passwordError });

    const result = await AuthService.register({ username, password });
    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const username = sanitizeString(req.body.username, 20);
    const password = req.body.password;

    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }

    const result = await AuthService.login({ username, password });
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

// Account deletion (RGPD)
router.delete("/account", authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ message: "Password required to delete account" });
    }

    // Verify password before deletion
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ message: "User not found" });

    const isMatch = await AuthService.comparePassword(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid password" });

    // Cascade delete handles friendships, group memberships, tokens, etc.
    await prisma.user.delete({ where: { id: userId } });

    console.log(`[ACCOUNT] User ${user.username} deleted their account`);
    res.json({ message: "Account deleted successfully" });
  } catch (error: any) {
    console.error("[ACCOUNT] Deletion error:", error.message);
    res.status(500).json({ message: "Failed to delete account" });
  }
});

export default router;
