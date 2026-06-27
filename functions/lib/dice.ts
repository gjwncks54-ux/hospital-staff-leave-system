import type { EmployeeRecord } from "./db";

const DICE_LOOKBACK_DAYS = 365;
const DICE_TIME_ZONE = "Asia/Seoul";
const DICE_CREDIT_START_DATE = "2026-05-23";
const MONTHLY_REROLL_START_MONTH = "2026-07";
const MONTHLY_REROLL_BONUS_COUNT = 5;
const MONTHLY_REROLL_REASON_PREFIX = "monthly_reroll";

type DiceBonusRow = {
  id: number;
  employee_no: string;
  reason: string;
  used: number;
  created_at: string;
};

type DiceRollRow = {
  id: number;
  employee_no: string;
  roll_date: string;
  roll_value: number;
  die_one: number;
  die_two: number;
  is_double: number;
  roll_score: number;
  roll_kind: "REGULAR" | "BONUS";
  bonus_id: number | null;
  created_at: string;
};

type RankingRow = {
  employee_no: string;
  employee_name: string | null;
  score: number;
  rolls: number;
  rank: number;
};

type DiceEmployeeRow = {
  joined_at: string;
};

function formatDateInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function addMonths(dateString: string, months: number) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function maxDateString(first: string, second: string) {
  return first > second ? first : second;
}

function getWeekdayUTC(dateString: string) {
  return new Date(`${dateString}T00:00:00Z`).getUTCDay();
}

function getEligibleRegularDates(monthStart: string, today: string, joinedAt?: string) {
  let startDate = maxDateString(monthStart, DICE_CREDIT_START_DATE);
  if (joinedAt) {
    startDate = maxDateString(startDate, joinedAt);
  }

  const dates: string[] = [];

  for (let cursor = startDate; cursor <= today; cursor = addDays(cursor, 1)) {
    if (getWeekdayUTC(cursor) !== 0) {
      dates.push(cursor);
    }
  }

  return dates;
}

function getMonthlyRerollReason(monthStart: string) {
  return `${MONTHLY_REROLL_REASON_PREFIX}:${monthStart.slice(0, 7)}`;
}

function canReceiveMonthlyReroll(monthStart: string, joinedAt?: string) {
  if (monthStart.slice(0, 7) < MONTHLY_REROLL_START_MONTH) {
    return false;
  }

  if (!joinedAt) {
    return false;
  }

  return joinedAt <= monthStart;
}

