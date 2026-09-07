# School Management Plugin Backend v1

The School Management plugin is mounted at `/api/v1/school` and reuses Ledgerly's existing organization, JWT session, membership, scope, audit-log, accounting-contact, product and chart-of-account infrastructure.

## Enable the module

`POST /api/v1/modules/school-management/enable`

The module is disabled per organization until explicitly enabled by an owner/admin. `GET /api/v1/modules` returns module state. The plugin manifest is available at `GET /api/v1/school/manifest`.

## Backend modules implemented in this release

### School setup and configuration

Routes live under `/api/v1/school/setup`. The backend provides school profile and branding, branches/campuses, academic years, terms, departments, class levels, classes, streams, subjects, class-subject assignments, grading scales, grade boundaries, divisions, assessment types, promotion rules, calendar entries, lesson periods, fee categories linked to Ledgerly accounts/products, payment methods linked to ledger accounts, document templates, flexible grouped system settings, and setup-completion status.

The flexible settings store is intended for typed configuration groups including numbering, attendance, examinations, promotion, notifications, SMS, email, WhatsApp, document generation, locale/date-time, import behaviour and system defaults without forcing future migrations for every vendor-specific setting.

### School identity, roles and security

Routes live under `/api/v1/school/iam`. Core authentication remains Ledgerly's `users`, `memberships`, `sessions` and JWTs. The plugin adds built-in/custom school roles, arbitrary permission strings, multiple roles per user, campus/department/class/stream/subject/student/parent access constraints, temporary permissions, school user profiles, username/phone login aliases, staff numbers, signatures/profile photos, activation/suspension/locking state, notification preferences, session history/revocation, login history, password reset by authorized administrators, security policies and TOTP MFA with one-use recovery codes.

`POST /api/v1/school/iam/bootstrap` creates the standard school roles and baseline permission presets. Login through `/auth/login` now accepts `identifier` (email, username or phone). Username/phone login requires `organizationId` to keep aliases tenant-safe. TOTP is enforced by `/auth/login` when enabled for the user.

### Student management and admissions

Routes live under `/api/v1/school/student-management`. The backend supports admission applications and decisions, waiting-list states, enrollment from approved applications, manual student admission, automatic admission/student numbers, student profiles and class placement, guardians and financial responsibility, medical/support data, enrollment history, status history, notes, document metadata, sibling links, transfers, promotions/repetition/graduation, student timeline, filtered class/stream/year/campus lists, JSON bulk import with an auditable import job, enrollment reports and demographic reports.

Every admitted student is connected to a Ledgerly customer/contact record so later School Fees can use the existing invoicing, receivables, payment and ledger engine rather than creating a second accounting subsystem.

## Database migration

Apply `migrations/0009_school_management_plugin.sql` before deploying the new routes. It adds the generic module registry and the normalized School Management tables. The migration was validated with SQLite foreign keys enabled.

## Permissions

At the Ledgerly membership layer, users require `school:read` / `school:write` unless they are owner/admin. School-level permission strings then provide finer control, including:

- `school.setup:read`, `school.setup:write`
- `school.users:read`, `school.users:write`
- `school.students:read`, `school.students:write`, `school.students:approve`, `school.students:export`
- `school.finance:read`, `school.finance:write`

Future school modules (fees, attendance, examinations, timetable, library, boarding, transport, discipline and communications) should add their own permissions to the same role model.

## Staff, files and payroll integration (v1.1.0)

The School Management plugin now includes a first-class staff/teacher and protected-file backend in addition to Setup, IAM and Student Management.

### R2-backed school files

School uploads are handled through `/api/v1/school/files`. Files are written to the existing `REPORTS_BUCKET` R2 binding under tenant-isolated object keys and recorded in `school_files`. The API validates file size and MIME type, stores a SHA-256 checksum, requires an authenticated organization context for reads/downloads, and refuses deletion while a file is referenced by a school profile, user photo/signature, template, student record/document, guardian/pickup photo, staff profile, qualification or staff document.

### Staff & Teacher Management

`/api/v1/school/staff-management` provides staff positions, staff profiles, emergency contacts, qualifications, subjects taught, class/stream/subject assignments, staff documents, recurring compensation, one-off payroll adjustments, payslips and salary installment payments. Staff records can be linked to campuses, departments, positions and existing school logins.

Creating staff automatically creates or links the corresponding Ledgerly employee contact and payroll employee. It also creates an individual Staff Payable control account beneath the school payroll payable control structure. This keeps HR records and the general ledger connected instead of maintaining a separate school payroll ledger.

### Payroll and installments

Recurring compensation supports salary, commission, allowance, bonus, overtime, benefit, deduction, loan recovery, salary advance and other components. Payroll posting credits the staff member's individual payable account. A posted payslip tracks the net amount, amount paid, outstanding balance and payment status. One salary can therefore be settled through multiple Ledgerly payments during the month. Each installment debits the employee's Staff Payable account and credits the selected cash/bank account; reversing an installment restores the payslip balance.

### Validation errors

School APIs return actionable `AppError` messages for business-rule conflicts such as duplicate class/term sequences, duplicate subject allocations, duplicate teaching assignments, invalid references, protected file deletion, and salary payments above the outstanding balance. Production responses no longer collapse known database conflicts into a generic unexpected-error message.

## Fees & Billing backend (v1.2.0)

`/api/v1/school/fees` implements school fee configuration, billing, collection and reporting on top of Ledgerly documents, payments, journals, contacts and chart of accounts. It includes fee structures, concessions, student awards, automatic accounting provisioning, individual/bulk/scheduled billing, manual charges, credits, write-offs, late fees, opening balances, receipts and allocations, payer credits, refunds, payment plans, holds/clearance, imports and reports.

Fee receipts and refunds retain their Ledgerly accounting linkage. Charge detail exposes credit/write-off history for auditable reversals, refunds can be listed and reversed, and school fee credit notes use their own numbering sequence rather than consuming the school invoice sequence.
