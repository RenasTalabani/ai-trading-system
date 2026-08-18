"""
CORS configuration test for app/main.py.

Regression test for a real finding (2026-08-18 PM audit): the CORSMiddleware
was configured with allow_origins=["*"] AND allow_credentials=True
simultaneously -- the classic CORS anti-pattern. This service has no
cookie-based auth anywhere (it's called server-to-server by the backend
only -- see backend/src/services/aiService.js, aiWorkerService.js,
socialService.js), so allow_credentials=True was dead, incorrect config,
not a deliberate choice. Fixed to allow_credentials=False.

This test only inspects the configured middleware stack -- it does not spin
up a live server or issue HTTP requests, since importing app.main already
constructs the model instances in app.api.routes (the expensive part).
"""
from starlette.middleware.cors import CORSMiddleware

from app.main import app


def _find_cors_middleware():
    for m in app.user_middleware:
        if m.cls is CORSMiddleware:
            return m
    return None


def test_cors_middleware_is_registered():
    assert _find_cors_middleware() is not None, "CORSMiddleware is not registered on the app"


def test_cors_does_not_combine_wildcard_origin_with_credentials():
    mw = _find_cors_middleware()
    kwargs = mw.kwargs
    allow_origins = kwargs.get("allow_origins")
    allow_credentials = kwargs.get("allow_credentials")

    if allow_origins == ["*"] or allow_origins == "*":
        assert allow_credentials is not True, (
            "CORS is configured with a wildcard origin AND allow_credentials=True -- "
            "this is an invalid/dangerous combination. Either restrict allow_origins "
            "to an explicit allowlist, or set allow_credentials=False."
        )


def test_cors_credentials_disabled_matches_no_cookie_auth_in_this_service():
    # Documents the current, intentional state so a future change to
    # allow_credentials=True gets caught here and has to justify itself
    # against the "no cookie auth anywhere in this service" fact above.
    mw = _find_cors_middleware()
    assert mw.kwargs.get("allow_credentials") is False
