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

router.post("/:id/members", async (req, res) => {
  try {
    const { username } = req.body;
    const result = await GroupsService.addMember(req.params.id, (req as any).userId, username);
    res.status(201).json(result);
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
