# Database Migrations

Migrations are immutable, ordered SQL files. Use the `NNNN_short_description.sql` naming format. Apply them in numerical order to an empty database or through the migration runner introduced with the API in EC-004. `schema_migrations` records the applied version history.

The current development baseline, `0001_chapter_4_3_schema.sql`, is a deliberate rebaseline of the previously empty local database against the Chapter 4.3 data dictionary. Do not re-run it against a database containing user data.

Never edit a migration that has been applied to another environment. Add a new migration instead. Every schema change must describe data backfill, rollback, and index impact in its pull request.
