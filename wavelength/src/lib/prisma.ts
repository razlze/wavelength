import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgAdapter: PrismaPg | undefined;
};

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  const pg =
    globalForPrisma.pgAdapter ??
    new PrismaPg({ connectionString: url, max: 10 });
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.pgAdapter = pg;
  }
  return new PrismaClient({ adapter: pg });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
