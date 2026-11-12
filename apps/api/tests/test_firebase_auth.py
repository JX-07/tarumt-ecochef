import pytest
from fastapi import HTTPException

from app.modules.auth import service


def test_firebase_token_claims_are_normalized(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        service.firebase_auth,
        "verify_id_token",
        lambda *_args, **_kwargs: {
            "uid": "firebase-user-123",
            "email": "chef@example.com",
            "email_verified": True,
        },
    )

    claims = service.verify_firebase_id_token("test-token")

    assert claims.uid == "firebase-user-123"
    assert claims.email_verified is True


def test_firebase_token_without_email_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service.firebase_auth, "verify_id_token", lambda *_args, **_kwargs: {"uid": "x"})

    with pytest.raises(HTTPException, match="no email"):
        service.verify_firebase_id_token("test-token")


def test_fresh_tokens_allow_bounded_clock_skew_and_still_check_revocation(monkeypatch):
    def verify(token, **kwargs):
        assert kwargs["clock_skew_seconds"] == 60
        assert kwargs["check_revoked"] is True
        return {"uid":"x","email":"x@example.com"}
    monkeypatch.setattr(service.firebase_auth,"verify_id_token",verify)
    assert service.verify_firebase_id_token("test-token").uid=="x"


@pytest.mark.parametrize("error,status",[(service.firebase_auth.RevokedIdTokenError("revoked"),401),(service.firebase_auth.CertificateFetchError("unavailable",None),503)])
def test_rejected_sessions_and_unavailable_verification_are_distinguished(monkeypatch,error,status):
    def verify(*args,**kwargs):raise error
    monkeypatch.setattr(service.firebase_auth,"verify_id_token",verify)
    with pytest.raises(HTTPException) as result: service.verify_firebase_id_token("test-token")
    assert result.value.status_code==status
