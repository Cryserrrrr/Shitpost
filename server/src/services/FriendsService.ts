import { prisma } from "./PrismaService";

export class FriendsService {
  static async sendFriendRequest(requesterId: string, addresseeUsername: string) {
    const addressee = await prisma.user.findUnique({
      where: { username: addresseeUsername },
    });

    if (!addressee) {
      throw new Error("User not found");
    }

    if (requesterId === addressee.id) {
      throw new Error("You cannot add yourself as a friend");
    }

    // Check if request already exists
    const existingFriendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId, addresseeId: addressee.id },
          { requesterId: addressee.id, addresseeId: requesterId },
        ],
      },
    });

    if (existingFriendship) {
      if (existingFriendship.status === "accepted") {
        throw new Error("You are already friends");
      }
      throw new Error("Friend request already pending or active");
    }

    return prisma.friendship.create({
      data: {
        requesterId,
        addresseeId: addressee.id,
        status: "pending",
      },
    });
  }

  static async acceptFriendRequest(userId: string, requestId: string) {
    const request = await prisma.friendship.findUnique({
      where: { id: requestId },
    });

    if (!request || request.addresseeId !== userId) {
      throw new Error("Friend request not found or not for you");
    }

    return prisma.friendship.update({
      where: { id: requestId },
      data: { status: "accepted" },
    });
  }

  static async declineFriendRequest(userId: string, requestId: string) {
    const request = await prisma.friendship.findUnique({
      where: { id: requestId },
    });

    if (!request || request.addresseeId !== userId) {
      throw new Error("Friend request not found or not for you");
    }

    return prisma.friendship.delete({
      where: { id: requestId },
    });
  }

  static async removeFriend(userId: string, friendId: string) {
    const friendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: userId, addresseeId: friendId },
          { requesterId: friendId, addresseeId: userId },
        ],
        status: "accepted",
      },
    });

    if (!friendship) {
      throw new Error("Friendship not found");
    }

    return prisma.friendship.delete({
      where: { id: friendship.id },
    });
  }

  static async getFriends(userId: string) {
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [{ requesterId: userId }, { addresseeId: userId }],
        status: "accepted",
      },
      include: {
        requester: {
          select: { id: true, username: true, avatarUrl: true, status: true },
        },
        addressee: {
          select: { id: true, username: true, avatarUrl: true, status: true },
        },
      },
    });

    return friendships.map((f: any) =>
      f.requesterId === userId ? f.addressee : f.requester
    );
  }

  static async getPendingRequests(userId: string) {
    return prisma.friendship.findMany({
      where: {
        addresseeId: userId,
        status: "pending",
      },
      include: {
        requester: {
          select: { id: true, username: true, avatarUrl: true },
        },
      },
    });
  }
}
