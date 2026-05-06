import type { DiceRankingResponse, DiceRankItem, DiceRollKind, DiceStatus } from "../../src/types";

const DAY_MS = 86400000;
const ACTIVE_WINDOW_DAYS = 365;

type CountRow = { count: number };
type LastRollRow = { roll_value: number; roll_kind: DiceRollKind; created_at: string };
type BonusRow = { id: number };
type RankingRow = {
  employee_no: string;
  employee_name: string;
  team_name: string | null;
  score: number;
  roll_count: number;
  rank: number;
};

export type DiceStatusCounts = {
  regularRolledToday: number;
  rolledToday: number;
  unusedBonusCount: number;
  lastRollValue?: number | null;
  lastRollKind?: DiceRollKind | null;
};

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function formatDiceKstDate(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function getDiceActiveCutoffDate(today: string) {
  return formatDate(new Date(parseDate(today).getTime() - ACTIVE_WINDOW_DAYS * DAY_MS));
}

function getCurrentMonthRange(today: string) {
  const [year, month] = today.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { start, end, label: start.slice(0, 7) };
}

export function buildDiceStatus(counts: DiceStatusCounts): DiceStatus {
  const regularAvailable = counts.regularRolledToday === 0;
  const bonusAvailable = Math.max(0, counts.unusedBonusCount);
  const rollsRemaining = regularAvailable ? 1 : bonusAvailable;

  return {
    canRoll: rollsRemaining > 0,
    regularAvailable,
    bonusAvailable,
    rollsRemaining,
    rolledToday: counts.rolledToday,
    lastRollValue: counts.lastRollValue ?? null,
    lastRollKind: counts.lastRollKind ?? null,
  };
}

export function getNextDiceRollKind(status: DiceStatus): DiceRollKind | null {
  if (status.regularAvailable) return "REGULAR";
  if (status.bonusAvailable > 0) return "BONUS";
  return null;
}

function getRandomDiceValue() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return (values[0] % 6) + 1;
}

async function countFirst(db: D1Database, sql: string, ...bindings: Array<string | number>) {
  const row = await db.prepare(sql).bind(...bindings).first<CountRow>();
  return row?.count ?? 0;
}

export async function getDiceStatusForEmployee(db: D1Database, employeeNo: string, asOf = new Date()) {
  const today = formatDiceKstDate(asOf);
  const cutoff = getDiceActiveCutoffDate(today);

  const [regularRolledToday, rolledToday, unusedBonusCount, lastRoll] = await Promise.all([
    countFirst(
      db,
      `
        SELECT COUNT(*) AS count
        FROM dice_rolls
        WHERE employee_no = ?
          AND roll_date = ?
          AND roll_date >= ?
          AND roll_kind = 'REGULAR'
      `,
      employeeNo,
      today,
      cutoff,
    ),
    countFirst(
      db,
      `
        SELECT COUNT(*) AS count
        FROM dice_rolls
        WHERE employee_no = ?
          AND roll_date = ?
          AND roll_date >= ?
      `,
      employeeNo,
      today,
      cutoff,
    ),
    countFirst(
      db,
      `
        SELECT COUNT(*) AS count
        FROM dice_bonuses
        WHERE employee_no = ?
          AND used = 0
          AND substr(created_at, 1, 10) >= ?
      `,
      employeeNo,
      cutoff,
    ),
    db
      .prepare(
        `
          SELECT roll_value, roll_kind, created_at
          FROM dice_rolls
          WHERE employee_no = ?
            AND roll_date = ?
            AND roll_date >= ?
          ORDER BY roll_value DESC, id DESC
          LIMIT 1
        `,
      )
      .bind(employeeNo, today, cutoff)
      .first<LastRollRow>(),
  ]);

  return buildDiceStatus({
    regularRolledToday,
    rolledToday,
    unusedBonusCount,
    lastRollValue: lastRoll?.roll_value ?? null,
    lastRollKind: lastRoll?.roll_kind ?? null,
  });
}

async function consumeOldestBonus(db: D1Database, employeeNo: string, cutoff: string) {
  return db
    .prepare(
      `
        UPDATE dice_bonuses
        SET used = 1
        WHERE id = (
          SELECT id
          FROM dice_bonuses
          WHERE employee_no = ?
            AND used = 0
            AND substr(created_at, 1, 10) >= ?
          ORDER BY created_at ASC, id ASC
          LIMIT 1
        )
        RETURNING id
      `,
    )
    .bind(employeeNo, cutoff)
    .first<BonusRow>();
}

async function insertRegularRoll(db: D1Database, employeeNo: string, today: string, cutoff: string, rollValue: number) {
  const result = await db
    .prepare(
      `
        INSERT INTO dice_rolls (employee_no, roll_date, roll_value, roll_kind, created_at)
        SELECT ?, ?, ?, 'REGULAR', CURRENT_TIMESTAMP
        WHERE NOT EXISTS (
          SELECT 1
          FROM dice_rolls
          WHERE employee_no = ?
            AND roll_date = ?
            AND roll_date >= ?
            AND roll_kind = 'REGULAR'
        )
      `,
    )
    .bind(employeeNo, today, rollValue, employeeNo, today, cutoff)
    .run();

  return result.meta.changes > 0;
}

