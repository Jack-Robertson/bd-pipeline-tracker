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


def get_db_connection() -> sqlite3.Connection:
    """Return a SQLite connection with dict-like row access."""
    DB_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    """
    Create app tables if they do not already exist.
    Safe to run multiple times.
    """
    with get_db_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_name TEXT NOT NULL,
                contact_name TEXT NOT NULL,
                email TEXT NOT NULL,
                notes TEXT DEFAULT '',
                stage TEXT NOT NULL DEFAULT 'Prospecting'
                    CHECK (stage IN (
                        'Prospecting',
                        'Contacted',
                        'Demo Scheduled',
                        'Proposal Sent',
                        'Closed'
                    )),
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
        connection.commit()


if __name__ == "__main__":
    init_db()
    print(f"Database initialized at: {DB_PATH}")
