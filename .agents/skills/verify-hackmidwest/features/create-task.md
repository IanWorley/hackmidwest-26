# Create a task

A client creates a task by posting a title to the API. It gets back the stored task with a generated id and `completed: false`, and the task then appears on the `/tasks` page. Invalid titles are rejected and nothing is stored. There is no create form in the web UI yet; the API is the user entry point.

## Sub-features

- `create-ok` stores a task and returns `201` with `{id, title, completed: false}`.
- `create-visible` shows the new task on `/tasks` and in `GET /api/tasks`.
- `create-reject-empty` returns `422` for an empty title and stores nothing.
- `create-reject-long` returns `422` for a title over 120 characters and stores nothing; exactly 120 is accepted.
- `create-ignore-completed` ignores a client-supplied `completed` and stores the task as not completed.

## How to get to it (user POV)

- Send `POST /api/tasks` with `content-type: application/json` and body `{"title": "<1..120 chars>"}` to `$API_URL`.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index (seed task only).

- **Create.** Post a valid title. Run `RUN_ID=<id> $V api create-task-ok POST /api/tasks '{"title":"Ship the verification skill"}'`. Status `201 Created`; body is `{"id":2,"title":"Ship the verification skill","completed":false}`.
- **Stored.** Read the row back. Run `RUN_ID=<id> $V db create-task-row "select id, title, completed from tasks order by id"`. Row `2|Ship the verification skill|0` is present after the seed row.
- **Visible in UI.** Load the list. Run `RUN_ID=<id> $V browser goto /tasks expect checkbox "Ship the verification skill" snap create-task-ui`. `create-task-ui.aria.yml` lists the seed task and then the new task, unchecked.
- **Reject empty.** Post an empty title. Run `RUN_ID=<id> $V api create-task-empty POST /api/tasks '{"title":""}'`. Status `422 Unprocessable Entity`.
- **Reject too long.** Post 121 characters. Run `RUN_ID=<id> $V api create-task-long POST /api/tasks "{\"title\":\"$(printf 'a%.0s' {1..121})\"}"`. Status `422 Unprocessable Entity`.
- **Ignore completed.** Post a task that claims to be done. Run `RUN_ID=<id> $V api create-task-completed POST /api/tasks '{"title":"Claims done","completed":true}'`. Status `201 Created` with `"completed":false` in the body.
- **Proof nothing invalid stored.** Read all rows. Run `RUN_ID=<id> $V db create-task-final "select id, title, completed from tasks order by id"`. Only the seed, `Ship the verification skill`, and `Claims done` rows exist, all with `completed` `0`.

## Gotchas

- Unknown body fields are stripped, not rejected: `{"title":"x","completed":true}` returns `201`. Assert the stored `completed` value, not a `422`.
- Ids are database-generated and never reused within a run. The `id: 2` above holds only from the baseline; after other recipes, assert the title instead.
- Titles are not trimmed. `" "` (one space) is a valid 1-character title.
- A 201 alone is not proof. Pair it with the `db` row and the `/tasks` snapshot.
- This recipe mutates data. `down` and `up` before running another recipe that expects the baseline.
