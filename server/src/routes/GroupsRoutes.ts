import { Router } from "express";
import { GroupsService } from "../services/GroupsService";
import { authMiddleware } from "../middleware/AuthMiddleware";

const router = Router();

router.use(authMiddleware);

router.post("/", async (req, res) => {
  try {
    const { name, description } = req.body;
    const result = await GroupsService.createGroup((req as any).userId, name, description);
    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const groups = await GroupsService.getUserGroups((req as any).userId);
    res.json(groups);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Invite a member (replaces direct add)
router.post("/:id/members", async (req, res) => {
  try {
    const { username } = req.body;
    const result = await GroupsService.inviteMember(req.params.id, (req as any).userId, username);

    // Notify invitee in real-time
    const io = req.app.get("io");
    if (io) {
      io.to(`user:${result.invitee.id}`).emit("groups:invite_received", {
        id: result.id,
        group: result.group,
        inviter: result.inviter,
      });
    }

    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get pending invites for current user
router.get("/invites/pending", async (req, res) => {
  try {
    const invites = await GroupsService.getPendingInvites((req as any).userId);
    res.json(invites);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Accept invite
router.post("/invites/:id/accept", async (req, res) => {
  try {
    const invite = await GroupsService.acceptInvite(req.params.id, (req as any).userId);

    // Notify group members that someone joined
    const io = req.app.get("io");
    if (io) {
      const { prisma } = await import("../services/PrismaService");
      const user = await prisma.user.findUnique({
        where: { id: (req as any).userId },
        select: { id: true, username: true },
      });
      // Notify all group members
      const members = await prisma.groupMember.findMany({
        where: { groupId: invite.groupId },
        select: { userId: true },
      });
      for (const m of members) {
        io.to(`user:${m.userId}`).emit("groups:member_joined", {
          groupId: invite.groupId,
          user,
        });
      }
    }

    res.json(invite);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Join group via invite code (from deep link)
router.post("/join/:code", async (req, res) => {
  try {
    const { prisma } = await import("../services/PrismaService");
    const group = await prisma.group.findUnique({
      where: { inviteCode: req.params.code },
      select: { id: true, name: true, members: { select: { userId: true } } },
    });
    if (!group) return res.status(404).json({ message: "Invalid invite code" });

    const userId = (req as any).userId;
    if (group.members.some((m: any) => m.userId === userId)) {
      return res.status(400).json({ message: "Already a member" });
    }

    await prisma.groupMember.create({
      data: { groupId: group.id, userId, role: "member" },
    });

    // Notify group members
    const io = req.app.get("io");
    if (io) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
      for (const m of group.members) {
        io.to(`user:${m.userId}`).emit("groups:member_joined", { groupId: group.id, user });
      }
    }

    res.json({ groupId: group.id, groupName: group.name });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Resolve an invite link (get info without joining)
router.get("/resolve/:code", async (req, res) => {
  try {
    const { prisma } = await import("../services/PrismaService");
    const group = await prisma.group.findUnique({
      where: { inviteCode: req.params.code },
      select: { id: true, name: true, _count: { select: { members: true } } },
    });
    if (!group) return res.status(404).json({ message: "Invalid invite code" });
    res.json({ type: "group", groupId: group.id, groupName: group.name, memberCount: group._count.members });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Decline invite
router.post("/invites/:id/decline", async (req, res) => {
  try {
    const result = await GroupsService.declineInvite(req.params.id, (req as any).userId);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.delete("/:id/members/:userId", async (req, res) => {
  try {
    const result = await GroupsService.kickMember(req.params.id, (req as any).userId, req.params.userId);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.patch("/:id/members/:userId/role", async (req, res) => {
  try {
    const { role } = req.body;
    if (role !== "admin" && role !== "member") {
      return res.status(400).json({ message: "Invalid role" });
    }
    const result = await GroupsService.setRole(req.params.id, (req as any).userId, req.params.userId, role);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Name is required" });
    const result = await GroupsService.renameGroup(req.params.id, (req as any).userId, name);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/:id/leave", async (req, res) => {
  try {
    const result = await GroupsService.leaveGroup(req.params.id, (req as any).userId);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await GroupsService.deleteGroup(req.params.id, (req as any).userId);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

export default router;
