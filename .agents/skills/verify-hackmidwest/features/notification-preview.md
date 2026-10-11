# Notification preview

`GET /api/recommendations/:id/notifications/preview` shows who would be told what if the facility took a stored recommendation as is. It reads the recommendation's posture and evaluation instant, reconciles the facility's HR employees against its building rosters and status events, and returns the notification package: one recipient per person to notify, with a channel, a `sendBy`, and a four-part message, and one exclusion per person or roster entry who is not told, with the reason. It is a read: no directives apply because no decision exists yet, and nothing is stored.

## Sub-features

- `notification-preview-package` returns `200` with `"source":{"kind":"preview","recommendationId":<id>}`, and `context.now`, `context.posture.posture`, and `context.facilityDate` equal to the recommendation's `asOf`, `posture`, and `snapshot.output.facilityDate`.
- `notification-preview-roster` places every Kansas City employee exactly once, as a recipient or a `skipped` or `excused` exclusion, and lists roster entry `1000` (`Victor Lindgren`) as `unmatched` with reason `not_in_hr`.
- `notification-preview-unknown` returns `404 {"message":"Recommendation not found"}` for an unknown id.
- `notification-preview-malformed-id` returns `422` for an id that is not a decimal positive integer, such as `0x1`.
- `notification-preview-writes-nothing` leaves `notification_dispatches` empty and adds no `recommendations` row.

## How to get to it (user POV)

- Send `GET /api/recommendations/<id>/notifications/preview` to `$API_URL`. The agent orchestration (#32) calls it after evaluating, and the decision screen will show it before a decision is recorded.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index: the 4 demo facilities, their seeded rosters, and no recommendations.
- The machine can reach `https://api.weather.gov` and `https://air-quality-api.open-meteo.com`.

- **Evaluate.** Run `RUN_ID=<id> $V api notification-preview-evaluate POST /api/facilities/1/recommendations`. `201` with `"id":1`.
- **Preview.** Run `RUN_ID=<id> $V api notification-preview GET /api/recommendations/1/notifications/preview`. `200`; `source` is `{"kind":"preview","recommendationId":1}`; `context.now` equals the evaluation's `asOf`, `context.posture.posture` its `posture`, and `context.facilityDate` its `snapshot.output.facilityDate`.
- **Roster coverage.** Over the preview body, `jq '[.recipients[].employee.id, (.exclusions[] | select(.kind != "unmatched") | .line.employee.id)] | sort'` is `[1,2,…,20]` with no repeats, and `jq -c '[.exclusions[] | select(.kind == "unmatched") | [.line.entry.id, .line.entry.listedName, .line.reason]]'` is `[[1000,"Victor Lindgren","not_in_hr"]]`.
- **Unknown id.** Run `RUN_ID=<id> $V api notification-preview-unknown GET /api/recommendations/999/notifications/preview`. `404` with body `{"message":"Recommendation not found"}`.
- **Malformed id.** Run `RUN_ID=<id> $V api notification-preview-malformed GET /api/recommendations/0x1/notifications/preview`. `422`.
- **Writes nothing.** Run `RUN_ID=<id> $V db notification-preview-dispatches "select count(*) from notification_dispatches"`. `0`. Then run `RUN_ID=<id> $V db notification-preview-recommendations "select id, facility_id, as_of, posture from recommendations order by id"`. Exactly one row, id `1`, matching the evaluation.

## Gotchas

- The posture is live weather, so the recipients and their messages change between runs. Assert the source, the context equalities, and roster coverage, never who is notified or the message text.
- The seeded status events take effect at `2026-10-01T12:00:00.000Z`. Previewing a recommendation evaluated before that instant ignores them, so the already-teleworking and not-working employees are placed as if working onsite.
- The preview reads the facility's current roster, not a copy stored with the recommendation. A roster change after the evaluation shows up in a later preview of the same recommendation.
