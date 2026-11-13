# Mock CSI exports — ASSUMED SHAPE

There is no CSI access yet (Jason, 2026-11-13), so these stand in for the "spike → capture a
real payload as a fixture" rule (CLAUDE.md, TDD exceptions). The row shape is a guess from what
Jason said CSI holds: a stable employee id, one name field, email, title, and one location.
Replace these with a real capture when access arrives, and fix `src/lib/csi/map.ts` to match.

`staff-with-students.json` deliberately carries student-like rows. CSI holds no student data,
but the no-student-data invariant (CLAUDE.md rule 4, `11` §4, §9) is proved, not assumed: none
of those rows may ever become a `people` record.