async function ensureMonthlyRerollBonuses(db: D1Database, employeeNo: string, monthStart: string, joinedAt?: string) {
  if (!canReceiveMonthlyReroll(monthStart, joinedAt)) {
    return;
  }

  const reason = getMonthlyRerollReason(monthStart);
  const existing = await db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM dice_bonuses
        WHERE employee_no = ?
          AND reason = ?
      `,
    )
    .bind(employeeNo, reason)
    .first<{ count: number }>();

  const remaining = MONTHLY_REROLL_BONUS_COUNT - Number(existing?.count ?? 0);
  if (remaining <= 0) {
    return;
  }

  for (let index = 0; index < remaining; index += 1) {
    await db
      .prepare(
        `
          INSERT INTO dice_bonuses (employee_no, reason)
          VALUES (?, ?)
        `,
      )
      .bind(employeeNo, reason)
      .run();
  }
}

export function getDiceToday() {
  return formatDateInZone(new Date(), DICE_TIME_ZONE);
}

function isSundayInDiceTimeZone() {
  return new Intl.DateTimeFormat("en-US", { timeZone: DICE_TIME_ZONE, weekday: "short" }).format(new Date()) === "Sun";
}

export function createDiceRollValue() {
  const random = new Uint8Array(1);

  while (true) {
    crypto.getRandomValues(random);
    if (random[0] < 252) {
      return (random[0] % 6) + 1;
    }
  }
}

export function createDiceRollResult() {
  const dieOne = createDiceRollValue();
  const dieTwo = createDiceRollValue();
  const isDouble = dieOne === dieTwo;
  const rollScore = (dieOne + dieTwo) * (isDouble ? 2 : 1);

  return { dieOne, dieTwo, isDouble, rollScore };
}

export function getDiceCutoffDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - DICE_LOOKBACK_DAYS);
  return date.toISOString().slice(0, 10);
}

export function getDiceMonthWindow(today = getDiceToday()) {
  const monthStart = `${today.slice(0, 7)}-01`;
  return {
    monthStart,
    nextMonthStart: addMonths(monthStart, 1),
  };
}

export async function getDiceStatus(db: D1Database, employeeNo: string) {
  const today = getDiceToday();
  const cutoff = getDiceCutoffDate();
  const { monthStart, nextMonthStart } = getDiceMonthWindow(today);

  const employee = await db
    .prepare(
      `
        SELECT joined_at
        FROM employees
        WHERE employee_no = ?
          AND is_active = 1
      `,
    )
    .bind(employeeNo)
    .first<DiceEmployeeRow>();

  const eligibleRegularDates = employee ? getEligibleRegularDates(monthStart, today, employee.joined_at) : [];
  if (employee) {
    await ensureMonthlyRerollBonuses(db, employeeNo, monthStart, employee.joined_at);
  }

  const [regularRollDates, bonusCount, recentRolls, todayBest, todayReroll] = await Promise.all([
    db
      .prepare(
        `
          SELECT DISTINCT roll_date
          FROM dice_rolls
          WHERE employee_no = ?
            AND roll_kind = 'REGULAR'
            AND date(roll_date) >= date(?)
            AND date(roll_date) >= date(?)
            AND date(roll_date) < date(?)
        `,
      )
      .bind(employeeNo, cutoff, monthStart, nextMonthStart)
      .all<{ roll_date: string }>(),
    db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM dice_bonuses
          WHERE employee_no = ?
            AND used = 0
            AND date(created_at) >= date(?)
        `,
      )
      .bind(employeeNo, cutoff)
      .first<{ count: number }>(),
    db
      .prepare(
        `
          SELECT id, employee_no, roll_date, roll_value, die_one, die_two, is_double, roll_score, roll_kind, bonus_id, created_at
          FROM dice_rolls
          WHERE employee_no = ?
            AND date(roll_date) >= date(?)
          ORDER BY created_at DESC
          LIMIT 5
        `,
      )
      .bind(employeeNo, cutoff)
      .all<DiceRollRow>(),
    db
      .prepare(
        `
          SELECT
            COALESCE(MAX(roll_score), 0) AS best_score,
            COUNT(*) AS attempts
          FROM dice_rolls
          WHERE employee_no = ?
            AND roll_date = ?
            AND roll_score > 0
            AND date(roll_date) >= date(?)
        `,
      )
      .bind(employeeNo, today, cutoff)
      .first<{ best_score: number; attempts: number }>(),
    db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM dice_rolls
          WHERE employee_no = ?
            AND roll_kind = 'BONUS'
            AND date(datetime(created_at, '+9 hours')) = date(?)
            AND date(roll_date) >= date(?)
        `,
      )
      .bind(employeeNo, today, cutoff)
      .first<{ count: number }>(),
  ]);

  const usedRegularDates = new Set(regularRollDates.results.map((row) => row.roll_date));
  const availableRegularDates = eligibleRegularDates.filter((date) => !usedRegularDates.has(date));
  const normalAvailable = availableRegularDates.length > 0;
  const bonusAvailable = Number(bonusCount?.count ?? 0);
  const todayRerollUsed = Number(todayReroll?.count ?? 0) > 0;

  return {
    today,
    normalAvailable,
    regularAvailable: availableRegularDates.length,
    nextRegularRollDate: availableRegularDates[0] ?? null,
    bonusAvailable,
    rerollAvailableToday: bonusAvailable > 0 && !todayRerollUsed,
    todayRerollUsed,
    totalAvailable: availableRegularDates.length + bonusAvailable,
    todayBestScore: Number(todayBest?.best_score ?? 0),
    todayAttempts: Number(todayBest?.attempts ?? 0),
    recentRolls: recentRolls.results.map((row) => ({
      id: row.id,
      rollDate: row.roll_date,
      rollValue: row.roll_value,
      dieOne: row.die_one,
      dieTwo: row.die_two,
      isDouble: row.is_double === 1,
      rollScore: row.roll_score,
      source: row.roll_kind === "BONUS" ? "BONUS" : "DAILY",
      createdAt: row.created_at,
    })),
  };
}

export async function rollDice(db: D1Database, employeeNo: string) {
  const today = getDiceToday();
  const cutoff = getDiceCutoffDate();
  const { monthStart, nextMonthStart } = getDiceMonthWindow(today);
  const rollResult = createDiceRollResult();

  const employee = await db
    .prepare(
      `
        SELECT joined_at
        FROM employees
        WHERE employee_no = ?
          AND is_active = 1
      `,
    )
    .bind(employeeNo)
    .first<DiceEmployeeRow>();

  if (!employee) {
    return { ok: false as const, message: "활성 직원 정보를 찾을 수 없습니다." };
  }

  {
    const regularRollDates = await db
      .prepare(
        `
          SELECT DISTINCT roll_date
          FROM dice_rolls
          WHERE employee_no = ?
            AND roll_kind = 'REGULAR'
            AND date(roll_date) >= date(?)
            AND date(roll_date) >= date(?)
            AND date(roll_date) < date(?)
        `,
      )
      .bind(employeeNo, cutoff, monthStart, nextMonthStart)
      .all<{ roll_date: string }>();

    const usedRegularDates = new Set(regularRollDates.results.map((row) => row.roll_date));
    const targetDate = getEligibleRegularDates(monthStart, today, employee.joined_at).find((date) => !usedRegularDates.has(date));

    if (!targetDate) {
      return { ok: false as const, message: "사용 가능한 누적 참여권이 없습니다." };
    }

    const insertRegularRoll = await db
      .prepare(
        `
          INSERT INTO dice_rolls (employee_no, roll_date, roll_value, die_one, die_two, is_double, roll_score, roll_kind)
          SELECT ?, ?, ?, ?, ?, ?, ?, 'REGULAR'
          WHERE COALESCE(
            (
              SELECT COUNT(*)
              FROM dice_rolls
              WHERE employee_no = ?
                AND roll_date = ?
                AND roll_kind = 'REGULAR'
                AND date(roll_date) >= date(?)
            ),
            0
          ) < 1
        `,
      )
      .bind(employeeNo, targetDate, rollResult.dieOne, rollResult.dieOne, rollResult.dieTwo, rollResult.isDouble ? 1 : 0, rollResult.rollScore, employeeNo, targetDate, cutoff)
      .run()
      .catch(() => null);

    if (!insertRegularRoll || insertRegularRoll.meta.changes < 1) {
      return { ok: false as const, message: "해당 날짜의 일반 참여권은 이미 사용되었습니다." };
    }

    return {
      ok: true as const,
      roll: { id: Number(insertRegularRoll.meta.last_row_id), rollDate: targetDate, rollValue: rollResult.dieOne, ...rollResult, source: "DAILY" as const },
    };
  }

}

export async function rerollDice(db: D1Database, employeeNo: string, requestedRollDate?: string) {
  const today = getDiceToday();
  const cutoff = getDiceCutoffDate();
  const { monthStart, nextMonthStart } = getDiceMonthWindow(today);
  const rollResult = createDiceRollResult();

  const employee = await db
    .prepare(
      `
        SELECT joined_at
        FROM employees
        WHERE employee_no = ?
          AND is_active = 1
      `,
    )
    .bind(employeeNo)
    .first<DiceEmployeeRow>();

  if (!employee) {
    return { ok: false as const, message: "활성 직원 정보를 찾을 수 없습니다." };
  }

  await ensureMonthlyRerollBonuses(db, employeeNo, monthStart, employee.joined_at);

  const targetRoll = requestedRollDate
    ? await db
        .prepare(
          `
            SELECT roll_date
            FROM dice_rolls
            WHERE employee_no = ?
              AND roll_date = ?
              AND date(roll_date) >= date(?)
              AND date(roll_date) >= date(?)
              AND date(roll_date) < date(?)
            LIMIT 1
          `,
        )
        .bind(employeeNo, requestedRollDate, cutoff, monthStart, nextMonthStart)
        .first<{ roll_date: string }>()
    : await db
        .prepare(
          `
            SELECT roll_date
            FROM dice_rolls
            WHERE employee_no = ?
              AND date(roll_date) >= date(?)
              AND date(roll_date) >= date(?)
              AND date(roll_date) < date(?)
            ORDER BY created_at DESC
            LIMIT 1
          `,
        )
        .bind(employeeNo, cutoff, monthStart, nextMonthStart)
        .first<{ roll_date: string }>();

  if (!targetRoll) {
    return { ok: false as const, message: "리롤할 주사위 기록이 없습니다." };
  }

  const todayReroll = await db
    .prepare(
      `
        SELECT id
        FROM dice_rolls
        WHERE employee_no = ?
          AND roll_kind = 'BONUS'
          AND date(datetime(created_at, '+9 hours')) = date(?)
          AND date(roll_date) >= date(?)
        LIMIT 1
      `,
    )
    .bind(employeeNo, today, cutoff)
    .first<{ id: number }>();

  if (todayReroll) {
    return { ok: false as const, message: "리롤은 하루에 한 번만 사용할 수 있습니다." };
  }

  const availableBonus = await db
    .prepare(
      `
        SELECT id, employee_no, reason, used, created_at
        FROM dice_bonuses
        WHERE employee_no = ?
          AND used = 0
          AND date(created_at) >= date(?)
        ORDER BY created_at ASC
        LIMIT 1
      `,
    )
    .bind(employeeNo, cutoff)
    .first<DiceBonusRow>();

  if (!availableBonus) {
    return { ok: false as const, message: "사용 가능한 원스텝 리롤권이 없습니다." };
  }

  const updateBonus = await db
    .prepare(
      `
        UPDATE dice_bonuses
        SET used = 1
        WHERE id = ?
          AND employee_no = ?
          AND used = 0
      `,
    )
    .bind(availableBonus.id, employeeNo)
    .run();

  if (updateBonus.meta.changes < 1) {
    return { ok: false as const, message: "보너스 사용 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." };
  }

  const insertRoll = await db
    .prepare(
      `
        INSERT INTO dice_rolls (employee_no, roll_date, roll_value, die_one, die_two, is_double, roll_score, roll_kind, bonus_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'BONUS', ?)
      `,
    )
    .bind(employeeNo, targetRoll.roll_date, rollResult.dieOne, rollResult.dieOne, rollResult.dieTwo, rollResult.isDouble ? 1 : 0, rollResult.rollScore, availableBonus.id)
    .run();

  return {
    ok: true as const,
    roll: { id: Number(insertRoll.meta.last_row_id), rollDate: targetRoll.roll_date, rollValue: rollResult.dieOne, ...rollResult, source: "BONUS" as const },
  };
}

export async function getDiceRanking(db: D1Database, employeeNo: string) {
  const cutoff = getDiceCutoffDate();
  const { monthStart, nextMonthStart } = getDiceMonthWindow();

  const topRows = await db
    .prepare(
      `
        WITH daily_best AS (
          SELECT
            dr.employee_no,
            dr.roll_date,
            MAX(dr.roll_score) AS daily_score,
            COUNT(*) AS attempts
          FROM dice_rolls dr
          WHERE date(dr.roll_date) >= date(?)
            AND date(dr.roll_date) >= date(?)
            AND date(dr.roll_date) < date(?)
            AND dr.roll_score > 0
          GROUP BY dr.employee_no, dr.roll_date
        ),
        monthly_scores AS (
          SELECT
            db.employee_no,
            COALESCE(e.name, db.employee_no) AS employee_name,
            SUM(db.daily_score) AS score,
            COUNT(*) AS rolls,
            SUM(db.attempts) AS attempts,
            DENSE_RANK() OVER (ORDER BY SUM(db.daily_score) DESC) AS rank
          FROM daily_best db
          LEFT JOIN employees e ON e.employee_no = db.employee_no
          GROUP BY db.employee_no
        )
        SELECT employee_no, employee_name, score, rolls, rank
        FROM monthly_scores
        WHERE rank <= 3
        ORDER BY rank ASC, employee_name ASC, employee_no ASC
      `,
    )
    .bind(cutoff, monthStart, nextMonthStart)
    .all<RankingRow>();

  const myRank = await db
    .prepare(
      `
        WITH daily_best AS (
          SELECT
            dr.employee_no,
            dr.roll_date,
            MAX(dr.roll_score) AS daily_score,
            COUNT(*) AS attempts
          FROM dice_rolls dr
          WHERE date(dr.roll_date) >= date(?)
            AND date(dr.roll_date) >= date(?)
            AND date(dr.roll_date) < date(?)
            AND dr.roll_score > 0
          GROUP BY dr.employee_no, dr.roll_date
        ),
        monthly_scores AS (
          SELECT
            db.employee_no,
            COALESCE(e.name, db.employee_no) AS employee_name,
            SUM(db.daily_score) AS score,
            COUNT(*) AS rolls,
            SUM(db.attempts) AS attempts,
            DENSE_RANK() OVER (ORDER BY SUM(db.daily_score) DESC) AS rank
          FROM daily_best db
          LEFT JOIN employees e ON e.employee_no = db.employee_no
          GROUP BY db.employee_no
        )
        SELECT employee_no, employee_name, score, rolls, rank
        FROM monthly_scores
        WHERE employee_no = ?
      `,
    )
    .bind(cutoff, monthStart, nextMonthStart, employeeNo)
    .first<RankingRow>();

  const toRankingItem = (row: RankingRow) => ({
    employeeNo: row.employee_no,
    employeeName: row.employee_name ?? row.employee_no,
    score: Number(row.score ?? 0),
    rolls: Number(row.rolls ?? 0),
    rank: Number(row.rank ?? 0),
  });

  return {
    monthStart,
    top3: topRows.results.map(toRankingItem),
    me: myRank ? toRankingItem(myRank) : { employeeNo, employeeName: "", score: 0, rolls: 0, rank: null },
  };
}

export async function grantDiceBonus(db: D1Database, employeeNo: string, reason: string, actor: EmployeeRecord) {
  const target = await db
    .prepare(
      `
        SELECT employee_no
        FROM employees
        WHERE employee_no = ?
          AND is_active = 1
      `,
    )
    .bind(employeeNo)
    .first<{ employee_no: string }>();

  if (!target) {
    return { ok: false as const, message: "활성 직원 정보를 찾을 수 없습니다." };
  }

  const activeActor = await db
    .prepare(
      `
        SELECT id
        FROM employees
        WHERE id = ?
          AND role IN ('ADMIN', 'DIRECTOR')
          AND is_active = 1
      `,
    )
    .bind(actor.id)
    .first<{ id: number }>();

  if (!activeActor) {
    return { ok: false as const, message: "관리자 권한을 확인할 수 없습니다." };
  }

  const insertBonus = await db
    .prepare(
      `
        INSERT INTO dice_bonuses (employee_no, reason)
        VALUES (?, ?)
      `,
    )
    .bind(employeeNo, reason)
    .run();

  return { ok: true as const, id: Number(insertBonus.meta.last_row_id) };
}
