# Ledgerly Dynamic Forms & Professional Settings — v7

This release improves school-management data entry so users work with real names and guided choices instead of internal IDs or raw JSON.

## Dynamic school forms

- Student creation now follows Academic Year / Campus → Class Level → Class → Stream.
- Changing a parent selection clears incompatible child selections automatically.
- Admission enrollment uses the same Class Level → Class → Stream dependency chain.
- Student transfer and promotion forms filter destination classes and streams from the selected level/year/campus.
- Staff teaching assignments filter classes by class level/year/campus, streams by class, and subjects by configured curriculum assignments where available.
- Fee structures and discount schemes filter classes by class level/year/campus and streams by class.

## Professional settings / metadata input

- School metadata, advanced rules, payment-method configuration, template options, branding extras, and system preferences use a typed setting editor instead of raw JSON textareas.
- Settings support text, number, yes/no and list values, with add/remove controls and human-readable summaries.
- Student bulk import uses Excel/CSV with a downloadable template and resolves academic year, campus, class level, class, and stream by user-friendly names/codes.

## Reference selection

- Guardian fee statements now select a guardian from a list instead of requiring a guardian record ID.
- School user scoped-access rules now select parents/guardians from real records instead of asking for a resource ID.

## Backend support

- Added `GET /api/v1/school/student-management/guardians` for tenant-scoped guardian selectors and search.

## Validation

- All TypeScript/TSX source files pass syntax parsing.
- All database migrations through `0011_school_fees_billing.sql` apply successfully to a clean SQLite database.
