/**
 * Fake data for local development.
 *
 *   npm run prisma:seed          (or: npx prisma db seed)
 *
 * The seed **wipes every table first**, then fills the database from scratch,
 * so it is safe to run over and over. `faker.seed(...)` below pins the random
 * generator, which means two runs produce exactly the same rows - handy when
 * you are comparing API responses or writing docs against fixed ids.
 *
 * Everything it writes is meant to be *consistent*, not just non-null:
 *
 *   - a PENDING user has no name/city yet, because that is what a real user
 *     looks like right after the phone is verified
 *   - a technician is only ACTIVE if their documents are VERIFIED
 *   - a request past TECHNICIAN_SELECTED always has a technician, and exactly
 *     one SELECTED offer; the rest are NOT_SELECTED
 *   - only COMPLETED requests carry reviews, and every price sits inside the
 *     category's own pricing band
 *   - technician_profiles.overall_rating / total_reviews are recomputed from
 *     the reviews that were actually written
 */
import "dotenv/config";
import { faker } from "@faker-js/faker";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { pgConnectionConfig } from "../src/core/db-url.js";
import { governorateCodes } from "../src/core/national-id.js";
import {
  OfferStatus,
  RequestStatus,
  RequestType,
  Severity,
  UserRole,
  UserStatus,
  VerificationStatus,
} from "../src/generated/prisma/enums.js";

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

const CONFIG = {
  /** Change this to get a different - but still reproducible - dataset. */
  randomSeed: 20260802,
  admins: 2,
  customers: 40,
  /**
   * Of those customers, how many stop right after verifying their phone.
   * Fixed rather than random: these are the rows the onboarding screens are
   * tested against, so "roll the dice and hope for a few" is not good enough.
   */
  pendingCustomers: 6,
  /** Technicians who finished the sign-up form (they get a profile row). */
  technicians: 24,
  /** Picked "technician" but never uploaded documents -> SUBMIT_DOCUMENTS. */
  techniciansWithoutDocuments: 4,
  requestsPerCustomer: { min: 0, max: 5 },
  /** How far back the oldest rows are dated. */
  historyDays: 120,
};

/**
 * Three fixed accounts with memorable phones, so the curl examples in the
 * README have something to hit without looking ids up first.
 */
const FIXTURES = {
  admin: "+201000000001",
  customer: "+201000000002",
  technician: "+201000000003",
};

// ---------------------------------------------------------------------------
// Egyptian flavour - the app's docs use Cairo/Giza addresses, so the fake data
// does too. Coordinates are the city centre; each user is scattered around it.
// ---------------------------------------------------------------------------

const CITIES = [
  { name: "Cairo", latitude: 30.0444, longitude: 31.2357 },
  { name: "Giza", latitude: 30.0131, longitude: 31.2089 },
  { name: "Alexandria", latitude: 31.2001, longitude: 29.9187 },
  { name: "Shubra El Kheima", latitude: 30.1286, longitude: 31.2422 },
  { name: "Mansoura", latitude: 31.0409, longitude: 31.3785 },
  { name: "Tanta", latitude: 30.7865, longitude: 31.0004 },
  { name: "Port Said", latitude: 31.2653, longitude: 32.3019 },
  { name: "Suez", latitude: 29.9668, longitude: 32.5498 },
  { name: "Ismailia", latitude: 30.6043, longitude: 32.2723 },
  { name: "Asyut", latitude: 27.1783, longitude: 31.1859 },
  { name: "Luxor", latitude: 25.6872, longitude: 32.6396 },
  { name: "Aswan", latitude: 24.0889, longitude: 32.8998 },
];

const FIRST_NAMES = [
  "Mona", "Karim", "Ahmed", "Mahmoud", "Youssef", "Omar", "Hassan", "Sara",
  "Nour", "Salma", "Mostafa", "Amr", "Heba", "Dina", "Tarek", "Rania",
  "Khaled", "Mai", "Ali", "Fatma", "Ibrahim", "Aya", "Sherif", "Yara",
  "Mohamed", "Hana", "Islam", "Reem", "Ashraf", "Basma", "Hazem", "Nada",
];

const LAST_NAMES = [
  "Ali", "Fathy", "Hassan", "Ibrahim", "Mansour", "Abdelrahman", "Saleh",
  "Farouk", "Ezzat", "Shafik", "Nasser", "Zaki", "Sabry", "Gaber", "Kamel",
  "Radwan", "Hamdy", "Serag", "Wasfy", "Adel", "Sami", "Lotfy",
];

const STREETS = [
  "Nile", "Tahrir", "Ramses", "El Haram", "Gameat El Dowal", "Abbas El Akkad",
  "El Merghany", "Makram Ebeid", "El Batal Ahmed Abdel Aziz", "Faisal",
  "El Nasr", "Salah Salem", "Port Said", "El Thawra", "Mostafa El Nahas",
];

