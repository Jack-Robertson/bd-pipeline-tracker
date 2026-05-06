import os
import sqlite3
from typing import Any

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from groq import Groq

from database import get_db_connection, init_db


app = Flask(__name__, instance_relative_config=True)


@app.route("/", methods=["GET"])
def home():
    return render_template("index.html")


def lead_row_to_dict(row: Any) -> dict:
    """Convert a lead row to API response dict."""
    return {
        "id": row["id"],
        "company_name": row["company_name"],
        "contact_name": row["contact_name"],
        "email": row["email"],
        "stage": row["stage"],
        "notes": row["notes"] or "",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def get_lead_or_404(lead_id: int):
    """Return lead row or None if not found."""
    with get_db_connection() as connection:
        lead = connection.execute(
            "SELECT * FROM leads WHERE id = ?",
            (lead_id,),
        ).fetchone()
    return lead


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


# Stage API endpoints
@app.route("/api/stages", methods=["GET"])
def get_stages():
    with get_db_connection() as connection:
        rows = connection.execute(
            "SELECT id, name, position FROM stages ORDER BY position ASC"
        ).fetchall()
    return jsonify([{"id": row["id"], "name": row["name"], "position": row["position"]} for row in rows]), 200


@app.route("/api/stages", methods=["POST"])
def add_stage():
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()

    if not name:
        return jsonify({"error": "Stage name is required."}), 400

    with get_db_connection() as connection:
        # Check for duplicate
        existing = connection.execute(
            "SELECT id FROM stages WHERE LOWER(name) = LOWER(?)",
            (name,),
        ).fetchone()
        if existing:
            return jsonify({"error": "A stage with this name already exists."}), 409

        # Get max position
        max_pos = connection.execute(
            "SELECT MAX(position) as max_pos FROM stages"
        ).fetchone()
        new_position = (max_pos["max_pos"] or 0) + 1

        cursor = connection.execute(
            "INSERT INTO stages (name, position) VALUES (?, ?)",
            (name, new_position),
        )
        new_id = cursor.lastrowid
        connection.commit()

        new_stage = connection.execute(
            "SELECT id, name, position FROM stages WHERE id = ?",
            (new_id,),
        ).fetchone()

    return jsonify({"id": new_stage["id"], "name": new_stage["name"], "position": new_stage["position"]}), 201


@app.route("/api/stages/<int:stage_id>", methods=["PATCH"])
def update_stage(stage_id: int):
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()

    if not name:
        return jsonify({"error": "Stage name is required."}), 400

    with get_db_connection() as connection:
        # Check if stage exists
        existing = connection.execute(
            "SELECT id FROM stages WHERE id = ?",
            (stage_id,),
        ).fetchone()
        if not existing:
            return jsonify({"error": "Stage not found."}), 404

        # Check for duplicate name (excluding current stage)
        duplicate = connection.execute(
            "SELECT id FROM stages WHERE LOWER(name) = LOWER(?) AND id != ?",
            (name, stage_id),
        ).fetchone()
        if duplicate:
            return jsonify({"error": "A stage with this name already exists."}), 409

        connection.execute(
            "UPDATE stages SET name = ? WHERE id = ?",
            (name, stage_id),
        )
        # Also update any leads using this stage name
        connection.execute(
            "UPDATE leads SET stage = ? WHERE stage = (SELECT name FROM stages WHERE id = ?)",
            (name, stage_id),
        )
        connection.commit()

    return jsonify({"id": stage_id, "name": name}), 200


@app.route("/api/stages/<int:stage_id>", methods=["DELETE"])
def delete_stage(stage_id: int):
    with get_db_connection() as connection:
        # Check if stage exists
        stage = connection.execute(
            "SELECT name FROM stages WHERE id = ?",
            (stage_id,),
        ).fetchone()
        if not stage:
            return jsonify({"error": "Stage not found."}), 404

        # Check if any leads are in this stage
        lead_count = connection.execute(
            "SELECT COUNT(*) as cnt FROM leads WHERE stage = ?",
            (stage["name"],),
        ).fetchone()
        if lead_count["cnt"] > 0:
            return jsonify({"error": "Cannot delete stage that has leads. Move leads to another stage first."}), 400

        connection.execute(
            "DELETE FROM stages WHERE id = ?",
            (stage_id,),
        )
        connection.commit()

    return jsonify({"message": "Stage deleted successfully."}), 200


@app.route("/api/stages/reorder", methods=["POST"])
def reorder_stages():
    payload = request.get_json(silent=True) or {}
    order = payload.get("order", [])

    if not isinstance(order, list) or len(order) == 0:
        return jsonify({"error": "Order array is required."}), 400

    with get_db_connection() as connection:
        for position, stage_id in enumerate(order):
            connection.execute(
                "UPDATE stages SET position = ? WHERE id = ?",
                (position, stage_id),
            )
        connection.commit()

    return jsonify({"message": "Stages reordered."}), 200


# Lead API endpoints
@app.route("/api/leads", methods=["GET"])
def get_all_leads():
    with get_db_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM leads ORDER BY created_at DESC, id DESC"
        ).fetchall()
    return jsonify([lead_row_to_dict(row) for row in rows]), 200


