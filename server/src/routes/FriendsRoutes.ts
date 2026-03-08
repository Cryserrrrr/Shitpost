import { Router } from "express";
import { FriendsService } from "../services/FriendsService";
import { authMiddleware } from "../middleware/AuthMiddleware";

const router = Router();

router.use(authMiddleware);

router.post("/request", async (req, res) => {
  try {
    const { username } = req.body;
    const result = await FriendsService.sendFriendRequest((req as any).userId, username);

    // Notify the target user in real-time
    const io = req.app.get("io");
    if (io) {
      const sender = await import("../services/PrismaService").then(m =>
        m.prisma.user.findUnique({ where: { id: (req as any).userId }, select: { id: true, username: true } })
      );
      io.to(`user:${result.addresseeId}`).emit("friends:request_received", {
        id: result.id,
        requesterId: result.requesterId,
        requester: sender,
        status: "pending",
      });
    }

    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/add-direct", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: "Invite code required" });

    const result = await FriendsService.addFriendByCode((req as any).userId, code);

    // Notify the target user of the friend request
    const io = req.app.get("io");
    if (io) {
      const sender = await import("../services/PrismaService").then(m =>
        m.prisma.user.findUnique({ where: { id: (req as any).userId }, select: { id: true, username: true } })
      );
      io.to(`user:${result.addresseeId}`).emit("friends:request_received", {
        id: result.id,
        requesterId: result.requesterId,
        requester: sender,
        status: "pending",
      });
    }

    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Resolve invite code to username (for preview before sending request)
router.get("/resolve/:code", async (req, res) => {
  try {
    const { prisma } = await import("../services/PrismaService");
    const user = await prisma.user.findUnique({
      where: { inviteCode: req.params.code },
      select: { username: true },
    });
    if (!user) return res.status(404).json({ message: "Invalid invite code" });
    res.json({ username: user.username });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get my invite code
router.get("/invite-code", async (req, res) => {
  try {
    const { prisma } = await import("../services/PrismaService");
    const user = await prisma.user.findUnique({
      where: { id: (req as any).userId },
      select: { inviteCode: true },
    });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ inviteCode: user.inviteCode });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/accept/:id", async (req, res) => {
  try {
    const result = await FriendsService.acceptFriendRequest((req as any).userId, req.params.id);

    // Notify the requester that their request was accepted
    const io = req.app.get("io");
    if (io) {
      const accepter = await import("../services/PrismaService").then(m =>
        m.prisma.user.findUnique({ where: { id: (req as any).userId }, select: { id: true, username: true, status: true } })
      );
      io.to(`user:${result.requesterId}`).emit("friends:request_accepted", {
        friend: accepter,
      });
    }

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/decline/:id", async (req, res) => {
  try {
    const result = await FriendsService.declineFriendRequest((req as any).userId, req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await FriendsService.removeFriend((req as any).userId, req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const friends = await FriendsService.getFriends((req as any).userId);
    res.json(friends);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/pending", async (req, res) => {
  try {
    const pending = await FriendsService.getPendingRequests((req as any).userId);
    res.json(pending);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
