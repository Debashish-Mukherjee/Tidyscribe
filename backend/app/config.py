from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Tidyscribe"
    env: str = "development"
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/docworkbench"
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = "super-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    cors_origins: str = "http://localhost:3000"
    api_base_url: str = "http://localhost:8000"
    log_level: str = "INFO"
    log_json: bool = True
    # Empty disables error tracking.
    sentry_dsn: str = ""
    data_dir: str = "/app/data"
    # Run Celery tasks inline (used by tests); production leaves this off so the worker container does the work.
    celery_eager: bool = False
    # "pandoc" builds DOCX with Pandoc and PDF with LibreOffice when installed; the built-in writers remain the fallback.
    export_engine: str = "python"
    # Render Mermaid blocks that arrive without a browser-made image when the Mermaid CLI (mmdc) is installed.
    server_mermaid: bool = True
    server_mermaid_limit: int = 20
    cli_timeout_seconds: int = 120
    # Export job reliability: the soft limit stops the build and records why; the hard limit kills the worker process.
    export_soft_timeout_seconds: int = 90
    export_hard_timeout_seconds: int = 120
    export_heartbeat_interval_seconds: float = 5.0
    # A processing job whose heartbeat is older than this lost its worker.
    export_heartbeat_stale_seconds: int = 30
    # Queued jobs nobody picked up are re-dispatched after this long, then abandoned after the expiry.
    export_requeue_after_seconds: int = 120
    export_queued_expiry_seconds: int = 1800
    export_retention_hours: int = 168
    # How long the metrics endpoint looks back when summarising queue wait and export duration.
    metrics_window_minutes: int = 15

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
