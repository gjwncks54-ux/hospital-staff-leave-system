import type { EmployeeRecord } from "./db";

const DICE_LOOKBACK_DAYS = 365;
const DICE_TIME_ZONE = "Asia/Seoul";

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

export function getDiceToday() {
  return formatDateInZone(new Date(), DICE_TIME_ZONE);
}

function isSundayInDiceTimeZone() {
  return new Intl.DateTimeFormat("en-US", { timeZone: DICE_TIME_ZONE, weekday: "short" }).format(new Date()) === "Sun";
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

  const [todayRolls, bonusCount, recentRolls] = await Promise.all([
    db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM dice_rolls
          WHERE employee_no = ?
            AND roll_date = ?
            AND roll_kind = 'REGULAR'
            AND date(roll_date) >= date(?)
        `,
      )
      .bind(employeeNo, today, cutoff)
      .first<{ count: number }>(),
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
          SELECT id, employee_no, roll_date, roll_value, roll_kind, bonus_id, created_at
          FROM dice_rolls
          WHERE employee_no = ?
            AND date(roll_date) >= date(?)
          ORDER BY created_at DESC
          LIMIT 5
        `,
      )
      .bind(employeeNo, cutoff)
      .all<DiceRollRow>(),
  ]);

  const normalAvailable = !isSundayInDiceTimeZone() && Number(todayRolls?.count ?? 0) < 1;
  const bonusAvailable = Number(bonusCount?.count ?? 0);

  return {
    today,
    normalAvailable,
    bonusAvailable,
    totalAvailable: (normalAvailable ? 1 : 0) + bonusAvailable,
    recentRolls: recentRolls.results.map((row) => ({
      id: row.id,
      rollDate: row.roll_date,
      rollValue: row.roll_value,
      source: row.roll_kind === "BONUS" ? "BONUS" : "DAILY",
      createdAt: row.created_at,
    })),
  };
}

export async function rollDice(db: D1Database, employeeNo: string) {
  const today = getDiceToday();
  const cutoff = getDiceCutoffDate();
  const rollValue = crypto.getRandomValues(new Uint32Array(1))[0] % 6 + 1;

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

  if (availableBonus) {
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
          INSERT INTO dice_rolls (employee_no, roll_date, roll_value, roll_kind, bonus_id)
          VALUES (?, ?, ?, 'BONUS', ?)
        `,
      )
      .bind(employeeNo, today, rollValue, availableBonus.id)
      .run();

    return {
      ok: true as const,
      roll: { id: Number(insertRoll.meta.last_row_id), rollDate: today, rollValue, source: "BONUS" as const },
    };
  }

  if (isSundayInDiceTimeZone()) {
    return { ok: false as const, message: "일요일에는 오늘의 주사위 참여권이 생성되지 않습니다." };
  }

  const todayRolls = await db
    .prepare(
      `
          SELECT COUNT(*) AS count
          FROM dice_rolls
          WHERE employee_no = ?
            AND roll_date = ?
            AND roll_kind = 'REGULAR'
            AND date(roll_date) >= date(?)
      `,
    )
    .bind(employeeNo, today, cutoff)
    .first<{ count: number }>();

  if (Number(todayRolls?.count ?? 0) >= 1) {
    return { ok: false as const, message: "오늘의 일반 참여는 이미 완료되었습니다." };
  }

  const insertRoll = await db
    .prepare(
      `
        INSERT INTO dice_rolls (employee_no, roll_date, roll_value, roll_kind)
        SELECT ?, ?, ?, 'REGULAR'
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
    .bind(employeeNo, today, rollValue, employeeNo, today, cutoff)
    .run()
    .catch(() => null);

  if (!insertRoll || insertRoll.meta.changes < 1) {
    return { ok: false as const, message: "오늘의 일반 참여는 이미 완료되었습니다." };
  }

  return {
    ok: true as const,
    roll: { id: Number(insertRoll.meta.last_row_id), rollDate: today, rollValue, source: "DAILY" as const },
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
            MAX(dr.roll_value) AS daily_score,
            COUNT(*) AS attempts
          FROM dice_rolls dr
          WHERE date(dr.roll_date) >= date(?)
            AND date(dr.roll_date) >= date(?)
            AND date(dr.roll_date) < date(?)
          GROUP BY dr.employee_no, dr.roll_date
        ),
        monthly_scores AS (
          SELECT
            db.employee_no,
            COALESCE(e.name, db.employee_no) AS employee_name,
            SUM(db.daily_score) AS score,
            COUNT(*) AS rolls,
            SUM(db.attempts) AS attempts,
            RANK() OVER (ORDER BY SUM(db.daily_score) DESC) AS rank
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
            MAX(dr.roll_value) AS daily_score,
            COUNT(*) AS attempts
          FROM dice_rolls dr
          WHERE date(dr.roll_date) >= date(?)
            AND date(dr.roll_date) >= date(?)
            AND date(dr.roll_date) < date(?)
          GROUP BY dr.employee_no, dr.roll_date
        ),
        monthly_scores AS (
          SELECT
            db.employee_no,
            COALESCE(e.name, db.employee_no) AS employee_name,
            SUM(db.daily_score) AS score,
            COUNT(*) AS rolls,
            SUM(db.attempts) AS attempts,
            RANK() OVER (ORDER BY SUM(db.daily_score) DESC) AS rank
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