@app.route("/api/leads/<int:lead_id>", methods=["GET"])
def get_lead(lead_id: int):
    with get_db_connection() as connection:
        row = connection.execute(
            "SELECT * FROM leads WHERE id = ?",
            (lead_id,),
        ).fetchone()
    if not row:
        return jsonify({"error": "Lead not found."}), 404
    return jsonify(lead_row_to_dict(row)), 200


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
            jsonify({"error": "company_name, contact_name, and email are required."}),
            400,
        )

    with get_db_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO leads (company_name, contact_name, email, stage, notes)
            VALUES (?, ?, ?, ?, ?)
            """,
            (company_name, contact_name, email, stage, notes),
        )
        new_id = cursor.lastrowid
        connection.commit()
        new_lead = connection.execute(
            "SELECT * FROM leads WHERE id = ?",
            (new_id,),
        ).fetchone()

    return jsonify(lead_row_to_dict(new_lead)), 201


@app.route("/api/leads/<int:lead_id>", methods=["PATCH"])
def update_lead(lead_id: int):
    lead = get_lead_or_404(lead_id)
    if not lead:
        return jsonify({"error": "Lead not found."}), 404

    payload = request.get_json(silent=True) or {}

    with get_db_connection() as connection:
        # Update fields if provided
        updates = []
        values = []

        if "stage" in payload:
            stage = (payload["stage"] or "").strip()
            if stage:
                updates.append("stage = ?")
                values.append(stage)

        if "company_name" in payload:
            company_name = (payload["company_name"] or "").strip()
            updates.append("company_name = ?")
            values.append(company_name)

        if "contact_name" in payload:
            contact_name = (payload["contact_name"] or "").strip()
            updates.append("contact_name = ?")
            values.append(contact_name)

        if "email" in payload:
            email = (payload["email"] or "").strip()
            updates.append("email = ?")
            values.append(email)

        if updates:
            values.append(lead_id)
            connection.execute(
                f"UPDATE leads SET {', '.join(updates)} WHERE id = ?",
                tuple(values),
            )
            connection.commit()

        updated_lead = connection.execute(
            "SELECT * FROM leads WHERE id = ?",
            (lead_id,),
        ).fetchone()

    return jsonify(lead_row_to_dict(updated_lead)), 200


@app.route("/api/leads/<int:lead_id>/stage", methods=["PATCH"])
def update_lead_stage(lead_id: int):
    lead = get_lead_or_404(lead_id)
    if not lead:
        return jsonify({"error": "Lead not found."}), 404

    payload = request.get_json(silent=True) or {}
    stage = (payload.get("stage") or "").strip()

    if not stage:
        return jsonify({"error": "stage is required."}), 400

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

    return jsonify(lead_row_to_dict(updated_lead)), 200


@app.route("/api/leads/<int:lead_id>/notes", methods=["PATCH"])
def update_lead_notes(lead_id: int):
    lead = get_lead_or_404(lead_id)
    if not lead:
        return jsonify({"error": "Lead not found."}), 404

    payload = request.get_json(silent=True) or {}
    if "content" not in payload:
        return jsonify({"error": "content is required (use empty string to clear)."}), 400

    content = payload["content"]
    if content is None:
        content = ""
    elif not isinstance(content, str):
        content = str(content)

    with get_db_connection() as connection:
        connection.execute(
            "UPDATE leads SET notes = ? WHERE id = ?",
            (content, lead_id),
        )
        connection.commit()
        row = connection.execute(
            "SELECT * FROM leads WHERE id = ?",
            (lead_id,),
        ).fetchone()

    return jsonify(lead_row_to_dict(row)), 200


@app.route("/api/leads/<int:lead_id>", methods=["DELETE"])
def delete_lead(lead_id: int):
    lead = get_lead_or_404(lead_id)
    if not lead:
        return jsonify({"error": "Lead not found."}), 404

    with get_db_connection() as connection:
        connection.execute("DELETE FROM leads WHERE id = ?", (lead_id,))
        connection.commit()

    return jsonify({"message": "Lead deleted successfully."}), 200


@app.route("/api/leads/<int:lead_id>/research", methods=["POST"])
def research_lead(lead_id: int):
    lead = get_lead_or_404(lead_id)
    if not lead:
        return jsonify({"error": "Lead not found."}), 404

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return jsonify({"error": "GROQ_API_KEY is not set in environment."}), 500

    payload = request.get_json(silent=True) or {}
    user_ctx = payload.get("user_context")

    client = Groq(api_key=api_key)

    seller_lines = _format_user_context_prompt(user_ctx)

    prompt = f"""You are an expert sales researcher. Analyze this target company and return ONLY the following four sections in this exact format. No preamble, no sign-off, no filler.

