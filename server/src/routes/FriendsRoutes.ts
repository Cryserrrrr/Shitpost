import { Router } from "express";
import { FriendsService } from "../services/FriendsService";
import { cacheDel } from "../services/RedisService";
import { authMiddleware } from "../middleware/AuthMiddleware";
import { sanitizeString } from "../middleware/SecurityMiddleware";

const router = Router();

router.use(authMiddleware);

router.post("/request", async (req, res) => {
  try {
    const username = sanitizeString(req.body.username, 20);
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
    const code = sanitizeString(req.body.code, 20);
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

    // Invalidate friends cache for both users
    await cacheDel(`friends:${(req as any).userId}`);
    await cacheDel(`friends:${result.requesterId}`);

    const io = req.app.get("io");
    const { prisma } = await import("../services/PrismaService");
    const userSockets: Map<string, string[]> = req.app.get("userSockets");

    const [accepter, requester] = await Promise.all([
      prisma.user.findUnique({ where: { id: (req as any).userId }, select: { id: true, username: true, status: true } }),
      prisma.user.findUnique({ where: { id: result.requesterId }, select: { id: true, username: true, status: true } }),
    ]);

    if (io && accepter && requester) {
      const accepterOnline = userSockets.has(accepter.id);
      const requesterOnline = userSockets.has(requester.id);

      // Notify the requester: add accepter to their friend list with online status
      io.to(`user:${result.requesterId}`).emit("friends:request_accepted", {
        friend: accepter,
        online: accepterOnline,
        dnd: accepter.status === "dnd",
      });

      // Notify the accepter: add requester to their friend list with online status
      io.to(`user:${(req as any).userId}`).emit("friends:request_accepted", {
        friend: requester,
        online: requesterOnline,
        dnd: requester.status === "dnd",
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
    // Invalidate friends cache for both users
    await cacheDel(`friends:${(req as any).userId}`);
    await cacheDel(`friends:${req.params.id}`);

    // Notify the other user in real-time
    const io = req.app.get("io");
    if (io) {
      io.to(`user:${req.params.id}`).emit("friends:removed", {
        userId: (req as any).userId,
      });
    }

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

// Block a user
router.post("/block/:id", async (req, res) => {
  try {
    const result = await FriendsService.blockUser((req as any).userId, req.params.id);

    // Invalidate friends cache for both users
    await cacheDel(`friends:${(req as any).userId}`);
    await cacheDel(`friends:${req.params.id}`);

    // Notify the blocked user in real-time (remove from their friend list)
    const io = req.app.get("io");
    if (io) {
      io.to(`user:${req.params.id}`).emit("friends:removed", {
        userId: (req as any).userId,
      });
    }

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Unblock a user
router.post("/unblock/:id", async (req, res) => {
  try {
    const result = await FriendsService.unblockUser((req as any).userId, req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get blocked users
router.get("/blocked", async (req, res) => {
  try {
    const { prisma } = await import("../services/PrismaService");
    const blocked = await prisma.friendship.findMany({
      where: { requesterId: (req as any).userId, status: "blocked" },
      include: { addressee: { select: { id: true, username: true } } },
    });
    res.json(blocked.map((b: any) => b.addressee));
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
