# School Management Frontend

The School Management plugin frontend is implemented in `web/pages/SchoolManagementPages.tsx` and is mounted at `#school`.

## Navigation design

Ledgerly intentionally exposes only one top-level `School Management` entry in the main sidebar. The school workspace uses a compact secondary navigation so the primary application navigation does not become intimidating as school submodules grow.

Current internal workspaces:

- Overview
- Students
- Admissions
- Staff & teachers
- People & access
- School setup

Future school modules such as Attendance, Exams, Timetable, Library, Boarding, Transport, Discipline and Communications should be added inside the school workspace/module launcher rather than as dozens of top-level Ledgerly sidebar links.

## Implemented frontend coverage

### School setup

- School profile and localization
- Branches/campuses
- Academic years and terms
- Departments, class levels, classes and streams
- Subjects and class-subject assignments
- Grading scales, grade boundaries and divisions
- Assessment types and promotion rules
- School calendar and lesson periods
- Fee categories and payment methods linked to Ledgerly accounts/products
- Document templates
- Numbering, attendance, exam, promotion, notification, SMS, email, WhatsApp, report-card, import and system-default settings

### People & access

- Built-in and custom school roles
- Fine-grained school permissions
- User creation/editing on top of Ledgerly identities and memberships
- School module read/manage access
- Multiple school roles per user
- Campus/department/class/stream/subject/student scoped access
- Temporary permissions
- Session history/revocation
- Password reset
- Security policy
- Login history
- TOTP two-factor authentication and recovery codes

### Students and admissions

- Admission application creation, review, decision and enrollment
- Manual student creation
- Automatic or manual admission/student numbers
- Optional student portal account creation
- Student search and filters by status, academic year, class, stream and campus
- Student profile and current placement
- Guardian links and financial/emergency/pickup flags
- Medical and learning-support information
- Notes, documents and siblings
- Status history, class/stream/campus/school transfers and promotions
- Enrollment and demographic reports
- Bulk JSON import

## Module management

`#modules` provides organization-level enable/disable controls for optional Ledgerly modules. School Management can be enabled independently per organization.

## Staff, R2 uploads and focused navigation (v1.1.0)

Entering School Management now switches away from the normal Ledgerly navigation and renders a dedicated school sidebar. The school sidebar intentionally contains only the major workspaces—Overview, Students, Admissions, Staff & Teachers, People & Access, and School Setup—with a clear Back to Ledgerly action. On narrow screens it collapses to a compact school navigation rather than stacking both sidebars.

School logos, user photos/signatures, student photos/documents, staff photos, qualifications, staff documents and template files use the authenticated School R2 upload API through the reusable `SchoolFileUpload` component. The UI stores file IDs, not user-entered object URLs, and protected downloads use authenticated requests.

The Staff & Teachers workspace covers profiles, positions, departments/campuses, employment details, emergency contacts, qualifications, subjects taught, class/stream/subject assignments, documents, recurring compensation, payroll adjustments, payslips and installment salary payments. It also displays the employee's linked Ledgerly Staff Payable control account and remaining payslip balance.

API errors are surfaced from the backend message wherever forms/actions fail, allowing users to see specific guidance such as duplicate sequence/assignment messages instead of a generic error page.

## Staff & teacher frontend completeness (v1.2.0)

The Staff & Teachers workspace now exposes the complete v1.1 backend surface instead of only staff creation. Administrators can create and edit full HR/contact records, maintain positions, assign departments/campuses, link school logins, record emergency contacts, manage subjects taught and class/stream/term assignments, upload/download/verify qualifications, and upload/remove staff documents.

Payroll operations show the automatically-created Ledgerly employee contact, payroll employee record, Staff Payable control account, recurring earnings/deductions, one-off commissions/allowances/bonuses/overtime/benefits/deductions/loan recoveries/salary advances, payslip paid-to-date values, outstanding balances and salary installment history. Installments select a real Ledgerly cash/bank posting account and can be reversed when necessary.

The main Ledgerly Payroll payslip view also displays paid-to-date, outstanding balance and payment status so finance users do not mistake a posted payroll liability for a fully-paid salary.

School forms use `errorText()` to preserve backend validation messages and include field-level Zod details when available, so conflicts such as duplicate sequences, staff numbers, positions and teaching assignments are shown to the user directly.

## Fees & Billing frontend (v1.2.0)

Fees & Billing is exposed as one expandable School Management sidebar node instead of adding many top-level navigation items. It contains nested expandable groups for Configuration, Transactions, Reports and Data Import. This keeps the school navigation compact while still giving direct access to fee structures, discounts/awards, late-fee rules, accounting setup, billing/charges, receipts/payments, refunds/credits, payment plans, financial holds/clearance, balances, defaulters, class summaries, collections, ageing, statements and imports.

The fee UI uses the school-fee backend as a true Ledgerly receivables subledger. It supports individual and bulk billing, billing schedules, fee-structure lines, student-specific concessions, manual charges, credit/write-off reversal, receipt R2 evidence uploads, automatic and manual receipt allocation, payer overpayment credits, refund/reversal workflows, installment plans, late-fee assessment, opening-balance/payment imports, and student/payer/guardian statements. Backend validation messages are surfaced directly to the user.

## Dynamic form behavior (v7)

School forms now use dependent selectors so downstream choices cannot contradict upstream placement. Student placement, admission enrollment, transfers, promotions, teacher assignments and fee configuration use class level/year/campus context to narrow class and stream choices. School metadata and configuration objects are edited through typed key/value controls rather than raw JSON.
