/**
 * Every sentence this API says to a person, in Egyptian Arabic.
 *
 * The app ships in Egypt and has no language switcher, so there is exactly one
 * locale and this is it. The copy lives here rather than inline at each throw
 * for two reasons: a native speaker can read and fix all of the wording in one
 * file without touching any logic, and the four places that say "this account
 * has already finished signing up" cannot drift into four different sentences.
 *
 * What is deliberately NOT translated is `error.code` - `not_found`,
 * `validation_error`, `conflict` and the rest. Those are the machine-readable
 * half of the response: the app switches on them, they end up in logs and
 * dashboards, and an Arabic identifier would break every client that already
 * reads them. The rule is simple:
 *
 *   error.code      for the app      stays English, stays stable
 *   error.message   for the person   Arabic, free to be reworded
 *
 * The same goes for `details[].field` on a validation error: it is the JSON
 * field name the app has to map back to an input, so it stays English. Only
 * the `message` next to it is translated.
 */

/**
 * Arabic counts a noun in four shapes, and getting it wrong is the difference
 * between "استنى 2 ثانية" and "استنى ثانيتين". Every number this file prints
 * next to a noun goes through here.
 *
 *   one   1          واحد
 *   two   2          المثنى
 *   few   3 to 10    جمع القلة
 *   many  11 and up  back to the singular noun after the digits
 */
function counted(
  n: number,
  forms: { one: string; two: string; few: string; many: string },
): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (n >= 3 && n <= 10) return `${n} ${forms.few}`;
  return `${n} ${forms.many}`;
}

export function seconds(n: number) {
  return counted(n, {
    one: "ثانية واحدة",
    two: "ثانيتين",
    few: "ثواني",
    many: "ثانية",
  });
}

export function minutes(n: number) {
  return counted(n, {
    one: "دقيقة واحدة",
    two: "دقيقتين",
    few: "دقايق",
    many: "دقيقة",
  });
}

export function attempts(n: number) {
  return counted(n, {
    one: "محاولة واحدة",
    two: "محاولتين",
    few: "محاولات",
    many: "محاولة",
  });
}

export function letters(n: number) {
  return counted(n, {
    one: "حرف واحد",
    two: "حرفين",
    few: "حروف",
    many: "حرف",
  });
}

export function items(n: number) {
  return counted(n, {
    one: "عنصر واحد",
    two: "عنصرين",
    few: "عناصر",
    many: "عنصر",
  });
}

/**
 * The Arabic name of a field, for the messages that have to point at one.
 *
 * Three different sources hand us a field name and none of them agree on the
 * spelling: zod and multer use the JSON name (`nationalId`), while a Postgres
 * constraint violation arrives with the column name (`national_id`). Both are
 * normalised to camelCase before the lookup, so each field is listed once.
 *
 * An unknown name falls through to itself. That is on purpose - a new column
 * with no entry here should show up as `home_visit_base_price` in a message,
 * which is ugly and gets noticed, rather than being silently swallowed.
 */
const fieldLabels: Record<string, string> = {
  id: "الرقم التعريفي",
  phone: "رقم التليفون",
  fullName: "الاسم بالكامل",
  city: "المدينة",
  address: "العنوان",
  latitude: "خط العرض",
  longitude: "خط الطول",
  role: "نوع الحساب",
  status: "حالة الحساب",
  otpCode: "كود التأكيد",
  refreshToken: "توكن التجديد",
  userId: "الحساب",
  categoryId: "التخصص",
  nationalId: "الرقم القومي",
  // What Egyptians actually call a criminal record certificate.
  criminalRecordFile: "الفيش والتشبيه",
  profileImage: "الصورة الشخصية",
  verificationStatus: "حالة التوثيق",
  name: "الاسم",
  homeVisitBasePrice: "سعر زيارة البيت",
  severity: "درجة العطل",
  page: "رقم الصفحة",
  limit: "عدد النتائج",
  search: "كلمة البحث",
  points: "النقط",
  amount: "الكمية",
  title: "العنوان",
  description: "الوصف",
  images: "الصور",
};

