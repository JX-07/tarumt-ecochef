# Development seeds

These SQL files are optional local-development data, not migrations. Apply migrations first, then run a seed explicitly against a disposable development database.

`marketplace_demo.sql` uses the first existing business-owner account and creates representative approved stores, products, and a promotion. It is safe to re-run because records are checked by store/product name and promotion code.

`showcase_expansion.sql` adds three demo shops, twelve products, six recipes, and three administrator directory entries. It is idempotent and uses reserved `showcase-*` Firebase identifiers; the demo accounts cannot sign in unless matching Firebase users are created separately.

The three `railway_activity*.sql` files were applied directly to the Railway production database on 13 November 2026. They add synthetic showcase profiles and non-transactional activity without altering the schema. Showcase users have `firebase_uid` values beginning with `showcase-railway-` and `@example.com` email addresses, so they are identifiable in the database and are not Firebase sign-in accounts. The files are designed to be repeatable. Do not apply them to a customer database without first reviewing the records and image URLs.
