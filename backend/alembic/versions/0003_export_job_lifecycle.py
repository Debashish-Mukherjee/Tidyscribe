"""export job lifecycle: timestamps, heartbeat, failure reason

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-02
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

_TIME = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.add_column("exports", sa.Column("queued_at", _TIME, server_default=sa.func.now(), nullable=False))
    op.add_column("exports", sa.Column("started_at", _TIME, nullable=True))
    op.add_column("exports", sa.Column("finished_at", _TIME, nullable=True))
    op.add_column("exports", sa.Column("heartbeat_at", _TIME, nullable=True))
    op.add_column("exports", sa.Column("failure_reason", sa.String(length=100), nullable=True))
    op.add_column("exports", sa.Column("worker_id", sa.String(length=100), nullable=True))
    op.add_column("exports", sa.Column("attempts", sa.Integer(), server_default="0", nullable=False))
    op.add_column("exports", sa.Column("rss_mb", sa.Integer(), nullable=True))
    op.create_index("ix_exports_status", "exports", ["status"])
    # Jobs that were in flight before this migration have no worker behind them any more.
    op.execute(
        "UPDATE exports SET status = 'failed', failure_reason = 'stale_heartbeat', finished_at = now(), "
        "error = COALESCE(error, 'The export worker stopped responding. Please try again.') "
        "WHERE status = 'processing'"
    )


def downgrade() -> None:
    op.drop_index("ix_exports_status", table_name="exports")
    for column in ("rss_mb", "attempts", "worker_id", "failure_reason", "heartbeat_at", "finished_at", "started_at", "queued_at"):
        op.drop_column("exports", column)
