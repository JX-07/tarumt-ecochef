# Development seeds

These SQL files are optional local-development data, not migrations. Apply migrations first, then run a seed explicitly against a disposable development database.

`marketplace_demo.sql` uses the first existing business-owner account and creates representative approved stores, products, and a promotion. It is safe to re-run because records are checked by store/product name and promotion code.
