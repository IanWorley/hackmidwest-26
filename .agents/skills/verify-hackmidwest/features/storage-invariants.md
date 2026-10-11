# Storage invariants

The SQLite schema refuses data that breaks the domain rules, even when a caller skips the HTTP validators. Add-only tables reject `UPDATE` and `DELETE`, and `CHECK` constraints reject invalid rows. No route serves these tables yet, so the user is the next developer or service that writes to storage. The proof is the database refusing the write.

## Sub-features

- `storage-status-events-add-only` rejects `UPDATE` and `DELETE` on `employee_status_events` with its add-only trigger message.
- `storage-tasks-title-check` rejects an empty task title with `CHECK constraint failed: tasks_title_length`, independent of the API's `422`.

## How to get to it (user POV)

- Write to the instance's database directly, the way a script, migration, or future feature would.
- There is no web or HTTP path to these rejections today. Do not report one as verified through the UI or API.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index (seed data only, healthy storage).

- **Seed present.** Read the rows the probes target. Run `RUN_ID=<id> $V db storage-status-events-before "select id, employee_id, status from employee_status_events order by id limit 3"`. Rows `1|1|working_onsite`, `2|2|working_onsite`, `3|3|working_onsite`.
- **Update rejected.** Run `RUN_ID=<id> $V db-reject storage-status-events-update "update employee_status_events set status = 'teleworking' where id = 1" "employee_status_events is add-only: record a newer event instead of updating one"`. Exit code `0`; the transcript shows `verdict> rejected` and `snapshot unchanged> yes`.
- **Delete rejected.** Run `RUN_ID=<id> $V db-reject storage-status-events-delete "delete from employee_status_events where id = 1" "employee_status_events is add-only: events cannot be deleted"`. Exit code `0`; `verdict> rejected`.
- **Check rejected.** Run `RUN_ID=<id> $V db-reject storage-tasks-empty-title "insert into tasks (title) values ('')" "CHECK constraint failed: tasks_title_length"`. Exit code `0`; `verdict> rejected`.
- **Instance untouched.** Re-read the rows. Run `RUN_ID=<id> $V db storage-status-events-after "select id, employee_id, status from employee_status_events order by id limit 3"`. Same three rows as before.

## Gotchas

- `db-reject` writes to a `.backup` snapshot of the run's database and deletes it afterwards. The instance's data never changes, so other recipes can run on the same instance.
- A write the schema allows makes `db-reject` print `verdict> FAIL` and exit `1`. That is the probe working: it proves only rejections, never acceptance.
- Match on the trigger message or the `CHECK` name, not the whole error line. The `sqlite3` CLI prefixes it with `Error in 3rd command line argument:`.
- The `sqlite3` CLI leaves foreign keys off, so a probe cannot prove a foreign-key rejection.
- A storage PR that adds a table or a constraint adds its sub-feature and probe here in the same PR.
