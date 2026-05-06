import os
import sqlite3
from typing import Any

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

load_dotenv()
from google.generativeai import GenerativeModel, configure

from database import PIPELINE_STAGES, get_db_connection, init_db


app = Flask(__name__, instance_relative_config=True)


@app.route("/", methods=["GET"])
def home():
    return render_template("index.html")


def _default_stage_notes() -> dict[str, str]:
    return {stage: "" for stage in PIPELINE_STAGES}


def _fetch_stage_notes_dict(connection: sqlite3.Connection, lead_id: int) -> dict[str, str]:
    notes = _default_stage_notes()
    rows = connection.execute(
        "SELECT stage, content FROM lead_stage_notes WHERE lead_id = ?",
        (lead_id,),
    ).fetchall()
    for row in rows:
        stage = row["stage"]
        if stage in notes:
            notes[stage] = row["content"] or ""
    return notes


def _fetch_stage_notes_for_leads(
    connection: sqlite3.Connection, lead_ids: list[int]
) -> dict[int, dict[str, str]]:
    if not lead_ids:
        return {}
    result = {lid: _default_stage_notes() for lid in lead_ids}
    placeholders = ",".join("?" * len(lead_ids))
    rows = connection.execute(
        f"""
        SELECT lead_id, stage, content
        FROM lead_stage_notes
        WHERE lead_id IN ({placeholders})
        """,
        lead_ids,
    ).fetchall()
    for row in rows:
        lead_id = row["lead_id"]
        stage = row["stage"]
        if lead_id in result and stage in result[lead_id]:
            result[lead_id][stage] = row["content"] or ""
    return result


def _format_user_context_prompt(user_ctx: Any) -> str:
    """Human-readable seller block for Gemini prompts."""
    if not isinstance(user_ctx, dict):
        return (
            "Seller profile:\n"
            "(No profile provided — use a neutral professional voice.)\n"
        )
    name = str(user_ctx.get("user_name") or "").strip()
    title = str(user_ctx.get("job_title") or "").strip()
    company = str(user_ctx.get("company_name") or "").strip()
    selling = str(user_ctx.get("selling") or "").strip()
    if not (name or title or company or selling):
        return (
            "Seller profile:\n"
            "(No profile provided — use a neutral professional voice.)\n"
        )
    return (
        "Seller profile (personalize tone and specifics using this):\n"
        f"- Name: {name or 'Unknown'}\n"
        f"- Title: {title or 'Unknown'}\n"
        f"- Company: {company or 'Unknown'}\n"
        f"- What they sell: {selling or 'Unknown'}\n"
    )


