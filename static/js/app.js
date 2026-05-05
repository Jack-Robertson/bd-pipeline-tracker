/**
 * Sales pipeline UI: load leads, add lead, change stage, delete, generate AI follow-up, drag-and-drop.
 */

const STAGES = [
  "Prospecting",
  "Contacted",
  "Demo Scheduled",
  "Proposal Sent",
  "Closed",
];

const STAGE_CONTAINER_IDS = {
  Prospecting: "stage-prospecting",
  Contacted: "stage-contacted",
  "Demo Scheduled": "stage-demo-scheduled",
  "Proposal Sent": "stage-proposal-sent",
  Closed: "stage-closed",
};

function getStageListEl(stage) {
  const id = STAGE_CONTAINER_IDS[stage];
  return id ? document.getElementById(id) : null;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || res.statusText || "Request failed";
    throw new Error(msg);
  }
  return data;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

function buildStageSelect(currentStage, leadId) {
  const options = STAGES.map(
    (s) =>
      `<option value="${escapeHtml(s)}"${s === currentStage ? " selected" : ""}>${escapeHtml(s)}</option>`
  ).join("");
  return `<select class="stage-select" data-lead-id="${leadId}" data-previous-stage="${escapeHtml(
    currentStage
  )}" aria-label="Move to stage">${options}</select>`;
}

function attachCardDragHandlers(article, lead) {
  const grip = article.querySelector(".lead-card__grip");
  if (!grip) return;

  grip.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", String(lead.id));
    e.dataTransfer.effectAllowed = "move";
    article.classList.add("lead-card--dragging");
  });

  grip.addEventListener("dragend", () => {
    article.classList.remove("lead-card--dragging");
    document.querySelectorAll(".kanban-column").forEach((col) => {
      col.classList.remove("column--drag-over");
    });
  });
}

function createLeadCard(lead) {
  const article = document.createElement("article");
  article.className = "lead-card";
  article.dataset.leadId = String(lead.id);
  article.dataset.stage = lead.stage;

  const notesText = (lead.notes || "").trim() || "—";
  article.innerHTML = `
    <div class="lead-card__head">
      <span
        class="lead-card__grip"
        draggable="true"
        aria-label="Drag to another column"
        title="Drag to another column"
      >⋮⋮</span>
      <h4>${escapeHtml(lead.company_name)}</h4>
    </div>
    <p>${escapeHtml(lead.contact_name)}</p>
    <p><a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a></p>
    <p class="lead-notes">Notes: ${escapeHtml(notesText)}</p>
    <div class="card-actions">
      ${buildStageSelect(lead.stage, lead.id)}
      <button type="button" class="generate-btn" data-lead-id="${lead.id}">Generate follow-up</button>
      <button type="button" class="delete-btn" data-lead-id="${lead.id}">Delete</button>
    </div>
  `;

  attachCardDragHandlers(article, lead);
  return article;
}

function clearBoard() {
  STAGES.forEach((stage) => {
    const el = getStageListEl(stage);
    if (el) el.innerHTML = "";
  });
}

function updateColumnCounts(leads) {
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0]));
  for (const lead of leads) {
    if (counts[lead.stage] !== undefined) counts[lead.stage] += 1;
  }
  document.querySelectorAll(".kanban-column").forEach((column) => {
    const stage = column.dataset.stage;
    const badge = column.querySelector(".column-count");
    if (badge && stage && counts[stage] !== undefined) {
      badge.textContent = String(counts[stage]);
    }
  });
}

function renderLeads(leads) {
  clearBoard();
  for (const lead of leads) {
    const list = getStageListEl(lead.stage);
    if (!list) continue;
    list.appendChild(createLeadCard(lead));
  }
  updateColumnCounts(leads);
}

