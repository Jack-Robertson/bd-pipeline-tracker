import sqlite3
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DB_DIR = BASE_DIR / "instance"
DB_PATH = DB_DIR / "pipeline.db"

# Keep stages centralized so backend and frontend stay consistent.
PIPELINE_STAGES = [
    "Prospecting",
    "Contacted",
    "Demo Scheduled",
    "Proposal Sent",
    "Closed",
]

# PRAGMA user_version: bump when a one-time migration is added.
_USER_VERSION_STAGE_NOTES = 2

_STAGE_CHECK = """
    CHECK (stage IN (
        'Prospecting',
        'Contacted',
        'Demo Scheduled',
        'Proposal Sent',
        'Closed'
    ))
"""


def get_db_connection() -> sqlite3.Connection:
    """Return a SQLite connection with dict-like row access and FK enforcement."""
    DB_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def _table_columns(connection: sqlite3.Connection, table: str) -> list[str]:
    rows = connection.execute(f"PRAGMA table_info({table})").fetchall()
    return [row[1] for row in rows]


def _migrate_legacy_notes_to_stage_notes(connection: sqlite3.Connection) -> None:
    """
    One-time migration (user_version < 2):
    - Copy legacy leads.notes into lead_stage_notes for each lead's current stage.
    - Drop leads.notes when supported (SQLite 3.35+).
    New databases use leads without a notes column; this path is a no-op for them.
    """
    current = connection.execute("PRAGMA user_version").fetchone()
    version = int(current[0]) if current is not None else 0
    if version >= _USER_VERSION_STAGE_NOTES:
        return

    lead_cols = _table_columns(connection, "leads")
    if "notes" in lead_cols:
        leads = connection.execute(
            "SELECT id, stage, COALESCE(notes, '') AS notes FROM leads"
        ).fetchall()
        for lead in leads:
            connection.execute(
                """
                INSERT INTO lead_stage_notes (lead_id, stage, content)
                VALUES (?, ?, ?)
                ON CONFLICT(lead_id, stage) DO UPDATE SET
                    content = excluded.content
                """,
                (lead["id"], lead["stage"], lead["notes"] or ""),
            )
        try:
            connection.execute("ALTER TABLE leads DROP COLUMN notes")
        except sqlite3.OperationalError:
            # Older SQLite: column remains unused until a manual migration.
            pass

    connection.execute(f"PRAGMA user_version = {_USER_VERSION_STAGE_NOTES}")


def init_db() -> None:
    """
    Create app tables if they do not already exist.
    Safe to run multiple times.
    """
    with get_db_connection() as connection:
        # New installs: no legacy `notes` column (stage notes live in lead_stage_notes).
        connection.execute(
            f"""
            CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_name TEXT NOT NULL,
                contact_name TEXT NOT NULL,
                email TEXT NOT NULL,
                stage TEXT NOT NULL DEFAULT 'Prospecting'
                    {_STAGE_CHECK},
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        connection.execute(
            """
            CREATE TRIGGER IF NOT EXISTS leads_updated_at
            AFTER UPDATE ON leads
            FOR EACH ROW
            BEGIN
                UPDATE leads
                SET updated_at = CURRENT_TIMESTAMP
                WHERE id = OLD.id;
            END;
            """
        )

        connection.execute(
            f"""
            CREATE TABLE IF NOT EXISTS lead_stage_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lead_id INTEGER NOT NULL,
                stage TEXT NOT NULL {_STAGE_CHECK},
                content TEXT NOT NULL DEFAULT '',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (lead_id, stage),
                FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
            )
            """
        )

        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_lead_stage_notes_lead_id
            ON lead_stage_notes (lead_id)
            """
        )

        connection.execute(
            """
            CREATE TRIGGER IF NOT EXISTS lead_stage_notes_updated_at
            AFTER UPDATE ON lead_stage_notes
            FOR EACH ROW
            BEGIN
                UPDATE lead_stage_notes
                SET updated_at = CURRENT_TIMESTAMP
                WHERE id = OLD.id;
            END;
            """
        )

        _migrate_legacy_notes_to_stage_notes(connection)
        connection.commit()


if __name__ == "__main__":
    init_db()
    print(f"Database initialized at: {DB_PATH}")
