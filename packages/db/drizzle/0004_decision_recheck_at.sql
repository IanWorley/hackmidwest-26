-- Hand-written in place of drizzle-kit's table rebuild, which would drop the decisions triggers from 0003.
ALTER TABLE `decisions` ADD `recheck_at` text CONSTRAINT "decisions_recheck_at" CHECK(("recheck_at" is not null) = ("action" in ('defer')) and "recheck_at" is strftime('%Y-%m-%dT%H:%M:%fZ', julianday("recheck_at")));