{seller_lines}

Target company: {lead["company_name"]}
Contact name: {lead["contact_name"]}
Contact email: {lead["email"]}

Return EXACTLY this format:

• What they do: [one sentence]
• Contact's role: [one sentence]
• Their likely pain points:
  - [bullet, max 10 words]
  - [bullet, max 10 words]
  - [bullet, max 10 words]
• Talking points:
  - [bullet tied to what seller sells, max 10 words]
  - [bullet tied to what seller sells, max 10 words]
  - [bullet tied to what seller sells, max 10 words]
"""

    try:
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1024,
        )
        research_text = (completion.choices[0].message.content or "").strip()
    except Exception as error:  # noqa: BLE001
        return jsonify({"error": f"Groq research failed: {error}"}), 502

    if not research_text:
        return jsonify({"error": "Groq returned an empty response."}), 502

    return jsonify({"lead_id": lead_id, "research": research_text}), 200


@app.route("/api/leads/<int:lead_id>/generate-follow-up", methods=["POST"])
def generate_follow_up_email(lead_id: int):
    lead = get_lead_or_404(lead_id)
    if not lead:
        return jsonify({"error": "Lead not found."}), 404

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return jsonify({"error": "GROQ_API_KEY is not set in environment."}), 500

    payload = request.get_json(silent=True) or {}
    extra_context = (payload.get("extra_context") or "").strip()
    user_ctx = payload.get("user_context")

    current_stage = lead["stage"]
    notes = lead["notes"] or ""
    notes_text = notes if notes else "No notes yet."

    client = Groq(api_key=api_key)

    seller_lines = _format_user_context_prompt(user_ctx)

    prompt = f"""You are an SDR writing a concise, professional follow-up email.

{seller_lines}

Lead details:
- Company: {lead["company_name"]}
- Contact: {lead["contact_name"]}
- Email: {lead["email"]}
- Current stage: {current_stage}
- Notes: {notes_text}

Additional instructions from sender:
{extra_context or "None"}

Write:
1) Email subject line
2) Email body

Speak in the seller's voice. Reference their offering when relevant. Make the email feel specific to the {current_stage} stage of the sales process. Keep it polite, specific, and actionable with a clear CTA.
"""

    try:
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1024,
        )
        email_text = (completion.choices[0].message.content or "").strip()
    except Exception as error:  # noqa: BLE001
        return jsonify({"error": f"Groq generation failed: {error}"}), 502

    if not email_text:
        return jsonify({"error": "Groq returned an empty response."}), 502

    return jsonify({"lead_id": lead_id, "draft": email_text}), 200


if __name__ == "__main__":
    init_db()
    app.run(debug=True)