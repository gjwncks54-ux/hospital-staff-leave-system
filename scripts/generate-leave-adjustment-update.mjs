import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [, , inputPathArg, outputPathArg, baseUrlArg, employeeNoArg, passwordArg] = process.argv;

if (!inputPathArg || !outputPathArg || !baseUrlArg || !employeeNoArg || !passwordArg) {
  console.error(
    "Usage: node scripts/generate-leave-adjustment-update.mjs <input.csv> <output.sql> <baseUrl> <employeeNo> <password>",
  );
  process.exit(1);
}

const inputPath = resolve(inputPathArg);
const outputPath = resolve(outputPathArg);
const baseUrl = baseUrlArg.replace(/\/$/, "");
const expectedHeaders = [
  "employee_no",
  "name",
  "email",
  "joined_at",
  "role",
  "org_unit_name",
  "leader_employee_no",
  "is_active",
  "initial_remaining_days",
];

function decodeCsv(buffer) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (!utf8.includes("employee_no,name,email")) {
    return new TextDecoder("euc-kr", { fatal: false }).decode(buffer);
  }

  if (utf8.includes("\uFFFD")) {
    return new TextDecoder("euc-kr", { fatal: false }).decode(buffer);
  }

  return utf8;
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV has no data rows.");
  }

  const headers = lines[0].split(",");
  if (headers.join(",") !== expectedHeaders.join(",")) {
    throw new Error(`Unexpected CSV headers: ${headers.join(", ")}`);
  }

  return lines.slice(1).map((line, index) => {
    const values = line.split(",");
    if (values.length !== headers.length) {
      throw new Error(`Row ${index + 2} has ${values.length} columns; expected ${headers.length}.`);
    }

    return Object.fromEntries(headers.map((header, valueIndex) => [header, values[valueIndex]?.trim() ?? ""]));
  });
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseRemainingDays(value, rowIndex) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid initial_remaining_days on row ${rowIndex + 2}: ${value}`);
  }
  return parsed;
}

async function request(path, init = {}, cookie = "") {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} ${response.status}: ${text}`);
  }

  return { response, text };
}

const csvText = decodeCsv(readFileSync(inputPath));
const rows = parseCsv(csvText);

const login = await request("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({
    employeeNo: employeeNoArg,
    password: passwordArg,
  }),
});

const cookie = login.response.headers.get("set-cookie");
if (!cookie) {
  throw new Error("Login succeeded but no session cookie was returned.");
}

const exportResponse = await request("/api/admin/employees/export", {}, cookie);
const exportPayload = JSON.parse(exportResponse.text);
const currentSummaryByEmployeeNo = new Map(exportPayload.items.map((item) => [item.employeeNo, item]));

const updates = rows
  .map((row, index) => {
    const current = currentSummaryByEmployeeNo.get(row.employee_no);
    if (!current) {
      throw new Error(`Employee not found in export: ${row.employee_no}`);
    }

    const targetRemaining = parseRemainingDays(row.initial_remaining_days, index);
    const diff = Number((targetRemaining - Number(current.remaining)).toFixed(1));
    if (Math.abs(diff) < 0.05) {
      return null;
    }

    return `UPDATE employees SET leave_adjustment_days = ROUND(COALESCE(leave_adjustment_days, 0) + (${diff}), 1), updated_at = CURRENT_TIMESTAMP WHERE employee_no = ${sqlString(row.employee_no)};`;
  })
  .filter(Boolean);

const sql = [
  "BEGIN TRANSACTION;",
  ...updates,
  "COMMIT;",
  "",
].join("\n");

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, sql, "utf8");

console.log(
  JSON.stringify(
    {
      inputPath,
      outputPath,
      baseUrl,
      employeeCount: rows.length,
      updatedCount: updates.length,
    },
    null,
    2,
  ),
);
