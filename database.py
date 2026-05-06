import sqlite3
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DB_DIR = BASE_DIR / "instance"
DB_PATH = DB_DIR / "pipeline.db"

# Default stages for seeding
DEFAULT_STAGES = [
    "Prospecting",
    "Contacted",
    "Demo Scheduled",
    "Proposal Sent",
    "Closed",
]

# PRAGMA user_version: bump when a one-time migration is added.
_USER_VERSION_DYNAMIC_STAGES = 3

DEFAULT_STAGES_DATA = [
    ("Prospecting", 0),
    ("Contacted", 1),
    ("Demo Scheduled", 2),
    ("Proposal Sent", 3),
    ("Closed", 4),
]


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


def _migrate_to_dynamic_stages(connection: sqlite3.Connection) -> None:
    """
    Migration to version 3:
    - Create stages table with id, name, position
    - Add notes column to leads table
    - Migrate existing stage_notes to unified notes
    - Remove CHECK constraints by recreating tables without them
    """
    current = connection.execute("PRAGMA user_version").fetchone()
    version = int(current[0]) if current is not None else 0
    if version >= _USER_VERSION_DYNAMIC_STAGES:
        return

    # Create stages table
    connection.execute("""
        CREATE TABLE IF NOT EXISTS stages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            position INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Seed default stages if empty
    existing = connection.execute("SELECT COUNT(*) as cnt FROM stages").fetchone()
    if existing["cnt"] == 0:
        connection.executemany(
            "INSERT INTO stages (name, position) VALUES (?, ?)",
            DEFAULT_STAGES_DATA
        )

    # Add notes column to leads if it doesn't exist
    lead_cols = _table_columns(connection, "leads")
    if "notes" not in lead_cols:
        connection.execute("ALTER TABLE leads ADD COLUMN notes TEXT DEFAULT ''")

    # Migrate from lead_stage_notes to unified notes (use current stage's notes)
    if "notes" in lead_cols:
        # Get leads with their current stage notes
        leads = connection.execute("""
            SELECT l.id, l.stage, COALESCE(lsn.content, '') as stage_note
            FROM leads l
            LEFT JOIN lead_stage_notes lsn ON lsn.lead_id = l.id AND lsn.stage = l.stage
        """).fetchall()
        for lead in leads:
            if lead["stage_note"]:
                connection.execute(
                    "UPDATE leads SET notes = ? WHERE id = ?",
                    (lead["stage_note"], lead["id"])
                )

    connection.execute(f"PRAGMA user_version = {_USER_VERSION_DYNAMIC_STAGES}")


def init_db() -> None:
    """
    Create app tables if they do not already exist.
    Safe to run multiple times.
    """
    with get_db_connection() as connection:
        # Create stages table (dynamic, user-configurable)
        connection.execute("""
            CREATE TABLE IF NOT EXISTS stages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Seed default stages if empty
        existing = connection.execute("SELECT COUNT(*) as cnt FROM stages").fetchone()
        if existing["cnt"] == 0:
            connection.executemany(
                "INSERT INTO stages (name, position) VALUES (?, ?)",
                DEFAULT_STAGES_DATA
            )

        # Create leads table (no CHECK constraint on stage - free text)
        connection.execute("""
            CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_name TEXT NOT NULL,
                contact_name TEXT NOT NULL,
                email TEXT NOT NULL,
                stage TEXT NOT NULL DEFAULT 'Prospecting',
                notes TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        connection.execute("""
            CREATE TRIGGER IF NOT EXISTS leads_updated_at
            AFTER UPDATE ON leads
            FOR EACH ROW
            BEGIN
                UPDATE leads
                SET updated_at = CURRENT_TIMESTAMP
                WHERE id = OLD.id;
            END;
        """)

        # Create lead_stage_notes table (for backward compatibility, but we use leads.notes now)
        connection.execute("""
            CREATE TABLE IF NOT EXISTS lead_stage_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lead_id INTEGER NOT NULL,
                stage TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (lead_id, stage),
                FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
            )
        """)

        connection.execute("""
            CREATE INDEX IF NOT EXISTS idx_lead_stage_notes_lead_id
            ON lead_stage_notes (lead_id)
        """)

        connection.execute("""
            CREATE TRIGGER IF NOT EXISTS lead_stage_notes_updated_at
            AFTER UPDATE ON lead_stage_notes
            FOR EACH ROW
            BEGIN
                UPDATE lead_stage_notes
                SET updated_at = CURRENT_TIMESTAMP
                WHERE id = OLD.id;
            END;
        """)

        # Run migration for dynamic stages
        _migrate_to_dynamic_stages(connection)
        connection.commit()


def get_default_stages() -> list[str]:
    """Return the list of default stage names."""
    return DEFAULT_STAGES.copy()


if __name__ == "__main__":
    init_db()
    print(f"Database initialized at: {DB_PATH}")