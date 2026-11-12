"""Verify migrations and booking races against the private local audit cluster only.

Start the isolated cluster on port 55439 first. Creates a fresh database and never
reads application credentials or connects to the normal development database.
"""
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import psycopg
from psycopg import sql


root = Path(__file__).resolve().parents[1]
name = "ecochef_audit_" + uuid4().hex[:12]
connection = dict(host="127.0.0.1", port=55439, user="ecochef_audit", connect_timeout=3)
with psycopg.connect(**connection, dbname="postgres", autocommit=True) as admin:
    admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
with psycopg.connect(**connection, dbname=name, autocommit=True) as database:
    migrations = sorted((root / "infra/database/migrations").glob("[0-9]*.sql"))
    for migration in migrations:
        database.execute(migration.read_text(encoding="utf-8"))
print(f"Applied {len(migrations)} migrations to a fresh isolated database.", flush=True)
environment = {**os.environ,
    "DATABASE_URL": f"postgresql+psycopg://ecochef_audit@127.0.0.1:55439/{name}",
    "ECOCHEF_AUDIT_DATABASE_URL": f"postgresql+psycopg://ecochef_audit@127.0.0.1:55439/{name}",
    "FIREBASE_PROJECT_ID": "ecochef-audit-test"}
result = subprocess.run([
    sys.executable, "-m", "pytest",
    "apps/api/tests/test_booking_postgres.py",
    "apps/api/tests/test_review_moderation_postgres.py",
    "apps/api/tests/test_group_schedules_postgres.py",
    "apps/api/tests/test_vendor_dashboard_postgres.py", "-q",
], cwd=root, env=environment)
sys.exit(result.returncode)
