import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../functions/lib/auth", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    authGuard: () => async (c, next) => {
      c.set("employee", { employee_no: "DICE_TEST", is_active: 1, role: "USER" });
      await next();
    },
  };
});

const { app } = await import("../../functions/api/[[route]]");

let sqlite;
let db;
let faces;

// Execute the production SQL against real SQLite instead of mocking its results.
function sqliteBinding(database) {
  return {
    prepare(sql) {
      let parameters = [];
      return {
        bind(...values) {
          parameters = values;
          return this;
        },
        async first() {
          return database.prepare(sql).get(...parameters) ?? null;
        },
        async all() {
          return { success: true, results: database.prepare(sql).all(...parameters) };
        },
        async run() {
          const result = database.prepare(sql).run(...parameters);
          return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
      };
    },
  };
}

function request(path, values = []) {
  faces = values;
  return app.request(`/api/dice/${path}`, {
    method: path === "ranking" ? "GET" : "POST",
    ...(path === "reroll" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}),
  }, { DB: db });
}

function monthlyScore() {
  return sqlite.prepare("SELECT score, rolls, attempts FROM dice_monthly_scores WHERE employee_no = 'DICE_TEST' AND month_start = '2026-09-01'").get();
}

function usedBonuses() {
  return sqlite.prepare("SELECT COUNT(*) AS count FROM dice_bonuses WHERE employee_no = 'DICE_TEST' AND used = 1").get()?.count;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-09T01:00:00Z"));
  faces = [];
  vi.stubGlobal("crypto", {
    getRandomValues(array) {
      array[0] = (faces.shift() ?? 1) - 1;
      return array;
    },
  });
  sqlite = new DatabaseSync(":memory:");
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master").get()?.count).toBe(0);
  sqlite.function("current_timestamp", () => new Date().toISOString().replace("T", " ").slice(0, 19));
  sqlite.exec("CREATE TABLE employees (employee_no TEXT PRIMARY KEY, name TEXT, joined_at TEXT, is_active INTEGER)");
  for (const migration of ["0013_dice_game.sql", "0014_double_dice_score.sql", "0015_dice_monthly_scores.sql"]) {
    sqlite.exec(readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), "utf8"));
  }
  sqlite.exec("INSERT INTO employees VALUES ('DICE_TEST', 'Dice Test', '2026-09-01', 1)");
  for (let index = 0; index < 5; index += 1) {
    sqlite.exec("INSERT INTO dice_bonuses (employee_no, reason) VALUES ('DICE_TEST', 'monthly_reroll:2026-09')");
  }
  db = sqliteBinding(sqlite);
});

afterEach(() => {
  sqlite.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("dice score persistence", () => {
  it("returns a successful regular roll with the score and ranking already updated", async () => {
    const response = await request("roll", [3, 4]);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.roll).toMatchObject({ dieOne: 3, dieTwo: 4, rollScore: 7, source: "DAILY", rollDate: "2026-09-01" });
    expect(body.ranking.me).toMatchObject({ score: 7, rolls: 1, rank: 1 });
    expect(body.status).toMatchObject({ regularAvailable: 7, bonusAvailable: 5, rerollAvailableToday: true });
    expect(monthlyScore()).toEqual({ score: 7, rolls: 1, attempts: 1 });
    expect(usedBonuses()).toBe(0);
  });

  it("replaces a lower score with a double reroll and consumes exactly one bonus", async () => {
    expect((await request("roll", [3, 4])).status).toBe(201);
    const response = await request("reroll", [6, 6]);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.roll).toMatchObject({ dieOne: 6, dieTwo: 6, isDouble: true, rollScore: 24, source: "BONUS" });
    expect(body.ranking.me.score).toBe(24);
    expect(body.status).toMatchObject({ regularAvailable: 7, bonusAvailable: 4, todayRerollUsed: true, rerollAvailableToday: false });
    expect(monthlyScore()).toEqual({ score: 24, rolls: 1, attempts: 2 });
    expect(usedBonuses()).toBe(1);
    const ranking = await (await request("ranking")).json();
    expect(ranking.me.score).toBe(24);
  });

  it.each([[1, 2], [6, 6]])("keeps the previous best when rerolling %i and %i", async (first, second) => {
    expect((await request("roll", [6, 6])).status).toBe(201);
    expect((await request("reroll", [first, second])).status).toBe(201);
    expect(monthlyScore()).toEqual({ score: 24, rolls: 1, attempts: 2 });
    expect(usedBonuses()).toBe(1);
  });

  it("rerolls only the latest regular roll when accumulated credits are used together", async () => {
    expect((await request("roll", [3, 4])).status).toBe(201);
    vi.setSystemTime(new Date("2026-09-09T01:00:03Z"));
    expect((await request("roll", [1, 2])).status).toBe(201);
    expect(monthlyScore()).toEqual({ score: 10, rolls: 2, attempts: 2 });
    const response = await request("reroll", [6, 6]);
    expect(response.status).toBe(201);
    expect((await response.json()).roll.rollDate).toBe("2026-09-02");
    expect(monthlyScore()).toEqual({ score: 31, rolls: 2, attempts: 3 });
  });

  it("rejects a second reroll on the same day without consuming another bonus", async () => {
    expect((await request("roll", [3, 4])).status).toBe(201);
    expect((await request("reroll", [6, 6])).status).toBe(201);
    expect((await request("reroll", [5, 5])).status).toBe(409);
    expect(monthlyScore()).toEqual({ score: 24, rolls: 1, attempts: 2 });
    expect(usedBonuses()).toBe(1);
  });

  it("rejects a reroll before a regular roll and when the only regular roll was yesterday", async () => {
    expect((await request("reroll", [6, 6])).status).toBe(409);
    expect(usedBonuses()).toBe(0);
    vi.setSystemTime(new Date("2026-09-08T01:00:00Z"));
    expect((await request("roll", [3, 4])).status).toBe(201);
    vi.setSystemTime(new Date("2026-09-09T01:00:00Z"));
    expect((await request("reroll", [6, 6])).status).toBe(409);
    expect(monthlyScore()).toEqual({ score: 7, rolls: 1, attempts: 1 });
    expect(usedBonuses()).toBe(0);
  });

  it("keeps other employees and previous months separate", async () => {
    sqlite.exec("INSERT INTO dice_monthly_scores (month_start, employee_no, score, rolls, attempts) VALUES ('2026-08-01', 'DICE_TEST', 100, 10, 10), ('2026-09-01', 'OTHER_TEST', 12, 1, 1)");
    expect((await request("roll", [3, 4])).status).toBe(201);
    expect(monthlyScore()).toEqual({ score: 7, rolls: 1, attempts: 1 });
    expect(sqlite.prepare("SELECT month_start, employee_no, score FROM dice_monthly_scores WHERE month_start = '2026-08-01' OR employee_no = 'OTHER_TEST' ORDER BY month_start").all()).toEqual([
      { month_start: "2026-08-01", employee_no: "DICE_TEST", score: 100 },
      { month_start: "2026-09-01", employee_no: "OTHER_TEST", score: 12 },
    ]);
  });
});