async function loadLeads() {
  try {
    const leads = await fetchJson("/api/leads");
    renderLeads(leads);
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
}

function openEmailModal(draft) {
  const modal = document.getElementById("email-modal");
  const output = document.getElementById("email-draft-output");
  if (!modal || !output) return;
  output.value = draft || "";
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeEmailModal() {
  const modal = document.getElementById("email-modal");
  const output = document.getElementById("email-draft-output");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  if (output) output.value = "";
}

async function handleAddLeadSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const payload = {
    company_name: form.company_name.value.trim(),
    contact_name: form.contact_name.value.trim(),
    email: form.email.value.trim(),
    notes: form.notes.value.trim(),
    stage: form.stage.value,
  };

  try {
    await fetchJson("/api/leads", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    form.reset();
    await loadLeads();
  } catch (err) {
    alert(err.message);
  }
}

async function handleStageChange(select) {
  const leadId = select.dataset.leadId;
  const stage = select.value;
  const previous = select.dataset.previousStage;
  if (!leadId || stage === previous) return;

  select.disabled = true;

  try {
    await fetchJson(`/api/leads/${leadId}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ stage }),
    });
    select.dataset.previousStage = stage;
    await loadLeads();
  } catch (err) {
    alert(err.message);
    select.value = previous || STAGES[0];
  } finally {
    select.disabled = false;
  }
}

async function handleGenerateClick(button) {
  const leadId = button.dataset.leadId;
  if (!leadId) return;

  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Generating…";

  try {
    const result = await fetchJson(`/api/leads/${leadId}/generate-follow-up`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    openEmailModal(result.draft || "");
  } catch (err) {
    alert(err.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function handleDeleteClick(button) {
  const leadId = button.dataset.leadId;
  if (!leadId) return;

  if (!confirm("Delete this lead?")) return;

  button.disabled = true;

  try {
    await fetchJson(`/api/leads/${leadId}`, { method: "DELETE" });
    await loadLeads();
  } catch (err) {
    alert(err.message);
  } finally {
    button.disabled = false;
  }
}

function initKanbanDragAndDrop() {
  document.querySelectorAll(".kanban-column").forEach((column) => {
    column.addEventListener("dragenter", (e) => {
      e.preventDefault();
      column.classList.add("column--drag-over");
    });

    column.addEventListener("dragleave", (e) => {
      if (!column.contains(e.relatedTarget)) {
        column.classList.remove("column--drag-over");
      }
    });

    column.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });

    column.addEventListener("drop", async (e) => {
      e.preventDefault();
      column.classList.remove("column--drag-over");

      const leadId = e.dataTransfer.getData("text/plain");
      if (!leadId) return;

      const newStage = column.dataset.stage;
      const card = document.querySelector(`.lead-card[data-lead-id="${leadId}"]`);
      const oldStage = card?.dataset.stage;

      if (!newStage || oldStage === newStage) return;

      try {
        await fetchJson(`/api/leads/${leadId}/stage`, {
          method: "PATCH",
          body: JSON.stringify({ stage: newStage }),
        });
        await loadLeads();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("add-lead-form");
  const board = document.getElementById("kanban-board");
  const closeBtn = document.getElementById("close-email-modal");

  if (form) {
    form.addEventListener("submit", handleAddLeadSubmit);
  }

  if (board) {
    board.addEventListener("change", (e) => {
      const select = e.target.closest(".stage-select");
      if (select) handleStageChange(select);
    });

    board.addEventListener("click", (e) => {
      const gen = e.target.closest(".generate-btn");
      if (gen) {
        e.preventDefault();
        handleGenerateClick(gen);
        return;
      }
      const del = e.target.closest(".delete-btn");
      if (del) {
        e.preventDefault();
        handleDeleteClick(del);
      }
    });
  }

  initKanbanDragAndDrop();

  if (closeBtn) {
    closeBtn.addEventListener("click", closeEmailModal);
  }

  document.querySelectorAll("[data-modal-dismiss]").forEach((el) => {
    el.addEventListener("click", closeEmailModal);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeEmailModal();
  });

  loadLeads();
});
