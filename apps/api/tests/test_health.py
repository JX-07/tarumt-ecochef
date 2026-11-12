from app.api.v1.endpoints.health import liveness
from app.api.v1.endpoints.meta import api_meta
from app.main import app


def test_liveness_endpoint_is_registered() -> None:
    paths = app.openapi()["paths"]

    assert "/api/v1/health/live" in paths
    assert "/api/v1/meta" in paths
    assert "/api/v1/auth/me" in paths
    assert liveness()["status"] == "ok"


def test_api_meta_contract() -> None:
    response = api_meta()

    assert response.service == "EcoChef API"
    assert response.version == "v1"
