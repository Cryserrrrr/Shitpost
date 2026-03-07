import bcrypt from "bcryptjs";
// @ts-ignore
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "./PrismaService";

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-key-for-dev-only";
const ACCESS_TOKEN_EXPIRES_IN = "1h";
const REFRESH_TOKEN_DAYS = 30;

export class AuthService {
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  static async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  static generateAccessToken(userId: string): string {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES_IN });
  }

  static verifyToken(token: string): any {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (error) {
      return null;
    }
  }

  static async generateRefreshToken(userId: string): Promise<string> {
    const token = crypto.randomBytes(64).toString("hex");
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: { token, userId, expiresAt },
    });

    return token;
  }

  static async refreshAccessToken(refreshToken: string) {
    const stored = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: { select: { id: true, username: true, avatarUrl: true, status: true } } },
    });

    if (!stored) {
      throw new Error("Invalid refresh token");
    }

    if (stored.expiresAt < new Date()) {
      await prisma.refreshToken.delete({ where: { id: stored.id } });
      throw new Error("Refresh token expired");
    }

    // Rotate: delete old, create new
    await prisma.refreshToken.delete({ where: { id: stored.id } });

    const newAccessToken = this.generateAccessToken(stored.userId);
    const newRefreshToken = await this.generateRefreshToken(stored.userId);

    return {
      token: newAccessToken,
      refreshToken: newRefreshToken,
      user: stored.user,
    };
  }

  static async revokeRefreshTokens(userId: string) {
    await prisma.refreshToken.deleteMany({ where: { userId } });
  }

  static async register(data: any) {
    const { username, password } = data;

    const existingUser = await prisma.user.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
    });

    if (existingUser) {
      throw new Error("Username already taken");
    }

    const hashedPassword = await this.hashPassword(password);

    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        status: "online",
      },
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        status: true,
      },
    });

    const token = this.generateAccessToken(user.id);
    const refreshToken = await this.generateRefreshToken(user.id);

    return { user, token, refreshToken };
  }

  static async login(data: any) {
    const { username, password } = data;

    const user = await prisma.user.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
    });

    if (!user) {
      throw new Error("Invalid credentials");
    }

    const isMatch = await this.comparePassword(password, user.password);

    if (!isMatch) {
      throw new Error("Invalid credentials");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { status: "online" },
    });

    const token = this.generateAccessToken(user.id);
    const refreshToken = await this.generateRefreshToken(user.id);

    const { password: _, ...userWithoutPassword } = user;

    return { user: userWithoutPassword, token, refreshToken };
  }

  static async logout(userId: string) {
    await this.revokeRefreshTokens(userId);
    return prisma.user.update({
      where: { id: userId },
      data: { status: "offline" },
    });
  }

  static async me(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        status: true,
      },
    });
  }
}
