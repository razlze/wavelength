import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../src/generated/prisma/client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required for seed");
const pool = new Pool({ connectionString: url });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const count = await prisma.themePreset.count();
  if (count > 0) {
    console.log("Theme presets already seeded.");
    return;
  }
  const pairs: [string, string][] = [
    ["Hot", "Cold"],
    ["Easy", "Hard"],
    ["Good movie", "Bad movie"],
    ["Useful invention", "Useless invention"],
    ["Everyone loves it", "Nobody likes it"],
    ["Low tech", "High tech"],
    ["Underrated", "Overrated"],
  ];
  await prisma.themePreset.createMany({
    data: pairs.map(([leftLabel, rightLabel]) => ({ leftLabel, rightLabel })),
  });
  console.log("Seeded theme presets.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
