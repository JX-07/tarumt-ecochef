from pathlib import Path
import json

import firebase_admin
from firebase_admin import credentials

from app.core.config import get_settings


def get_firebase_app() -> firebase_admin.App:
    """Return the Firebase Admin app without loading credentials until auth is requested."""
    try:
        return firebase_admin.get_app()
    except ValueError:
        settings = get_settings()
        options = {"projectId": settings.firebase_project_id}
        if settings.firebase_credentials_json:
            service_account = json.loads(settings.firebase_credentials_json.get_secret_value())
            return firebase_admin.initialize_app(credentials.Certificate(service_account), options)
        if settings.firebase_credentials_path:
            credential_path = Path(settings.firebase_credentials_path)
            return firebase_admin.initialize_app(credentials.Certificate(credential_path), options)
        return firebase_admin.initialize_app(options=options)