const DISTRICTS = [
  "Nasr City", "Maadi", "Heliopolis", "Zamalek", "Dokki", "Mohandessin",
  "Shubra", "6th of October", "New Cairo", "Agouza", "Haram", "Sheikh Zayed",
];

/**
 * The service catalogue. `base` is the home-visit call-out fee in EGP; the
 * three severity bands are derived from it so a LARGE job always costs more
 * than a MEDIUM one, in every category.
 */
const CATEGORIES = [
  { name: "Plumbing", base: 150 },
  { name: "Electrical", base: 150 },
  { name: "Air Conditioning", base: 200 },
  { name: "Appliance Repair", base: 180 },
  { name: "Carpentry", base: 160 },
  { name: "Painting", base: 140 },
  { name: "Home Cleaning", base: 120 },
  { name: "Pest Control", base: 200 },
  { name: "Satellite & Antenna", base: 130 },
  { name: "Locksmith", base: 170 },
  { name: "Water Heaters & Gas", base: 180 },
  { name: "Aluminium & Glass", base: 190 },
];

/** Multipliers on the base price, in order. Bands touch but never overlap. */
const SEVERITY_BANDS: Record<Severity, { min: number; max: number }> = {
  SMALL: { min: 1, max: 2.5 },
  MEDIUM: { min: 2.5, max: 6 },
  LARGE: { min: 6, max: 15 },
};

/** One realistic complaint per category, so descriptions are not lorem soup. */
const COMPLAINTS: Record<string, string[]> = {
  Plumbing: [
    "Kitchen sink is leaking under the cabinet and the floor stays wet.",
    "Bathroom drain is completely blocked, water is not going down at all.",
    "The mixer tap drips all night even when fully closed.",
  ],
  Electrical: [
    "The main breaker trips whenever the washing machine starts.",
    "Two sockets in the bedroom stopped working after a power cut.",
    "Lights in the hallway flicker and there is a burning smell.",
  ],
  "Air Conditioning": [
    "Split unit is running but blowing warm air only.",
    "The indoor unit drips water on the wall.",
    "AC needs a full cleaning and freon check before summer.",
  ],
  "Appliance Repair": [
    "Washing machine does not spin and shows an error code.",
    "The fridge is not cooling in the lower section.",
    "Oven heats up then shuts down after ten minutes.",
  ],
  Carpentry: [
    "Kitchen cabinet door came off its hinges.",
    "Bedroom door does not close properly since the humidity.",
    "Need shelves installed in the living room wall.",
  ],
  Painting: [
    "Living room walls need repainting after a water leak.",
    "Two bedrooms need a fresh coat, walls are 4x5 metres each.",
    "Ceiling has damp stains that need treatment then paint.",
  ],
  "Home Cleaning": [
    "Deep cleaning needed for a 3 bedroom flat after renovation.",
    "Sofa and carpets need steam cleaning.",
    "Post-construction dust everywhere, needs a full team.",
  ],
  "Pest Control": [
    "Cockroaches in the kitchen despite over-the-counter sprays.",
    "Ants coming from the balcony door every morning.",
    "Suspected bed bugs in one bedroom.",
  ],
  "Satellite & Antenna": [
    "No signal on the receiver since the last storm.",
    "Need a new dish installed and aligned on the roof.",
    "Half of the channels disappeared after a reset.",
  ],
  Locksmith: [
    "Key broke inside the main door lock.",
    "Need the apartment lock replaced with a security one.",
    "The door handle turns but the latch does not move.",
  ],
  "Water Heaters & Gas": [
    "Gas water heater does not ignite, only clicking sound.",
    "Hot water goes cold after two minutes.",
    "Smell of gas near the heater, needs an urgent check.",
  ],
  "Aluminium & Glass": [
    "Balcony sliding door is off its track and hard to move.",
    "Window glass cracked and needs replacing.",
    "Shower cabin glass door does not seal, water leaks out.",
  ],
};

/**
 * The one-line version of a complaint, for `ServiceRequest.title` (task 7).
 *
 * Every sentence above leads with what is wrong and then adds the detail after
 * a comma or an "and", so the first clause is the headline - which is exactly
 * what one row of the past-orders list has room to print.
 */
function titleFrom(complaint: string) {
  return complaint.replace(/\.$/, "").split(/,| and /)[0].slice(0, 120);
}

const CUSTOMER_COMMENTS = [
  "Arrived on time and finished quickly, very professional.",
  "Good work overall, but he was about half an hour late.",
  "Explained the problem clearly before starting. Fair price.",
  "Fixed it from the first visit, no mess left behind.",
  "Decent job, though I expected a lower price for this.",
  "Very polite and careful with the furniture.",
  "Had to come back a second time, but the issue is solved now.",
  "Excellent, would definitely request him again.",
];

