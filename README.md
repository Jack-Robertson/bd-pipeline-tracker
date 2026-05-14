# BD Pipeline Tracker

An AI-native CRM designed to bridge the gap between static lead tracking and automated outreach. Built to explore context-aware LLM workflows and state-driven frontend architecture.

[**Live Demo**](https://bd-pipeline-tracker.onrender.com/) 

## The Problem
Traditional CRMs are often just glorified spreadsheets. This tool transforms leads into **context-rich workspaces**, using an LLM to bridge the gap between "having a contact" and "sending a personalized message" based on stored history and pipeline stage.

## Engineering Highlights
*   **Vanilla JS State Management:** Built a reactive, drag-and-drop Kanban board using pure JavaScript (no frameworks) to demonstrate a deep understanding of DOM manipulation and frontend state.
*   **Custom Data Layer:** Implemented an SQLite persistence layer without an ORM to maintain full control over schema evolution and complex deletion cascades.
*   **Contextual Prompt Orchestration:** Designed an AI engine that injects user profiles, lead metadata, and interaction history into Groq (Llama 3.3) to generate high-signal outreach rather than generic templates.
*   **RESTful Architecture:** Developed a clean Flask-based API to handle real-time updates for leads, pipeline stages, and research actions.

## Tech Stack
*   **Backend:** Python (Flask), SQLite
*   **Frontend:** Vanilla JS, CSS3, HTML5
*   **AI:** Groq API (Llama 3.3 70B)
*   **Deployment:** Render, Gunicorn

## Core Workflow
1.  **Track:** Manage leads via a custom drag-and-drop Kanban pipeline.
2.  **Research:** Trigger AI-powered company briefs based on lead metadata.
3.  **Engage:** Generate outreach messages that are automatically adjusted based on the lead’s current pipeline stage and previous notes.

## Setup & Local Dev
git clone [https://github.com/Jack-Robertson/BD-PIPELINE-TRACKER](https://github.com/Jack-Robertson/BD-PIPELINE-TRACKER)
cd BD-PIPELINE-TRACKER
python -m venv .venv
source .venv/bin/activate  # On Windows use `.venv\Scripts\activate`
pip install -r requirements.txt
python app.py

Future Roadmap
Persistence: Migrating to PostgreSQL to move beyond Render's ephemeral storage.

Auth: Implementing Google OAuth for multi-user support.

Data Portability: Adding CSV/JSON export functionality.
