import { Router } from "express";
import { FriendsService } from "../services/FriendsService";
import { authMiddleware } from "../middleware/AuthMiddleware";

const router = Router();

router.use(authMiddleware);

router.post("/request", async (req, res) => {
  try {
    const { username } = req.body;
    const result = await FriendsService.sendFriendRequest((req as any).userId, username);
    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/accept/:id", async (req, res) => {
  try {
    const result = await FriendsService.acceptFriendRequest((req as any).userId, req.params.id);
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
