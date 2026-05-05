import os
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


def row_to_dict(row: Any) -> dict:
    """Convert sqlite row object to a standard dict."""
    return {
        "id": row["id"],
        "company_name": row["company_name"],
        "contact_name": row["contact_name"],
        "email": row["email"],
        "notes": row["notes"],
        "stage": row["stage"],
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


@app.route("/api/leads", methods=["GET"])
def get_all_leads():
    with get_db_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM leads ORDER BY created_at DESC, id DESC"
        ).fetchall()
    return jsonify([row_to_dict(row) for row in rows]), 200


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
            INSERT INTO leads (company_name, contact_name, email, notes, stage)
            VALUES (?, ?, ?, ?, ?)
            """,
            (company_name, contact_name, email, notes, stage),
        )
        connection.commit()
        new_lead = connection.execute(
            "SELECT * FROM leads WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()

    return jsonify(row_to_dict(new_lead)), 201


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

    return jsonify(row_to_dict(updated_lead)), 200


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

    # 1.5 models are removed from many keys; override with GEMINI_MODEL if needed (e.g. gemini-2.0-flash).
    model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    configure(api_key=api_key)
    model = GenerativeModel(model_name)

    prompt = f"""
You are an SDR writing a concise, professional follow-up email.

Lead details:
- Company: {lead["company_name"]}
- Contact: {lead["contact_name"]}
- Email: {lead["email"]}
- Current stage: {lead["stage"]}
- Notes: {lead["notes"] or "No notes provided."}

Additional context from user:
{extra_context or "None"}

Write:
1) Email subject line
2) Email body

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