def lead_row_core(row: Any) -> dict:
    """Lead columns from `leads` table only (no nested notes)."""
    return {
        "id": row["id"],
        "company_name": row["company_name"],
        "contact_name": row["contact_name"],
        "email": row["email"],
        "stage": row["stage"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def lead_with_stage_notes(connection: sqlite3.Connection, row: Any) -> dict:
    """API shape: core lead fields + stage_notes map."""
    payload = lead_row_core(row)
    payload["stage_notes"] = _fetch_stage_notes_dict(connection, row["id"])
    return payload


def get_lead_or_404(lead_id: int):
    """Return lead row or None if not found."""
    with get_db_connection() as connection:
        lead = connection.execute(
            "SELECT * FROM leads WHERE id = ?",
            (lead_id,),
        ).fetchone()
    return lead


@app.route("/api/leads", methods=["GET"])
def get_all_leads():
    with get_db_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM leads ORDER BY created_at DESC, id DESC"
        ).fetchall()
        lead_ids = [row["id"] for row in rows]
        notes_by_lead = _fetch_stage_notes_for_leads(connection, lead_ids)
        payload = []
        for row in rows:
            core = lead_row_core(row)
            core["stage_notes"] = notes_by_lead.get(row["id"], _default_stage_notes())
            payload.append(core)
    return jsonify(payload), 200


@app.route("/api/leads", methods=["POST"])
def add_lead():
    payload = request.get_json(silent=True) or {}
    company_name = (payload.get("company_name") or "").strip()
    contact_name = (payload.get("contact_name") or "").strip()
    email = (payload.get("email") or "").strip()
    notes = (payload.get("notes") or "").strip()
    stage = (payload.get("stage") or "Prospecting").strip()

    if not company_name or not contact_name or not email:
        return (
            jsonify(
                {
                    "error": "company_name, contact_name, and email are required.",
                }
            ),
            400,
        )

    if stage not in PIPELINE_STAGES:
        return jsonify({"error": f"Invalid stage. Use one of: {PIPELINE_STAGES}"}), 400

    with get_db_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO leads (company_name, contact_name, email, stage)
            VALUES (?, ?, ?, ?)
            """,
            (company_name, contact_name, email, stage),
        )
        new_id = cursor.lastrowid
        if notes:
            connection.execute(
                """
                INSERT INTO lead_stage_notes (lead_id, stage, content)
                VALUES (?, ?, ?)
                ON CONFLICT(lead_id, stage) DO UPDATE SET
                    content = excluded.content
                """,
                (new_id, stage, notes),
            )
        connection.commit()
        new_lead = connection.execute(
            "SELECT * FROM leads WHERE id = ?",
            (new_id,),
        ).fetchone()
        body = lead_with_stage_notes(connection, new_lead)

    return jsonify(body), 201


@app.route("/api/leads/<int:lead_id>/stage", methods=["PATCH"])
def update_lead_stage(lead_id: int):
    payload = request.get_json(silent=True) or {}
    stage = (payload.get("stage") or "").strip()

    if not stage:
        return jsonify({"error": "stage is required."}), 400

    if stage not in PIPELINE_STAGES:
        return jsonify({"error": f"Invalid stage. Use one of: {PIPELINE_STAGES}"}), 400

    if not get_lead_or_404(lead_id):
        return jsonify({"error": "Lead not found."}), 404

    with get_db_connection() as connection:
        connection.execute(
            "UPDATE leads SET stage = ? WHERE id = ?",
            (stage, lead_id),
        )
        connection.commit()
        updated_lead = connection.execute(
            "SELECT * FROM leads WHERE id = ?",
            (lead_id,),
        ).fetchone()
        body = lead_with_stage_notes(connection, updated_lead)

    return jsonify(body), 200


@app.route("/api/leads/<int:lead_id>/notes", methods=["PATCH"])
def update_lead_stage_notes(lead_id: int):
    if not get_lead_or_404(lead_id):
        return jsonify({"error": "Lead not found."}), 404

    payload = request.get_json(silent=True) or {}
    stage = (payload.get("stage") or "").strip()
    if "content" not in payload:
        return jsonify({"error": "content is required (use empty string to clear)."}), 400

    if stage not in PIPELINE_STAGES:
        return jsonify({"error": f"Invalid stage. Use one of: {PIPELINE_STAGES}"}), 400

    content = payload["content"]
    if content is None:
        content = ""
    elif not isinstance(content, str):
        content = str(content)

    with get_db_connection() as connection:
        connection.execute(
            """
            INSERT INTO lead_stage_notes (lead_id, stage, content)
            VALUES (?, ?, ?)
            ON CONFLICT(lead_id, stage) DO UPDATE SET
                content = excluded.content
            """,
            (lead_id, stage, content),
        )
        connection.commit()
        row = connection.execute(
            "SELECT * FROM leads WHERE id = ?",
            (lead_id,),
        ).fetchone()
        body = lead_with_stage_notes(connection, row)

    return jsonify(body), 200


@app.route("/api/leads/<int:lead_id>", methods=["GET"])
def get_lead(lead_id: int):
    with get_db_connection() as connection:
        row = connection.execute(
            "SELECT * FROM leads WHERE id = ?",
            (lead_id,),
        ).fetchone()
    if not row:
        return jsonify({"error": "Lead not found."}), 404
    body = lead_with_stage_notes(connection, row)
    return jsonify(body), 200


@app.route("/api/leads/<int:lead_id>/research", methods=["POST"])
def research_lead(lead_id: int):
    lead = get_lead_or_404(lead_id)
    if not lead:
        return jsonify({"error": "Lead not found."}), 404

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return jsonify({"error": "GEMINI_API_KEY is not set in environment."}), 500

    payload = request.get_json(silent=True) or {}
    user_ctx = payload.get("user_context")

    with get_db_connection() as connection:
        stage_notes = _fetch_stage_notes_dict(connection, lead_id)
    current_stage = lead["stage"]
    existing_notes = stage_notes.get(current_stage, "") or ""

    model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    configure(api_key=api_key)
    model = GenerativeModel(model_name)

    seller_lines = _format_user_context_prompt(user_ctx)

    prompt = f"""
You are an expert sales researcher analyzing a target company for an SDR.

{seller_lines}

Target company: {lead["company_name"]}
Contact name: {lead["contact_name"]}
Contact email: {lead["email"]}

Research and provide:
1. What the company does (products/services, industry, target market)
2. The contact's likely role and responsibilities based on their name and context
3. Pain points relevant to what the seller is offering
4. Suggested talking points for outreach

Be specific and actionable. Focus on insights that would help personalize a sales conversation.
"""

    try:
        response = model.generate_content(prompt)
        research_text = (response.text or "").strip()
    except Exception as error:  # noqa: BLE001
        return jsonify({"error": f"Gemini research failed: {error}"}), 502

    if not research_text:
        return jsonify({"error": "Gemini returned an empty response."}), 502

    # Determine the new notes content
    if not existing_notes:
        new_notes = research_text
    else:
        new_notes = f"{existing_notes}\n\n---\n\n{research_text}"

    # Save the research to the current stage notes
    with get_db_connection() as connection:
        connection.execute(
            """
            INSERT INTO lead_stage_notes (lead_id, stage, content)
            VALUES (?, ?, ?)
            ON CONFLICT(lead_id, stage) DO UPDATE SET
                content = excluded.content
            """,
            (lead_id, current_stage, new_notes),
        )
        connection.commit()
        row = connection.execute(
            "SELECT * FROM leads WHERE id = ?",
            (lead_id,),
        ).fetchone()
        body = lead_with_stage_notes(connection, row)

    return jsonify({"lead": body, "research": research_text}), 200


@app.route("/api/leads/<int:lead_id>", methods=["DELETE"])
def delete_lead(lead_id: int):
    if not get_lead_or_404(lead_id):
        return jsonify({"error": "Lead not found."}), 404

    with get_db_connection() as connection:
        connection.execute("DELETE FROM leads WHERE id = ?", (lead_id,))
        connection.commit()

    return jsonify({"message": "Lead deleted successfully."}), 200


@app.route("/api/leads/<int:lead_id>/generate-follow-up", methods=["POST"])
def generate_follow_up_email(lead_id: int):
    lead = get_lead_or_404(lead_id)
    if not lead:
        return jsonify({"error": "Lead not found."}), 404

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return jsonify({"error": "GEMINI_API_KEY is not set in environment."}), 500

    payload = request.get_json(silent=True) or {}
    extra_context = (payload.get("extra_context") or "").strip()
    user_ctx = payload.get("user_context")

    with get_db_connection() as connection:
        stage_notes = _fetch_stage_notes_dict(connection, lead_id)
    current_stage = lead["stage"]
    notes_for_stage = stage_notes.get(current_stage, "") or "No notes for this stage yet."

    model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    configure(api_key=api_key)
    model = GenerativeModel(model_name)

    seller_lines = _format_user_context_prompt(user_ctx)

    prompt = f"""
You are an SDR writing a concise, professional follow-up email.

{seller_lines}

Lead details:
- Company: {lead["company_name"]}
- Contact: {lead["contact_name"]}
- Email: {lead["email"]}
- Current stage: {current_stage}
- Notes (this stage only): {notes_for_stage}

Additional instructions from sender:
{extra_context or "None"}

Write:
1) Email subject line
2) Email body

Speak in the seller's voice, reference their offering when relevant, and keep the message specific (not boilerplate).

Keep it polite, specific, and actionable with a clear CTA.
"""

    try:
        response = model.generate_content(prompt)
        email_text = (response.text or "").strip()
    except Exception as error:  # noqa: BLE001
        return jsonify({"error": f"Gemini generation failed: {error}"}), 502

    if not email_text:
        return jsonify({"error": "Gemini returned an empty response."}), 502

    return jsonify({"lead_id": lead_id, "draft": email_text}), 200


if __name__ == "__main__":
    init_db()
    app.run(debug=True)
