"""Register one factory sensor and print the one-time QR payload.

Run from apps/api with its virtual environment so DATABASE_URL is loaded:
  .venv/Scripts/python ../../services/iot_gateway/tools/create_device_identity.py
"""

from __future__ import annotations

import argparse
import hashlib
import secrets
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from sqlalchemy import create_engine, text  # noqa: E402
from app.core.config import get_settings  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--code", help="Factory device code; generated when omitted")
    args = parser.parse_args()
    suffix = secrets.token_hex(3).upper()
    device_code = (args.code or f"ENOSE-{suffix}").strip().upper()
    ble_name = f"EcoChef-{device_code[-6:]}"
    claim_secret = secrets.token_urlsafe(32)
    secret_hash = hashlib.sha256(claim_secret.encode()).hexdigest()
    setup_code = secrets.token_hex(6).upper()
    setup_code_hash = hashlib.sha256(setup_code.encode()).hexdigest()
    with create_engine(get_settings().database_url).begin() as connection:
        connection.execute(
            text("""
            INSERT INTO sensor_provisioning_devices
                (device_code, claim_secret_hash, setup_code_hash, ble_name)
            VALUES (:device_code, :secret_hash, :setup_code_hash, :ble_name)
        """),
            {
                "device_code": device_code,
                "secret_hash": secret_hash,
                "setup_code_hash": setup_code_hash,
                "ble_name": ble_name,
            },
        )
    payload = f"ecochef://sensor-setup?v=1&code={device_code}&secret={claim_secret}&ble={ble_name}"
    print(f"Device code: {device_code}")
    print(f"BLE name:    {ble_name}")
    print(f"Setup code:  {setup_code[:4]}-{setup_code[4:8]}-{setup_code[8:]}")
    print(f"QR payload:  {payload}")
    print(
        "Store the code/BLE name in firmware and print the QR payload as the device label. The secret is shown once."
    )


if __name__ == "__main__":
    main()
