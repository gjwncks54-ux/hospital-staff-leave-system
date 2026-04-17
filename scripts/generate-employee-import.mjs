import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";

const [, , inputPathArg, outputPathArg, rootNameArg, divisionNameArg] = process.argv;

if (!inputPathArg || !outputPathArg) {
  console.error(
    "Usage: node scripts/generate-employee-import.mjs <input.csv> <output.sql> [rootName] [divisionName]",
  );
  process.exit(1);
}

const inputPath = resolve(inputPathArg);
const outputPath = resolve(outputPathArg);
const rootName = rootNameArg || "우리베스트내과의원";
const divisionName = divisionNameArg || "병원";
const initialPasswordSuffix = "!";
const validRoles = new Set(["USER", "LEADER", "HR", "ADMIN", "DIRECTOR"]);
const expectedHeaders = [
  "employee_no",
  "name",
  "email",
  "joined_at",
  "role",
  "org_unit_name",
  "leader_employee_no",
  "is_active",
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

function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = createHash("sha256").update(`${password}:${salt}`, "utf8").digest("hex");
  return `sha256$${salt}$${derived}`;
}

const csvText = decodeCsv(readFileSync(inputPath));
const rows = parseCsv(csvText);
const employeeNoSet = new Set();
const emailSet = new Set();
const teamIdByName = new Map();
const employeeIdByNo = new Map();

rows.forEach((row, index) => {
  if (!row.employee_no) {
    throw new Error(`Row ${index + 2} is missing employee_no.`);
  }

  if (employeeNoSet.has(row.employee_no)) {
    throw new Error(`Duplicate employee_no: ${row.employee_no}`);
  }
  employeeNoSet.add(row.employee_no);

  if (!row.email) {
    throw new Error(`Row ${index + 2} (${row.employee_no}) is missing email.`);
  }

  if (emailSet.has(row.email.toLowerCase())) {
    throw new Error(`Duplicate email: ${row.email}`);
  }
  emailSet.add(row.email.toLowerCase());

  if (!validRoles.has(row.role)) {
    throw new Error(`Invalid role on row ${index + 2}: ${row.role}`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.joined_at)) {
    throw new Error(`Invalid joined_at on row ${index + 2}: ${row.joined_at}`);
  }

  if (!["0", "1"].includes(row.is_active)) {
    throw new Error(`Invalid is_active on row ${index + 2}: ${row.is_active}`);
  }

  if (row.org_unit_name && !teamIdByName.has(row.org_unit_name)) {
    teamIdByName.set(row.org_unit_name, teamIdByName.size + 10);
  }

  employeeIdByNo.set(row.employee_no, index + 1);
});

rows.forEach((row, index) => {
  if (row.leader_employee_no && !employeeIdByNo.has(row.leader_employee_no)) {
    throw new Error(`Unknown leader_employee_no on row ${index + 2}: ${row.leader_employee_no}`);
  }
});

const orgUnitValues = [
  `(1, ${sqlString(rootName)}, 'ROOT', NULL)`,
  `(2, ${sqlString(divisionName)}, 'DIVISION', 1)`,
  ...Array.from(teamIdByName.entries()).map(
    ([teamName, teamId]) => `(${teamId}, ${sqlString(teamName)}, 'TEAM', 2)`,
  ),
];

const employeeValues = rows.map((row, index) => {
  const employeeId = index + 1;
  const orgUnitId = row.org_unit_name ? teamIdByName.get(row.org_unit_name) : null;
  const leaderId = row.leader_employee_no ? employeeIdByNo.get(row.leader_employee_no) : null;
  const initialPassword = `${row.employee_no}${initialPasswordSuffix}`;

  return [
    employeeId,
    sqlString(row.employee_no),
    sqlString(row.name),
    sqlString(row.email),
    sqlString(passwordHash(initialPassword)),
    sqlString(row.joined_at),
    "NULL",
    sqlString(row.role),
    orgUnitId ?? "NULL",
    leaderId ?? "NULL",
    row.is_active,
  ].join(", ");
});

const sql = [
  "PRAGMA foreign_keys = ON;",
  "DELETE FROM leave_request_events;",
  "DELETE FROM leave_requests;",
  "DELETE FROM notices;",
  "DELETE FROM employees;",
  "DELETE FROM org_units;",
  "DELETE FROM sqlite_sequence WHERE name IN ('leave_request_events', 'leave_requests', 'notices', 'employees', 'org_units');",
  "",
  "INSERT INTO org_units (id, name, unit_type, parent_id) VALUES",
  `  ${orgUnitValues.join(",\n  ")};`,
  "",
  "INSERT INTO employees (",
  "  id,",
  "  employee_no,",
  "  name,",
  "  email,",
  "  password_hash,",
  "  joined_at,",
  "  retired_at,",
  "  role,",
  "  org_unit_id,",
  "  leader_id,",
  "  is_active",
  ") VALUES",
  `  (${employeeValues.join("),\n  (")});`,
  "",
].join("\n");

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, sql, "utf8");

const summary = {
  inputPath,
  outputPath,
  employeeCount: rows.length,
  orgUnitCount: teamIdByName.size,
  rootName,
  divisionName,
  initialPasswordRule: `employee_no${initialPasswordSuffix}`,
};

console.log(JSON.stringify(summary, null, 2));
