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

const PROFILE_STORAGE_KEY = "pipelineUserProfile";

// Notes modal state
let currentNotesLeadId = null;
let currentNotesLeadData = null;

function normalizeProfile(obj) {
  if (!obj || typeof obj !== "object") return null;
  return {
    userName: String(obj.userName || "").trim(),
    jobTitle: String(obj.jobTitle || "").trim(),
    companyName: String(obj.companyName || "").trim(),
    selling: String(obj.selling || "").trim(),
  };
}

function loadUserProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveUserProfile(profile) {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

function isProfileComplete(profile) {
  return !!(
    profile &&
    profile.userName &&
    profile.jobTitle &&
    profile.companyName &&
    profile.selling
  );
}

function getUserContextForApi() {
  const p = loadUserProfile();
  if (!isProfileComplete(p)) return null;
  return {
    user_name: p.userName,
    job_title: p.jobTitle,
    company_name: p.companyName,
    selling: p.selling,
  };
}

function setProfileAriaStates() {
  const overlay = document.getElementById("profile-onboarding");
  if (!overlay) return;
  const ready = document.documentElement.classList.contains("profile-ready");
  const editing = overlay.classList.contains("profile-onboarding--edit-open");
  const overlayVisible = !ready || editing;
  overlay.setAttribute("aria-hidden", overlayVisible ? "false" : "true");
}

function populateProfileForm() {
  const p = loadUserProfile();
  const nameEl = document.getElementById("profile_user_name");
  const titleEl = document.getElementById("profile_job_title");
  const companyEl = document.getElementById("profile_company_name");
  const sellingEl = document.getElementById("profile_selling");
  if (nameEl) nameEl.value = p?.userName || "";
  if (titleEl) titleEl.value = p?.jobTitle || "";
  if (companyEl) companyEl.value = p?.companyName || "";
  if (sellingEl) sellingEl.value = p?.selling || "";
}

function openProfileEditorFromHeader() {
  populateProfileForm();
  const overlay = document.getElementById("profile-onboarding");
  const cancel = document.getElementById("profile-cancel-btn");
  const saveBtn = document.getElementById("profile-save-btn");
  const titleEl = document.getElementById("profile-onboarding-title");

  overlay?.classList.add("profile-onboarding--edit-open");
  cancel?.classList.remove("hidden");
  if (titleEl) titleEl.textContent = "Edit your profile";
  if (saveBtn) saveBtn.textContent = "Save";

  setProfileAriaStates();
}

function closeProfileEditor() {
  populateProfileForm();
  const overlay = document.getElementById("profile-onboarding");
  overlay?.classList.remove("profile-onboarding--edit-open");
  document.getElementById("profile-cancel-btn")?.classList.add("hidden");
  setProfileAriaStates();
}

async function refreshLeadsIfSignedIn() {
  if (!document.documentElement.classList.contains("profile-ready")) return;
  await loadLeads();
}

async function handleProfileFormSubmit(ev) {
  ev.preventDefault();
  const form = document.getElementById("profile-setup-form");
  if (!form) return;

  const profile = {
    userName: form.userName.value.trim(),
    jobTitle: form.jobTitle.value.trim(),
    companyName: form.companyName.value.trim(),
    selling: form.selling.value.trim(),
  };

  if (!isProfileComplete(profile)) {
    alert("Please fill in all fields.");
    return;
  }

  saveUserProfile(profile);
  document.documentElement.classList.add("profile-ready");
  closeProfileEditor();
  await refreshLeadsIfSignedIn();
}

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

  const stageNotes = lead.stage_notes && typeof lead.stage_notes === "object" ? lead.stage_notes : {};
  const notesText = (stageNotes[lead.stage] || "").trim() || "—";
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
      <button type="button" class="notes-btn" data-lead-id="${lead.id}">Notes</button>
      <button type="button" class="research-btn" data-lead-id="${lead.id}">Research</button>
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

// Notes modal functions
function openNotesModal(lead) {
  currentNotesLeadId = lead.id;
  currentNotesLeadData = lead;

  const modal = document.getElementById("notes-modal");
  const leadInfo = document.getElementById("notes-modal-lead-info");
  if (!modal || !leadInfo) return;

  // Set lead info header
  leadInfo.innerHTML = `
    <p><strong>${escapeHtml(lead.company_name)}</strong> — ${escapeHtml(lead.contact_name)}</p>
    <p class="notes-modal__current-stage">Current stage: <span>${escapeHtml(lead.stage)}</span></p>
  `;

  // Populate all stage textareas
  const stageNotes = lead.stage_notes && typeof lead.stage_notes === "object" ? lead.stage_notes : {};
  STAGES.forEach((stage) => {
    const textarea = document.getElementById(`notes-textarea-${stage}`);
    if (textarea) {
      textarea.value = stageNotes[stage] || "";
    }
  });

  // Activate the tab for current stage
  const tabs = document.querySelectorAll(".notes-tab");
  const panels = document.querySelectorAll(".notes-tab-panel");
  tabs.forEach((tab) => {
    const isActive = tab.dataset.stage === lead.stage;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  panels.forEach((panel) => {
    const isActive = panel.id === `panel-${lead.stage}`;
    panel.classList.toggle("active", isActive);
    panel.hidden = !isActive;
  });

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeNotesModal() {
  const modal = document.getElementById("notes-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  currentNotesLeadId = null;
  currentNotesLeadData = null;
}

function switchNotesTab(stage) {
  const tabs = document.querySelectorAll(".notes-tab");
  const panels = document.querySelectorAll(".notes-tab-panel");

  tabs.forEach((tab) => {
    const isActive = tab.dataset.stage === stage;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  panels.forEach((panel) => {
    const isActive = panel.id === `panel-${stage}`;
    panel.classList.toggle("active", isActive);
    panel.hidden = !isActive;
  });
}

async function handleNotesSave(stage) {
  if (!currentNotesLeadId) return;

  const textarea = document.getElementById(`notes-textarea-${stage}`);
  if (!textarea) return;

  const content = textarea.value;
  const saveBtn = document.querySelector(`.notes-save-btn[data-stage="${stage}"]`);
  const originalText = saveBtn?.textContent || "Save";

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
  }

  try {
    await fetchJson(`/api/leads/${currentNotesLeadId}/notes`, {
      method: "PATCH",
      body: JSON.stringify({ stage, content }),
    });
    // Refresh the leads to update the card display
    await loadLeads();
  } catch (err) {
    alert(err.message);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalText;
    }
  }
}

async function handleResearchClick(button) {
  const leadId = button.dataset.leadId;
  if (!leadId) return;

  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Researching…";

  try {
    const uc = getUserContextForApi();
    if (!uc) {
      alert("Please complete your profile before using AI research.");
      return;
    }

    const result = await fetchJson(`/api/leads/${leadId}/research`, {
      method: "POST",
      body: JSON.stringify({ user_context: uc }),
    });

    // Refresh leads to show updated notes
    await loadLeads();

    // Open notes modal to show the research results
    const updatedLead = result.lead;
    if (updatedLead) {
      currentNotesLeadId = leadId;
      currentNotesLeadData = updatedLead;
      openNotesModal(updatedLead);
    }
  } catch (err) {
    alert(err.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
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
    const genBody = {};
    const uc = getUserContextForApi();
    if (uc) genBody.user_context = uc;

    const result = await fetchJson(`/api/leads/${leadId}/generate-follow-up`, {
      method: "POST",
      body: JSON.stringify(genBody),
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
  populateProfileForm();
  setProfileAriaStates();

  const profileForm = document.getElementById("profile-setup-form");
  profileForm?.addEventListener("submit", (ev) => {
    void handleProfileFormSubmit(ev);
  });

  document.getElementById("profile-cancel-btn")?.addEventListener("click", () => {
    closeProfileEditor();
  });

  document.getElementById("open-profile-setup")?.addEventListener("click", () => {
    openProfileEditorFromHeader();
  });

  document.getElementById("profile-onboarding")?.addEventListener("click", (ev) => {
    if (ev.target !== ev.currentTarget) return;
    if (document.documentElement.classList.contains("profile-ready")) {
      closeProfileEditor();
    }
  });

  const form = document.getElementById("add-lead-form");
  const board = document.getElementById("kanban-board");
  const closeBtn = document.getElementById("close-email-modal");
  const closeNotesBtn = document.getElementById("close-notes-modal");

  if (form) {
    form.addEventListener("submit", handleAddLeadSubmit);
  }

  if (board) {
    board.addEventListener("change", (e) => {
      const select = e.target.closest(".stage-select");
      if (select) handleStageChange(select);
    });

    board.addEventListener("click", (e) => {
      const notesBtn = e.target.closest(".notes-btn");
      if (notesBtn) {
        e.preventDefault();
        const leadId = notesBtn.dataset.leadId;
        // Find the lead data from the current render
        const card = notesBtn.closest(".lead-card");
        if (card) {
          // We need to fetch the full lead data
          fetchJson(`/api/leads/${leadId}`)
            .then((lead) => openNotesModal(lead))
            .catch((err) => alert(err.message));
        }
        return;
      }

      const researchBtn = e.target.closest(".research-btn");
      if (researchBtn) {
        e.preventDefault();
        handleResearchClick(researchBtn);
        return;
      }

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

  // Notes modal tab switching
  document.querySelectorAll(".notes-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      switchNotesTab(tab.dataset.stage);
    });
  });

  // Notes modal save buttons
  document.querySelectorAll(".notes-save-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      handleNotesSave(btn.dataset.stage);
    });
  });

  initKanbanDragAndDrop();

  if (closeBtn) {
    closeBtn.addEventListener("click", closeEmailModal);
  }

  if (closeNotesBtn) {
    closeNotesBtn.addEventListener("click", closeNotesModal);
  }

  document.querySelectorAll("[data-modal-dismiss]").forEach((el) => {
    el.addEventListener("click", () => {
      closeEmailModal();
      closeNotesModal();
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const overlay = document.getElementById("profile-onboarding");
    if (overlay?.classList.contains("profile-onboarding--edit-open")) {
      closeProfileEditor();
      e.preventDefault();
      return;
    }
    closeEmailModal();
    closeNotesModal();
  });

  if (document.documentElement.classList.contains("profile-ready")) {
    void refreshLeadsIfSignedIn();
  }
});
