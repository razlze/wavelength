import jwt from "jsonwebtoken";
import { z } from "zod";

const payloadSchema = z.object({
  playerId: z.string(),
  roomId: z.string(),
});

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export type PlayerTokenPayload = z.infer<typeof payloadSchema>;

export function signPlayerToken(payload: PlayerTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: "12h",
  });
}

export function verifyPlayerToken(token: string): PlayerTokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return payloadSchema.parse(decoded);
  } catch {
    return null;
  }
}

