import { prisma } from "../src/core/prisma.js";
import { Severity } from "../src/generated/prisma/enums.js";

/**
 * Inserts the service categories and their pricing bands, and nothing else.
 *
 * This exists because `prisma/seed.ts` cannot be run on a database that holds
 * real data: it opens by TRUNCATEing every table. That is right for a
 * development database being refilled with fake data, and catastrophic on a
 * deployed one.
 *
 * So this script is the safe half. It only ever upserts, so:
 *
 *   - no row is deleted, and no id is reset
 *   - running it twice changes nothing the second time
 *   - a category someone added by hand is left alone unless the name matches
 *
 * Run it against a deployed database when signup starts failing with
 * "A record this refers to does not exist" - that is a `categoryId` pointing
 * at a categories table that was never populated, because migrations run on
 * every deploy but seeds do not.
 *
 *   npx tsx prisma/seed-categories.ts
 *
 * Or in Docker, against the same database the app uses:
 *
 *   docker compose run --rm migrate npx tsx prisma/seed-categories.ts
 *
 * The list is kept identical to CATEGORIES in seed.ts on purpose - a technician
 * seeded locally under "سباكة" should mean the same thing in production.
 *
 * **These four names are a contract with the AI service, not a display choice.**
 * Its `CATEGORY_MAP` knows exactly these four and answers `400 Unsupported
 * category` to anything else, so `Category.name` is what gets sent to
 * `/predict` unchanged - see the contract in src/modules/ai/ai.client.ts. The
 * colloquial spellings are *not* interchangeable with them: `كهربا` and `نقاشة`
 * are both rejected, where `كهرباء` and `دهانات` are accepted. Adding a fifth
 * category here means training a fifth model first; until then it would take
 * customers' points and fail every estimate.
 */
const CATEGORIES = [
  { name: "سباكة", base: 150 },
  { name: "كهرباء", base: 150 },
  { name: "نجارة", base: 160 },
  { name: "دهانات", base: 140 },
];

/** Multipliers on the base price, in order. Bands touch but never overlap. */
const SEVERITY_BANDS: Record<Severity, { min: number; max: number }> = {
  SMALL: { min: 1, max: 2.5 },
  MEDIUM: { min: 2.5, max: 6 },
  LARGE: { min: 6, max: 15 },
};

async function main() {
  let created = 0;
  let alreadyThere = 0;

  for (const { name, base } of CATEGORIES) {
    const existing = await prisma.category.findUnique({ where: { name } });

    // `name` is unique, so it is what identifies a category across databases -
    // ids are not comparable between a seeded local database and a deployed one.
    const category = await prisma.category.upsert({
      where: { name },
      // Deliberately empty: an admin may have adjusted the price in the console,
      // and re-running this script must not undo that.
      update: {},
      create: { name, homeVisitBasePrice: base },
    });

    existing ? alreadyThere++ : created++;

    for (const [severity, band] of Object.entries(SEVERITY_BANDS)) {
      await prisma.categoryPricing.upsert({
        where: {
          categoryId_severity: {
            categoryId: category.id,
            severity: severity as Severity,
          },
        },
        update: {},
        create: {
          categoryId: category.id,
          severity: severity as Severity,
          minPrice: base * band.min,
          maxPrice: base * band.max,
        },
      });
    }
  }

  const all = await prisma.category.findMany({
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });

  console.log(`Created ${created}, already present ${alreadyThere}.`);
  console.log("\nUse one of these ids as `categoryId` when signing up:\n");
  for (const { id, name } of all) {
    console.log(`  ${id.toString().padStart(3)}  ${name}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
