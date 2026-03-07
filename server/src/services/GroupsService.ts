import { prisma } from "./PrismaService";

export class GroupsService {
  static async createGroup(ownerId: string, name: string, description?: string) {
    return prisma.group.create({
      data: {
        name,
        description,
        ownerId,
        members: {
          create: {
            userId: ownerId,
            role: "owner",
          },
        },
      },
      include: {
        members: true,
      },
    });
  }

  static async addMember(groupId: string, requesterId: string, username: string) {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { members: true },
    });

    if (!group) throw new Error("Group not found");

    const requester = group.members.find((m: any) => m.userId === requesterId);
    if (!requester || (requester.role !== "owner" && requester.role !== "admin")) {
      throw new Error("Not authorized to add members");
    }

    const userToAdd = await prisma.user.findUnique({
      where: { username },
    });

    if (!userToAdd) throw new Error("User not found");

    if (group.members.some((m: any) => m.userId === userToAdd.id)) {
      throw new Error("User is already a member");
    }

    return prisma.groupMember.create({
      data: {
        groupId,
        userId: userToAdd.id,
        role: "member",
      },
    });
  }

  static async kickMember(groupId: string, requesterId: string, targetUserId: string) {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { members: true },
    });

    if (!group) throw new Error("Group not found");

    const requester = group.members.find((m: any) => m.userId === requesterId);
    const target = group.members.find((m: any) => m.userId === targetUserId);

    if (!requester || !target) throw new Error("Member not found");
    if (target.role === "owner") throw new Error("Cannot kick the owner");
    if (requesterId === targetUserId) throw new Error("Cannot kick yourself");

    // Owner can kick anyone, admin can only kick members
    if (requester.role === "owner") {
      // OK
    } else if (requester.role === "admin" && target.role === "member") {
      // OK
    } else {
      throw new Error("Not authorized to kick this member");
    }

    return prisma.groupMember.delete({
      where: { id: target.id },
    });
  }

  static async setRole(groupId: string, requesterId: string, targetUserId: string, newRole: "admin" | "member") {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { members: true },
    });

    if (!group) throw new Error("Group not found");

    const requester = group.members.find((m: any) => m.userId === requesterId);
    const target = group.members.find((m: any) => m.userId === targetUserId);

    if (!requester || !target) throw new Error("Member not found");
    if (target.role === "owner") throw new Error("Cannot change owner's role");
    if (requesterId === targetUserId) throw new Error("Cannot change your own role");

    // Only owner can promote/demote admins
    if (requester.role !== "owner") {
      throw new Error("Only the owner can change roles");
    }

    return prisma.groupMember.update({
      where: { id: target.id },
      data: { role: newRole },
    });
  }

  static async renameGroup(groupId: string, requesterId: string, newName: string) {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { members: true },
    });

    if (!group) throw new Error("Group not found");

    const requester = group.members.find((m: any) => m.userId === requesterId);
    if (!requester || (requester.role !== "owner" && requester.role !== "admin")) {
      throw new Error("Not authorized to rename group");
    }

    return prisma.group.update({
      where: { id: groupId },
      data: { name: newName },
    });
  }

  static async leaveGroup(groupId: string, userId: string) {
    const membership = await prisma.groupMember.findUnique({
      where: {
        userId_groupId: { userId, groupId },
      },
    });

    if (!membership) throw new Error("Membership not found");
    if (membership.role === "owner") throw new Error("Owner cannot leave group, delete it instead");

    return prisma.groupMember.delete({
      where: { id: membership.id },
    });
  }

  static async getUserGroups(userId: string) {
    const memberships = await prisma.groupMember.findMany({
      where: { userId },
      include: {
        group: {
          include: {
            members: {
              include: {
                user: {
                  select: { id: true, username: true, avatarUrl: true, status: true },
                },
              },
            },
          },
        },
      },
    });

    return memberships.map((m: any) => m.group);
  }

  static async deleteGroup(groupId: string, requesterId: string) {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
    });

    if (!group) throw new Error("Group not found");
    if (group.ownerId !== requesterId) throw new Error("Only owner can delete group");

    return prisma.group.delete({
      where: { id: groupId },
    });
  }
}
