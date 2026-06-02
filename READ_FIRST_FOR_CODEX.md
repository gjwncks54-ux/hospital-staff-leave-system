# Read First For Codex

This repository is an active hospital staff leave-management web app. Treat it as production software, not a throwaway prototype.

## Project Snapshot

- Project: Hospital Staff Leave Management System
- Production URL: https://hospital-staff-leave-system-a6q.pages.dev
- GitHub repository: https://github.com/gjwncks54-ux/hospital-staff-leave-system
- Default branch: `main`
- Stack: React, Vite, TypeScript, Tailwind CSS, Zustand, Cloudflare Pages Functions, Hono, Cloudflare D1
- Deployment command: `npm run cf:deploy`
- Verification commands: `npm test`, `npm run build`
- D1 binding: `DB`
- Cloudflare account: `so7172@naver.com` / `17bcb091e79dc5a01cdcab39bc110c63`
- D1 database: `hospital-staff-leave-db` / `92afa7e7-10b5-423a-a5ea-383af8a46b89`

## Non-Negotiable Rules

- Gather evidence before editing files.
- Never reset, wipe, seed over, or recreate the production D1 database without explicit user approval.
- Never commit secrets, cookies, local temp files, or credentials.
- Do not commit `.tmp-*`, `.claude/`, `.wrangler/`, or environment files containing real secrets.
- Do not use destructive Git commands such as `git reset --hard` unless the user explicitly asks and understands the impact.
- After business-logic changes, run `npm test` and `npm run build`.
- After deployment, verify the production URL responds.
- Before deployment, verify `npx wrangler whoami` shows `so7172@naver.com` and account ID `17bcb091e79dc5a01cdcab39bc110c63`.
- Do not deploy to or use the old developer-owned URL `https://hospital-staff-leave-system.pages.dev`.
- Do not use the old developer-owned D1 database ID `5f524992-a63f-49a0-ad96-c0b9c09f3441`.
- Prefer small, focused changes over broad rewrites.

## Current Product Behavior

- Employees log in with employee number and password.
- Sessions use an HTTP-only JWT cookie.
- Login rate limiting has intentionally been removed.
- The app is mobile-first and is used as a web app, not an app-store app.
- Employee home shows leave balance, request actions, notices, and relevant approvals/history.
- Admin and Director can manage employees and see the employee management tab.
- HR has approval authority only and does not manage employee records.

## Roles And Permissions

- `USER`: can request leave and view own leave/balance/history.
- `LEADER`: can request leave, view own/team scope, and approve only the leader stage for direct reports.
- `HR`: can approve only the HR stage in the normal approval order.
- `ADMIN`: can manage employees, edit notices, export leave summaries, and super-pass approvals.
- `DIRECTOR`: has admin-level operational powers and super-pass approval.

## Approval Rules

- Staff leave flow with leader: employee -> leader -> HR.
- Staff leave flow without leader: employee -> HR.
- Leader leave flow: leader -> HR.
- Director/Admin can super-pass in-flight approvals.
- Final approved leave can be cancelled by Admin/Director and relevant final approver behavior in code.
- Requester can cancel their own pending request before first approval.

## Leave Calculation Rules

- Leave is not accrued into the DB daily. It is calculated in real time when API/screen data is requested.
- Date boundaries must be based on Korea time (KST).
- Leave is calculated from each employee's `joined_at`.
- Under 1 year: 1 day per completed month, max 11.
- Under 1 year: if unpaid leave overlaps a monthly accrual period, that month's monthly leave is blocked.
- 1 year or more: 15 days on work anniversary, plus 1 day every 2 years, max 25.
- Half-day leave is 0.5 day.
- Public/official leave (`SICK` in legacy enum, displayed as public leave) does not consume annual leave.
- Unpaid leave does not consume annual leave, but can affect under-1-year monthly accrual.

## Admin Leave Adjustment Rules

- In the employee edit form, the visible leave input means target final remaining leave, not raw adjustment.
- Internally: `leave_adjustment_days = target_remaining - automatic_base_remaining`.
- Display formula: `entitlement + adjustment - used - pending = remaining`.
- Employee cards in the Admin/Director employee tab show remaining leave and calculation basis.
- If leave adjustment changes, a reason is required.
- Adjustment logs must be written to `employee_leave_adjustments`.
- Mobile input must allow negative values; the UI uses text input with decimal input mode and validates before save.

## Important Recent Fixes

- KST date calculation was fixed for work-anniversary boundaries.
- Admin employee cards now show remaining leave and calculation basis.
- Employee edit leave field now behaves as target final remaining leave.
- Leave adjustment logs are written when adjustment changes.
- Login rate limiting was removed intentionally.
- Mobile negative leave input was fixed by avoiding `input type="number"`.

## Known Historical Caveat

There was a historical incident where one employee displayed `entitlement 17.0`, `used 0.0`, `pending 0.0`, but `remaining 1.0`. Current DB state did not allow reproducing it, and old adjustment logs were missing because the log write call had not been wired. Logging is now fixed, but the historical root cause cannot be proven from existing data.

## Database Safety

- Before any production `UPDATE` or `DELETE`, run a `SELECT` to confirm exact target rows.
- For production D1, use `npx wrangler d1 execute DB --remote --command "..."` only after confirming Wrangler is logged in to the client Cloudflare account.
- Existing migrations that may already be applied should not be rewritten for production fixes. Add a new migration instead.
- Employee mass changes should be generated and reviewed before execution.

## Key Files

- API routes: `functions/api/[[route]].ts`
- DB helpers: `functions/lib/db.ts`
- Auth/session: `functions/lib/auth.ts`
- Leave calculation: `functions/lib/leave.ts`
- Approval rules: `src/lib/approval-flow.ts`
- Main dashboard: `src/components/dashboard-shell.tsx`
- Leave store: `src/stores/leave-store.ts`
- Auth store: `src/stores/auth-store.ts`
- Shared types: `src/types.ts`
- Migrations: `migrations/`
- Machine-readable context: `project-context.json`

## Recommended Workflow For Future Codex

1. Read this file and `project-context.json`.
2. Run `git status --short`.
3. Inspect relevant files before editing.
4. Make targeted edits.
5. Run `npm test`.
6. Run `npm run build`.
7. If deploying, run `npm run cf:deploy` and verify `https://hospital-staff-leave-system-a6q.pages.dev`.
8. If changes should persist for other machines, commit and push to `main`.