export function fieldLabel(field: string): string {
  const camelCase = field.replace(/_([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );

  return fieldLabels[camelCase] ?? field;
}

/** `"الرقم القومي و رقم التليفون"` - for the messages that list several. */
function labelList(fields: string[]) {
  return fields.map(fieldLabel).join(" و");
}

/** The Arabic name of each role, for "this endpoint is only for …". */
const roleLabels: Record<string, string> = {
  CUSTOMER: "العملاء",
  TECHNICIAN: "الفنيين",
  ADMIN: "الأدمن",
};

function roleList(roles: string[]) {
  return roles.map((role) => roleLabels[role] ?? role).join(" و");
}

export const messages = {
  /** The default sentence behind each `ApiError` helper. */
  generic: {
    badRequest: "في حاجة غلط في الطلب",
    unauthorized: "لازم تسجّل دخول الأول",
    forbidden: "مش مسموح لك تفتح الحاجة دي",
    notFound: "مش لاقيين الحاجة اللي بتدور عليها",
    conflict: "الحاجة دي موجودة قبل كده",
    notImplemented: "الخدمة دي لسه مش شغالة",
    /** Anything that reached the error handler as a bug. */
    serverError: "في مشكلة عندنا، حاول تاني كمان شوية",
    /** A dependency we do not control is down - see ApiError.serviceUnavailable. */
    serviceUnavailable: "الخدمة دي مش متاحة دلوقتي، حاول تاني كمان شوية",
    /** No route matched the URL at all. */
    routeNotFound: (method: string, url: string) =>
      `مفيش أي حاجة على العنوان ده: ${method} ${url}`,
  },

  /** What the error handler says about a rejected body or a failed write. */
  validation: {
    invalidRequest: "في بيانات ناقصة أو مكتوبة غلط",

    /** A unique constraint (Prisma P2002). */
    alreadyInUse: (fields: string[]) => {
      if (fields.length === 0) return "القيمة دي مسجّلة قبل كده";
      if (fields.length === 1) return `${fieldLabel(fields[0])} مسجّل قبل كده`;
      return `${labelList(fields)} مسجّلين قبل كده`;
    },

    /** A foreign key pointing at a parent row that is not there. */
    referencedRecordMissing: "في بيان في طلبك بيشاور على حاجة مش موجودة",
    /** A foreign key held by children that still point at this row. */
    stillReferenced: "مش هينفع تمسح ده، في بيانات تانية مرتبطة بيه",
    /** Which of the two it was could not be worked out. */
    foreignKeyEitherWay:
      "في بيان بيشاور على حاجة مش موجودة، أو في بيانات تانية مرتبطة بالحاجة دي",
  },

  /** Logging in: the OTP, the tokens, and the guards on every request. */
  auth: {
    otpNotRequested: "لازم تطلب كود التأكيد الأول",
    otpAlreadyUsed: "الكود ده اتستخدم قبل كده",
    otpExpired: "الكود ده خلصت مدته، اطلب كود جديد",
    otpWrong: (attemptsLeft: number) =>
      `الكود غلط. فاضلك ${attempts(attemptsLeft)}.`,
    /**
     * The phone is locked out. `remainingMinutes` is only known at the moment
     * the lock is applied - a later request just finds a `blockedUntil` in the
     * future, so it says "شوية" instead of inventing a number.
     */
    otpBlocked: (remainingMinutes?: number) =>
      remainingMinutes === undefined
        ? "جرّبت الكود غلط كذا مرة. استنى شوية وحاول تاني."
        : `جرّبت الكود غلط كذا مرة. استنى ${minutes(remainingMinutes)} وحاول تاني.`,
    resendTooSoon: (waitSeconds: number) =>
      `استنى ${seconds(waitSeconds)} قبل ما تطلب كود تاني.`,

    accountGone: "الحساب ده مبقاش موجود",
    accountBlocked: "الحساب ده محظور",
    accountSuspended: "الحساب ده موقوف",

    missingBearerToken:
      "ابعت توكن الدخول في هيدر Authorization بالشكل ده: Bearer <token>",
    invalidToken: "التوكن مش صالح",
    accessTokenExpired: "الجلسة انتهت، جدّدها بـ refresh token",
    refreshTokenExpired: "الجلسة انتهت، سجّل دخول تاني",
    roleNotAllowed: (roles: string[]) =>
      `الخدمة دي لحسابات ${roleList(roles)} بس`,
  },

  users: {
    notFound: "المستخدم ده مش موجود",
    signUpAlreadyFinished: "الحساب ده خلّص تسجيل خلاص",
    roleLockedByDocuments:
      "المستندات اتبعتت خلاص، مش هينفع تغيّر نوع الحساب دلوقتي",
    documentsAlreadySubmitted:
      "المستندات اتبعتت خلاص، الحساب ده مش هيقدر يسجّل تاني",
    customerCannotAttachFiles: (fields: string[]) =>
      `حساب العميل مفيهوش مكان يتحفظ فيه ملفات، وانت رفعت ${labelList(fields)}. المستندات بتترفع مع role=TECHNICIAN بس.`,
  },

  categories: {
    notFound: "التخصص ده مش موجود",
  },

  /**
   * Rejected uploads. The 5 MB figure is `MAX_FILE_SIZE_BYTES` in
   * modules/uploads/uploads.storage.ts - this only describes the limit, so keep
   * the two in step.
   */
  uploads: {
    unsupportedType: (field: string, mimeType: string) =>
      `${fieldLabel(field)} لازم يكون JPEG أو PNG أو PDF، مش ${mimeType}`,
    tooLarge: (field: string) =>
      `${fieldLabel(field)} أكبر من الحد المسموح وهو 5 ميجا`,
    unexpectedFile: (field: string) =>
      `${fieldLabel(field)} مش ملف الخدمة دي بتقبله`,
    tooManyFiles: "ملفات كتير أوي في طلب واحد",
    tooManyParts: "أجزاء كتير أوي في الفورم",
    /** The request carried no file at all, so multer's filter never ran. */
    fileRequired: "لازم ترفع ملف",
  },

  /** Rules written on a single field, in the schema that declares it. */
  fields: {
    phone:
      "رقم التليفون لازم يكون رقم موبايل مصري بالصيغة الدولية، زي +201012345678",
    id: "الرقم التعريفي لازم يكون رقم صحيح موجب",
    otpCode: "كود التأكيد لازم يكون 6 أرقام",
    atLeastOneFieldToUpdate: "ابعت حقل واحد على الأقل عشان نعدّله",
    priceDecimals: "سعر زيارة البيت يقبل رقمين عشريين على الأكثر",

    nationalId: {
      length: "الرقم القومي لازم يكون 14 رقم بالظبط",
      birthDate: (digits: string) =>
        `أول 7 أرقام في الرقم القومي ("${digits}") مش تاريخ ميلاد صحيح - المفروض 2 أو 3 وبعدهم السنة والشهر واليوم`,
      futureBirthDate: "تاريخ الميلاد اللي في الرقم القومي في المستقبل",
      governorate: (code: string) =>
        `الرقمين 8 و9 في الرقم القومي ("${code}") مش كود محافظة مصرية`,
    },
  },

  /**
   * A default sentence per account state, for the app that has none of its own.
   * See modules/users/users.state.ts for what each state means.
   */
  accountState: {
    completeProfile: "من فضلك كمّل بياناتك",
    submitDocuments: "اكتب رقمك القومي وارفع الفيش والتشبيه عشان تخلّص التسجيل",
    waitingForApproval:
      "مستنداتك تحت المراجعة. هنبعتلك إشعار أول ما الأدمن يوافق على حسابك.",
    verificationRejected: "مستنداتك اترفضت. من فضلك ارفعها تاني.",
    ready: "حسابك جاهز",
    blocked: "الحساب ده محظور",
    suspended: "الحساب ده موقوف",
  },
  points: {
    notEnough: "رصيد نقاطك مش كفاية. اشحن نقاط وحاول تاني.",
  },
};