const TECHNICIAN_COMMENTS = [
  "Customer was cooperative and the address was easy to find.",
  "Everything was ready when I arrived, smooth job.",
  "Had to wait 20 minutes at the door.",
  "Polite customer, paid immediately after the work.",
  "The problem was bigger than described in the request.",
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Prices are Decimal columns - keep them as fixed strings, never floats. */
const money = (value: number) => value.toFixed(2);

/** Decimal(10,8) / Decimal(11,8) columns; 6 places is street-level precision. */
const coord = (value: number) => value.toFixed(6);

const minutesAfter = (date: Date, minutes: number) =>
  new Date(date.getTime() + minutes * 60_000);

const hoursAfter = (date: Date, hours: number) => minutesAfter(date, hours * 60);

/** Round to the nearest 10 EGP so the catalogue looks hand-written. */
const roundTo10 = (value: number) => Math.round(value / 10) * 10;

const fullName = () =>
  `${faker.helpers.arrayElement(FIRST_NAMES)} ${faker.helpers.arrayElement(LAST_NAMES)}`;

/**
 * Egyptian mobile numbers: +20 1[0125] then 8 digits. Kept unique by hand,
 * because `phone` is the app's only identity and is unique in the schema.
 */
const usedPhones = new Set<string>(Object.values(FIXTURES));

function uniquePhone(): string {
  for (;;) {
    const phone = `+201${faker.helpers.arrayElement(["0", "1", "2", "5"])}${faker.string.numeric(8)}`;
    if (!usedPhones.has(phone)) {
      usedPhones.add(phone);
      return phone;
    }
  }
}

/** A city plus a random point a few kilometres around its centre. */
function somewhereInEgypt() {
  const city = faker.helpers.arrayElement(CITIES);
  return {
    city: city.name,
    address: `${faker.number.int({ min: 1, max: 140 })} ${faker.helpers.arrayElement(STREETS)} St, ${faker.helpers.arrayElement(DISTRICTS)}`,
    latitude: coord(city.latitude + faker.number.float({ min: -0.08, max: 0.08, fractionDigits: 6 })),
    longitude: coord(city.longitude + faker.number.float({ min: -0.08, max: 0.08, fractionDigits: 6 })),
  };
}

/**
 * A national id that passes the rules in src/core/national-id.ts: the century
 * digit, a real birth date, a real governorate, then the serial and check
 * digit. Seeded technicians have to survive the API's own validation, or the
 * first thing an admin sees in the approval queue is data the app would have
 * rejected.
 */
function nationalId(): string {
  const birthDate = faker.date.birthdate({ mode: "age", min: 21, max: 60 });

  const century = birthDate.getUTCFullYear() < 2000 ? "2" : "3";
  const year = String(birthDate.getUTCFullYear() % 100).padStart(2, "0");
  const month = String(birthDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(birthDate.getUTCDate()).padStart(2, "0");
  const governorate = faker.helpers.arrayElement(governorateCodes);

  // Four digits of serial and the check digit, which nothing verifies.
  return `${century}${year}${month}${day}${governorate}${faker.string.numeric(5)}`;
}

/** Looks like what POST /public/uploads hands back - see docs/APP-FLOW.md. */
function uploadPath(label: string, extension: string) {
  return `/uploads/${faker.number.int({ min: 1_700_000_000, max: 1_800_000_000 })}-${label}.${extension}`;
}

function pastDate() {
  return faker.date.recent({ days: CONFIG.historyDays });
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(pgConnectionConfig(connectionString)),
  // The seed writes thousands of rows; query logging would drown the output.
  log: ["error"],
});

// ---------------------------------------------------------------------------
// 1. Wipe
// ---------------------------------------------------------------------------

/**
 * Children first is unnecessary with CASCADE, but the list doubles as a map of
 * the schema. RESTART IDENTITY resets the BigInt sequences, so ids start at 1
 * again on every run and the ids in the docs keep pointing at the same rows.
 */
const TABLES = [
  "customer_reviews",
  "technician_reviews",
  "technician_offers",
  "ai_estimations",
  "request_attachments",
  "service_requests",
  "technician_profiles",
  "category_pricing",
  "categories",
  "otp",
  "users",
];

async function resetDatabase() {
  const target = new URL(connectionString!);
  console.log(
    `Wiping ${target.pathname.replace("/", "")} on ${target.host} ...`,
  );

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((table) => `"public"."${table}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

// ---------------------------------------------------------------------------
// 2. Categories + pricing
// ---------------------------------------------------------------------------

type SeededCategory = {
  id: bigint;
  name: string;
  homeVisitBasePrice: number;
  /** The price band per severity, kept in memory to keep later rows honest. */
  bands: Record<Severity, { min: number; max: number }>;
};

async function seedCategories(): Promise<SeededCategory[]> {
  const seeded: SeededCategory[] = [];

  for (const { name, base } of CATEGORIES) {
    const bands = {
      SMALL: {
        min: roundTo10(base * SEVERITY_BANDS.SMALL.min),
        max: roundTo10(base * SEVERITY_BANDS.SMALL.max),
      },
      MEDIUM: {
        min: roundTo10(base * SEVERITY_BANDS.MEDIUM.min),
        max: roundTo10(base * SEVERITY_BANDS.MEDIUM.max),
      },
      LARGE: {
        min: roundTo10(base * SEVERITY_BANDS.LARGE.min),
        max: roundTo10(base * SEVERITY_BANDS.LARGE.max),
      },
    } satisfies Record<Severity, { min: number; max: number }>;

    const createdAt = faker.date.past({ years: 1 });

    // The three pricing rows are written with the category itself - the schema
    // has a unique (category_id, severity), so exactly one row per severity.
    const category = await prisma.category.create({
      data: {
        name,
        homeVisitBasePrice: money(base),
        createdAt,
        updatedAt: createdAt,
        pricing: {
          create: (Object.keys(bands) as Severity[]).map((severity) => ({
            severity,
            minPrice: money(bands[severity].min),
            maxPrice: money(bands[severity].max),
            createdAt,
            updatedAt: createdAt,
          })),
        },
      },
    });

    seeded.push({
      id: category.id,
      name,
      homeVisitBasePrice: base,
      bands,
    });
  }

  return seeded;
}

// ---------------------------------------------------------------------------
// 3. Users (+ technician profiles)
// ---------------------------------------------------------------------------

type SeededUser = {
  id: bigint;
  phone: string;
  status: UserStatus;
  createdAt: Date;
  city: string;
  latitude: string;
  longitude: string;
};

type SeededTechnician = SeededUser & {
  categoryId: bigint;
  verified: boolean;
};

/**
 * A user row for someone who has verified their phone but not filled anything
 * in yet: name, city, address and location are all still null. Half the point
 * of the seed is having these around to test the onboarding screens.
 */
function pendingUserData(phone: string) {
  return {
    phone,
    role: UserRole.CUSTOMER,
    status: UserStatus.PENDING,
    createdAt: faker.date.recent({ days: 7 }),
  };
}

async function seedUsers(categories: SeededCategory[]) {
  const admins: SeededUser[] = [];
  const customers: SeededUser[] = [];
  const technicians: SeededTechnician[] = [];
  /** Signed up, never finished onboarding - no profile fields at all. */
  const pendingUsers: SeededUser[] = [];

  const toSeededUser = (user: {
    id: bigint;
    phone: string;
    status: UserStatus;
    createdAt: Date;
    city: string | null;
    latitude: unknown;
    longitude: unknown;
  }): SeededUser => ({
    id: user.id,
    phone: user.phone,
    status: user.status,
    createdAt: user.createdAt,
    city: user.city ?? "",
    latitude: String(user.latitude ?? "0"),
    longitude: String(user.longitude ?? "0"),
  });

  // --- admins -------------------------------------------------------------
  for (let index = 0; index < CONFIG.admins; index += 1) {
    const location = somewhereInEgypt();
    const createdAt = faker.date.past({ years: 1 });

    const admin = await prisma.user.create({
      data: {
        ...location,
        phone: index === 0 ? FIXTURES.admin : uniquePhone(),
        fullName: fullName(),
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        createdAt,
        updatedAt: createdAt,
      },
    });

    admins.push(toSeededUser(admin));
  }

  // --- customers ----------------------------------------------------------
  // Most are ACTIVE (finished onboarding). A slice is still PENDING, and a few
  // were moderated, so the admin list and its filters have something to show.
  for (let index = 0; index < CONFIG.customers; index += 1) {
    // Index 0 is the fixed test account; the next few are deliberately left
    // half-signed-up, and the rest are the usual mix.
    const status =
      index === 0
        ? UserStatus.ACTIVE
        : index <= CONFIG.pendingCustomers
          ? UserStatus.PENDING
          : faker.helpers.weightedArrayElement([
              { value: UserStatus.ACTIVE, weight: 85 },
              { value: UserStatus.BLOCKED, weight: 8 },
              { value: UserStatus.SUSPENDED, weight: 7 },
            ]);

    const phone = index === 0 ? FIXTURES.customer : uniquePhone();

    if (status === UserStatus.PENDING) {
      const user = await prisma.user.create({ data: pendingUserData(phone) });
      pendingUsers.push(toSeededUser(user));
      continue;
    }

    const createdAt = pastDate();
    const user = await prisma.user.create({
      data: {
        ...somewhereInEgypt(),
        phone,
        fullName: fullName(),
        role: UserRole.CUSTOMER,
        status,
        createdAt,
        updatedAt: hoursAfter(createdAt, faker.number.int({ min: 0, max: 48 })),
      },
    });

    customers.push(toSeededUser(user));
  }

  // --- technicians with documents ----------------------------------------
  // verificationStatus and user.status move together, exactly like
  // setVerificationStatus() is supposed to write them:
  //   VERIFIED -> user ACTIVE      PENDING/REJECTED -> user stays PENDING
  for (let index = 0; index < CONFIG.technicians; index += 1) {
    const verificationStatus =
      index === 0
        ? VerificationStatus.VERIFIED
        : faker.helpers.weightedArrayElement([
            { value: VerificationStatus.VERIFIED, weight: 70 },
            { value: VerificationStatus.PENDING, weight: 20 },
            { value: VerificationStatus.REJECTED, weight: 10 },
          ]);

    const verified = verificationStatus === VerificationStatus.VERIFIED;
    const category = faker.helpers.arrayElement(categories);
    const createdAt = pastDate();
    const location = somewhereInEgypt();

    const user = await prisma.user.create({
      data: {
        ...location,
        phone: index === 0 ? FIXTURES.technician : uniquePhone(),
        fullName: fullName(),
        role: UserRole.TECHNICIAN,
        // A verified technician is let into the app; the others are still
        // sitting on the "waiting for approval" screen.
        status: verified ? UserStatus.ACTIVE : UserStatus.PENDING,
        createdAt,
        updatedAt: hoursAfter(createdAt, faker.number.int({ min: 1, max: 72 })),
        technicianProfile: {
          create: {
            categoryId: category.id,
            profileImage: faker.datatype.boolean(0.7)
              ? uploadPath("profile", "jpg")
              : null,
            nationalId: nationalId(),
            criminalRecordFile: faker.datatype.boolean(0.8)
              ? uploadPath("criminal-record", "pdf")
              : null,
            verificationStatus,
            isAvailable: verified ? faker.datatype.boolean(0.75) : false,
            // Filled in for real at the end, from the reviews that exist.
            overallRating: money(0),
            totalReviews: 0,
            createdAt,
            updatedAt: hoursAfter(createdAt, faker.number.int({ min: 1, max: 72 })),
          },
        },
      },
    });

    technicians.push({
      ...toSeededUser(user),
      categoryId: category.id,
      verified,
    });
  }

  // --- technicians who never uploaded anything ---------------------------
  for (let index = 0; index < CONFIG.techniciansWithoutDocuments; index += 1) {
    await prisma.user.create({
      data: {
        phone: uniquePhone(),
        role: UserRole.TECHNICIAN,
        status: UserStatus.PENDING,
        createdAt: faker.date.recent({ days: 10 }),
      },
    });
  }

  return { admins, customers, technicians, pendingUsers };
}

// ---------------------------------------------------------------------------
// 4. OTP history
// ---------------------------------------------------------------------------

/**
 * A believable OTP table: codes that were used, one that is still live, one
 * that expired unused, one phone that got itself locked out, and a couple of
 * numbers that asked for a code and never came back.
 */
async function seedOtps(users: SeededUser[], pendingUsers: SeededUser[]) {
  const rows: {
    phone: string;
    otpCode: string;
    attempts: number;
    blockedUntil: Date | null;
    expiresAt: Date;
    verifiedAt: Date | null;
    createdAt: Date;
  }[] = [];

  const code = () => faker.string.numeric({ length: 6, allowLeadingZeros: true });

  // The code each existing user signed up with: verified, long expired.
  for (const user of users) {
    const createdAt = minutesAfter(user.createdAt, -2);
    rows.push({
      phone: user.phone,
      otpCode: code(),
      attempts: faker.number.int({ min: 0, max: 2 }),
      blockedUntil: null,
      expiresAt: minutesAfter(createdAt, 5),
      verifiedAt: minutesAfter(createdAt, faker.number.int({ min: 1, max: 4 })),
      createdAt,
    });
  }

  // Users stuck at PENDING: a code that is still valid right now.
  for (const user of pendingUsers.slice(0, 3)) {
    const createdAt = minutesAfter(new Date(), -1);
    rows.push({
      phone: user.phone,
      otpCode: code(),
      attempts: 0,
      blockedUntil: null,
      expiresAt: minutesAfter(createdAt, 5),
      verifiedAt: null,
      createdAt,
    });
  }

  // Asked for a code, never typed it in - these phones have no user row.
  for (let index = 0; index < 4; index += 1) {
    const createdAt = faker.date.recent({ days: 20 });
    rows.push({
      phone: uniquePhone(),
      otpCode: code(),
      attempts: faker.number.int({ min: 0, max: 3 }),
      blockedUntil: null,
      expiresAt: minutesAfter(createdAt, 5),
      verifiedAt: null,
      createdAt,
    });
  }

  // Five wrong guesses -> locked out for 15 minutes. Request an OTP for this
  // phone and the API answers 429; the lock is still live for a while.
  const blockedCreatedAt = minutesAfter(new Date(), -6);
  rows.push({
    phone: uniquePhone(),
    otpCode: code(),
    attempts: 5,
    blockedUntil: minutesAfter(new Date(), 9),
    expiresAt: minutesAfter(blockedCreatedAt, 5),
    verifiedAt: null,
    createdAt: blockedCreatedAt,
  });

  await prisma.otp.createMany({ data: rows });

  return rows.length;
}

// ---------------------------------------------------------------------------
// 5. Service requests, with everything that hangs off them
// ---------------------------------------------------------------------------

/** Statuses that mean a technician is already on the job. */
const ASSIGNED_STATUSES: RequestStatus[] = [
  RequestStatus.TECHNICIAN_SELECTED,
  RequestStatus.ON_THE_WAY,
  RequestStatus.ARRIVED,
  RequestStatus.IN_PROGRESS,
  RequestStatus.COMPLETED,
];

const STATUS_WEIGHTS = [
  { value: RequestStatus.COMPLETED, weight: 38 },
  { value: RequestStatus.CANCELLED, weight: 13 },
  { value: RequestStatus.WAITING_FOR_TECHNICIAN, weight: 12 },
  { value: RequestStatus.PENDING, weight: 8 },
  { value: RequestStatus.IN_PROGRESS, weight: 9 },
  { value: RequestStatus.TECHNICIAN_SELECTED, weight: 8 },
  { value: RequestStatus.ON_THE_WAY, weight: 7 },
  { value: RequestStatus.ARRIVED, weight: 5 },
];

async function seedServiceRequests(
  customers: SeededUser[],
  technicians: SeededTechnician[],
  categories: SeededCategory[],
) {
  // Only a verified technician can be offered work, so index those by category.
  const byCategory = new Map<string, SeededTechnician[]>();
  for (const technician of technicians) {
    if (!technician.verified) continue;
    const key = technician.categoryId.toString();
    byCategory.set(key, [...(byCategory.get(key) ?? []), technician]);
  }

  const counts = {
    requests: 0,
    attachments: 0,
    estimations: 0,
    offers: 0,
    customerReviews: 0,
    technicianReviews: 0,
  };

  for (const customer of customers) {
    const howMany = faker.number.int(CONFIG.requestsPerCustomer);

    for (let index = 0; index < howMany; index += 1) {
      const category = faker.helpers.arrayElement(categories);
      const candidates = byCategory.get(category.id.toString()) ?? [];

      let status = faker.helpers.weightedArrayElement(STATUS_WEIGHTS);

      // No verified technician in this category yet? Then nobody could have
      // been offered the job - the request can only be sitting at PENDING.
      if (candidates.length === 0) status = RequestStatus.PENDING;

      const assigned = ASSIGNED_STATUSES.includes(status);
      const requestType = faker.helpers.weightedArrayElement([
        { value: RequestType.AI_ESTIMATION, weight: 55 },
        { value: RequestType.CONSULTATION, weight: 45 },
      ]);

      // The request is filed at the customer's own address most of the time,
      // but sometimes somewhere else (a relative's flat, a second home).
      const place = faker.datatype.boolean(0.75)
        ? {
            city: customer.city,
            address: `${faker.number.int({ min: 1, max: 140 })} ${faker.helpers.arrayElement(STREETS)} St, ${faker.helpers.arrayElement(DISTRICTS)}`,
            latitude: customer.latitude,
            longitude: customer.longitude,
          }
        : somewhereInEgypt();

      const createdAt = faker.date.between({
        from: customer.createdAt,
        to: new Date(),
      });

      // A consultation is charged by distance on top of the category's call-out
      // fee; an AI estimation never leaves the app, so it has neither.
      const distanceKm =
        requestType === RequestType.CONSULTATION
          ? faker.number.float({ min: 0.8, max: 28, fractionDigits: 2 })
          : null;
      const visitFee =
        distanceKm === null
          ? null
          : category.homeVisitBasePrice + Math.max(0, distanceKm - 5) * 12;

      // Severity drives every price on this request, so pick it once.
      const severity = faker.helpers.weightedArrayElement([
        { value: Severity.SMALL, weight: 45 },
        { value: Severity.MEDIUM, weight: 38 },
        { value: Severity.LARGE, weight: 17 },
      ]);
      const band = category.bands[severity];

      // The AI's guess: a window inside the category's own band, never wider.
      const estimateMin = faker.number.int({
        min: band.min,
        max: Math.round(band.min + (band.max - band.min) * 0.4),
      });
      const estimateMax = faker.number.int({
        min: Math.round(estimateMin + (band.max - estimateMin) * 0.25),
        max: band.max,
      });

      const selected = assigned ? faker.helpers.arrayElement(candidates) : null;

      // Offers: everyone except a brand new PENDING request has been shown to
      // some technicians. Sampling without replacement keeps the unique
      // (service_request_id, technician_id) happy.
      const others = candidates.filter((tech) => tech.id !== selected?.id);
      const offereeCount =
        status === RequestStatus.PENDING
          ? 0
          : faker.number.int({
              // "Waiting for a technician" with nobody to wait on would be a
              // dead end, so those requests always carry at least one offer.
              min:
                !selected && status === RequestStatus.WAITING_FOR_TECHNICIAN
                  ? Math.min(1, others.length)
                  : 0,
              max: Math.min(3, others.length),
            });
      const offerees = faker.helpers.arrayElements(others, offereeCount);

      const offers = [
        // Exactly one SELECTED offer on an assigned request - that is the
        // technician the customer picked.
        ...(selected
          ? [
              {
                technicianId: selected.id,
                status: OfferStatus.SELECTED,
                acceptedAt: minutesAfter(createdAt, faker.number.int({ min: 3, max: 40 })),
                createdAt: minutesAfter(createdAt, 2),
                updatedAt: minutesAfter(createdAt, 45),
              },
            ]
          : []),
        ...offerees.map((technician) => {
          const offerStatus = selected
            ? OfferStatus.NOT_SELECTED
            : faker.helpers.weightedArrayElement([
                { value: OfferStatus.PENDING, weight: 45 },
                { value: OfferStatus.ACCEPTED, weight: 35 },
                { value: OfferStatus.DECLINED, weight: 20 },
              ]);

          const offerCreatedAt = minutesAfter(
            createdAt,
            faker.number.int({ min: 1, max: 30 }),
          );

          return {
            technicianId: technician.id,
            status: offerStatus,
            acceptedAt:
              offerStatus === OfferStatus.ACCEPTED
                ? minutesAfter(offerCreatedAt, faker.number.int({ min: 1, max: 20 }))
                : null,
            createdAt: offerCreatedAt,
            updatedAt: offerCreatedAt,
          };
        }),
      ];

      const finishedAt = hoursAfter(createdAt, faker.number.int({ min: 2, max: 96 }));
      const completed = status === RequestStatus.COMPLETED;
      // Not every finished job gets rated - about a fifth are never reviewed.
      const reviewed = completed && faker.datatype.boolean(0.8);

      const punctuality = faker.number.int({ min: 3, max: 5 });
      const serviceQuality = faker.number.int({ min: 3, max: 5 });
      const professionalism = faker.number.int({ min: 3, max: 5 });
      const priceFairness = faker.number.int({ min: 2, max: 5 });

      // What the customer actually handed over: inside the estimate for an AI
      // request, inside the band plus the call-out fee for a consultation.
      const actualPaidPrice =
        requestType === RequestType.AI_ESTIMATION
          ? faker.number.int({ min: estimateMin, max: estimateMax })
          : faker.number.int({ min: band.min, max: band.max }) + (visitFee ?? 0);

      const attachmentCount = faker.number.int({ min: 0, max: 3 });

      // Picked once: the title is the headline of the same sentence, not a
      // second draw that would describe a different problem.
      const complaint = faker.helpers.arrayElement(
        COMPLAINTS[category.name] ?? [faker.lorem.sentence()],
      );

      const request = await prisma.serviceRequest.create({
        data: {
          customerId: customer.id,
          technicianId: selected?.id ?? null,
          categoryId: category.id,
          requestType,
          title: titleFrom(complaint),
          description: complaint,
          serviceAddress: place.address,
          serviceCity: place.city,
          serviceLatitude: place.latitude,
          serviceLongitude: place.longitude,
          distanceKm: distanceKm === null ? null : money(distanceKm),
          visitFee: visitFee === null ? null : money(visitFee),
          status,
          createdAt,
          updatedAt: completed ? finishedAt : hoursAfter(createdAt, 1),

          attachments: {
            create: Array.from({ length: attachmentCount }, () => ({
              imageUrl: uploadPath("issue", faker.helpers.arrayElement(["jpg", "png"])),
              createdAt,
            })),
          },

          // Only an AI_ESTIMATION request has an estimation row.
          ...(requestType === RequestType.AI_ESTIMATION
            ? {
                aiEstimation: {
                  create: {
                    severity,
                    minPrice: money(estimateMin),
                    maxPrice: money(estimateMax),
                    confidence: money(
                      faker.number.float({ min: 61, max: 99, fractionDigits: 2 }),
                    ),
                    createdAt: minutesAfter(createdAt, 1),
                  },
                },
              }
            : {}),

          ...(offers.length > 0 ? { offers: { create: offers } } : {}),

          ...(reviewed && selected
            ? {
                customerReview: {
                  create: {
                    customerId: customer.id,
                    technicianId: selected.id,
                    actualPaidPrice: money(actualPaidPrice),
                    punctuality,
                    serviceQuality,
                    professionalism,
                    priceFairness,
                    // The headline rating is the average of the four scores.
                    rating: money(
                      (punctuality + serviceQuality + professionalism + priceFairness) / 4,
                    ),
                    comment: faker.datatype.boolean(0.7)
                      ? faker.helpers.arrayElement(CUSTOMER_COMMENTS)
                      : null,
                    createdAt: hoursAfter(finishedAt, faker.number.int({ min: 1, max: 48 })),
                  },
                },
                // The technician rates the customer back, but less often.
                ...(faker.datatype.boolean(0.6)
                  ? {
                      technicianReview: {
                        create: {
                          technicianId: selected.id,
                          customerId: customer.id,
                          rating: faker.number.int({ min: 3, max: 5 }),
                          comment: faker.datatype.boolean(0.5)
                            ? faker.helpers.arrayElement(TECHNICIAN_COMMENTS)
                            : null,
                          createdAt: hoursAfter(finishedAt, faker.number.int({ min: 1, max: 24 })),
                        },
                      },
                    }
                  : {}),
              }
            : {}),
        },
        select: { id: true, technicianReview: { select: { id: true } } },
      });

      counts.requests += 1;
      counts.attachments += attachmentCount;
      counts.offers += offers.length;
      if (requestType === RequestType.AI_ESTIMATION) counts.estimations += 1;
      if (reviewed && selected) counts.customerReviews += 1;
      if (request.technicianReview) counts.technicianReviews += 1;
    }
  }

  return counts;
}

// ---------------------------------------------------------------------------
// 6. Rating roll-up
// ---------------------------------------------------------------------------

/**
 * `overall_rating` and `total_reviews` on a technician profile are a cache of
 * the customer_reviews table. Recompute them here so the seeded numbers agree
 * with the seeded reviews - otherwise the technician list lies.
 */
async function rollUpTechnicianRatings() {
  const grouped = await prisma.customerReview.groupBy({
    by: ["technicianId"],
    _avg: { rating: true },
    _count: { _all: true },
  });

  for (const row of grouped) {
    await prisma.technicianProfile.updateMany({
      where: { userId: row.technicianId },
      data: {
        overallRating: money(Number(row._avg.rating ?? 0)),
        totalReviews: row._count._all,
      },
    });
  }

  return grouped.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (process.env["NODE_ENV"] === "production" && !process.argv.includes("--force")) {
    throw new Error(
      "Refusing to seed with NODE_ENV=production - this deletes every row. Pass --force if you really mean it.",
    );
  }

  const startedAt = Date.now();
  faker.seed(CONFIG.randomSeed);

  await resetDatabase();

  const categories = await seedCategories();
  console.log(`  categories            ${categories.length} (+ ${categories.length * 3} pricing rows)`);

  const { admins, customers, technicians, pendingUsers } = await seedUsers(categories);
  console.log(
    `  users                 ${admins.length + customers.length + technicians.length + pendingUsers.length + CONFIG.techniciansWithoutDocuments}` +
      ` (${admins.length} admin, ${customers.length} customer, ${technicians.length + CONFIG.techniciansWithoutDocuments} technician, ${pendingUsers.length} pending)`,
  );

  const otps = await seedOtps(
    [...admins, ...customers, ...technicians, ...pendingUsers],
    pendingUsers,
  );
  console.log(`  otp                   ${otps}`);

  const counts = await seedServiceRequests(customers, technicians, categories);
  console.log(`  service_requests      ${counts.requests}`);
  console.log(`  request_attachments   ${counts.attachments}`);
  console.log(`  ai_estimations        ${counts.estimations}`);
  console.log(`  technician_offers     ${counts.offers}`);
  console.log(`  customer_reviews      ${counts.customerReviews}`);
  console.log(`  technician_reviews    ${counts.technicianReviews}`);

  const rated = await rollUpTechnicianRatings();
  console.log(`  ratings rolled up     ${rated} technician profile(s)`);

  console.log(`\nDone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s. Fixed accounts:`);
  console.log(`  admin       ${FIXTURES.admin}`);
  console.log(`  customer    ${FIXTURES.customer}`);
  console.log(`  technician  ${FIXTURES.technician}  (verified)`);
}

main()
  .catch((error) => {
    console.error("\nSeed failed:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
