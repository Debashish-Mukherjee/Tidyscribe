from __future__ import annotations

import logging

logger = logging.getLogger("app.errors")


def init_error_tracking(dsn: str, environment: str, service: str) -> bool:
    """Start Sentry when a DSN is configured; a no-op otherwise. Returns whether it was enabled."""
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        logger.warning("SENTRY_DSN is set but sentry-sdk is not installed")
        return False
    # PII stays off: request bodies hold user documents.
    sentry_sdk.init(dsn=dsn, environment=environment, release=service, send_default_pii=False, max_request_body_size="never")
    logger.info("error tracking enabled")
    return True


def capture_exception() -> None:
    """Report the exception being handled; no-op when Sentry is not configured."""
    try:
        import sentry_sdk
    except ImportError:
        return
    if sentry_sdk.is_initialized():
        sentry_sdk.capture_exception()