export async function rollDiceForEmployee(db: D1Database, employeeNo: string, asOf = new Date()) {
  const today = formatDiceKstDate(asOf);
  const cutoff = getDiceActiveCutoffDate(today);
  const status = await getDiceStatusForEmployee(db, employeeNo, asOf);
  const rollKind = getNextDiceRollKind(status);

  if (!rollKind) {
    return { rolled: false as const, status };
  }

  const rollValue = getRandomDiceValue();
  let bonusId: number | null = null;

  if (rollKind === "BONUS") {
    const bonus = await consumeOldestBonus(db, employeeNo, cutoff);
    if (!bonus) {
      return { rolled: false as const, status: await getDiceStatusForEmployee(db, employeeNo, asOf) };
    }
    bonusId = bonus.id;
    await db
      .prepare(
        `
          INSERT INTO dice_rolls (employee_no, roll_date, roll_value, roll_kind, bonus_id, created_at)
          VALUES (?, ?, ?, 'BONUS', ?, CURRENT_TIMESTAMP)
        `,
      )
      .bind(employeeNo, today, rollValue, bonusId)
      .run();
  } else {
    const inserted = await insertRegularRoll(db, employeeNo, today, cutoff, rollValue);
    if (!inserted) {
      return { rolled: false as const, status: await getDiceStatusForEmployee(db, employeeNo, asOf) };
    }
  }

  return {
    rolled: true as const,
    rollValue,
    rollKind,
    bonusId,
    status: await getDiceStatusForEmployee(db, employeeNo, asOf),
  };
}

function toRankItem(row: RankingRow): DiceRankItem {
  return {
    rank: row.rank,
    employeeNo: row.employee_no,
    employeeName: row.employee_name,
    teamName: row.team_name ?? "-",
    score: row.score,
    rollCount: row.roll_count,
  };
}

const rankedScoresSql = `
  WITH daily_scores AS (
    SELECT
      employee_no,
      roll_date,
      MAX(roll_value) AS daily_score
    FROM dice_rolls
    WHERE roll_date >= ?
      AND roll_date < ?
      AND roll_date >= ?
    GROUP BY employee_no, roll_date
  ),
  scores AS (
    SELECT
      ds.employee_no,
      COALESCE(e.name, ds.employee_no) AS employee_name,
      team.name AS team_name,
      SUM(ds.daily_score) AS score,
      COUNT(*) AS roll_count
    FROM daily_scores ds
    LEFT JOIN employees e ON e.employee_no = ds.employee_no
    LEFT JOIN org_units team ON team.id = e.org_unit_id
    GROUP BY ds.employee_no
  ),
  ranked AS (
    SELECT
      employee_no,
      employee_name,
      team_name,
      score,
      roll_count,
      RANK() OVER (ORDER BY score DESC, roll_count DESC, employee_no ASC) AS rank
    FROM scores
  )
`;

export async function getDiceRankingForEmployee(db: D1Database, employeeNo: string, asOf = new Date()): Promise<DiceRankingResponse> {
  const today = formatDiceKstDate(asOf);
  const cutoff = getDiceActiveCutoffDate(today);
  const month = getCurrentMonthRange(today);

  const [topResult, meRow, totalParticipants] = await Promise.all([
    db
      .prepare(
        `
          ${rankedScoresSql}
          SELECT employee_no, employee_name, team_name, score, roll_count, rank
          FROM ranked
          ORDER BY rank ASC, employee_no ASC
          LIMIT 3
        `,
      )
      .bind(month.start, month.end, cutoff)
      .all<RankingRow>(),
    db
      .prepare(
        `
          ${rankedScoresSql}
          SELECT employee_no, employee_name, team_name, score, roll_count, rank
          FROM ranked
          WHERE employee_no = ?
          LIMIT 1
        `,
      )
      .bind(month.start, month.end, cutoff, employeeNo)
      .first<RankingRow>(),
    countFirst(
      db,
      `
        SELECT COUNT(DISTINCT employee_no) AS count
        FROM dice_rolls
        WHERE roll_date >= ?
          AND roll_date < ?
          AND roll_date >= ?
      `,
      month.start,
      month.end,
      cutoff,
    ),
  ]);

  return {
    month: month.label,
    top: topResult.results.map(toRankItem),
    me: meRow
      ? toRankItem(meRow)
      : {
          rank: null,
          employeeNo,
          employeeName: "",
          teamName: "",
          score: 0,
          rollCount: 0,
        },
    totalParticipants,
  };
}

export async function grantDiceBonus(db: D1Database, employeeNo: string, reason: string) {
  const result = await db
    .prepare(
      `
        INSERT INTO dice_bonuses (employee_no, reason, used, created_at)
        VALUES (?, ?, 0, CURRENT_TIMESTAMP)
      `,
    )
    .bind(employeeNo, reason)
    .run();

  return result.meta.last_row_id;
}
