// My Notebook — static app, Supabase JS v2 (loaded from CDN as window.supabase).
// All user-provided text is rendered with textContent / .value — never innerHTML.
"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  status: $("session-status"), error: $("error"), info: $("info"),
  authSection: $("auth-section"), authForm: $("auth-form"),
  email: $("email"), password: $("password"),
  signInBtn: $("sign-in-btn"), signUpBtn: $("sign-up-btn"),
  notesSection: $("notes-section"), signOutBtn: $("sign-out-btn"),
  newNoteForm: $("new-note-form"), newNote: $("new-note"),
  list: $("notes-list"), empty: $("notes-empty"),
};

let db = null;
let currentUser = null;
let rendered = false;

// ---------- messages ----------
function showError(err) {
  const msg = typeof err === "string" ? err : (err && err.message) || String(err);
  console.error(err);
  els.error.textContent = msg;
  els.error.hidden = false;
  els.info.hidden = true;
}
function showInfo(msg) {
  els.info.textContent = msg;
  els.info.hidden = false;
}
function clearMessages() {
  els.error.hidden = true;
  els.info.hidden = true;
}

// Disable a set of buttons while an async action runs; surface any error.
async function busy(buttons, fn) {
  buttons.forEach((b) => (b.disabled = true));
  clearMessages();
  try {
    await fn();
  } catch (err) {
    showError(err);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

// ---------- config ----------
function loadClient() {
  const cfg = window.NOTEBOOK_CONFIG || {};
  const url = (cfg.SUPABASE_URL || "").trim();
  const key = (cfg.SUPABASE_PUBLISHABLE_KEY || "").trim();

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    throw new Error("Supabase JS failed to load from the CDN. Check your internet connection.");
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
    throw new Error("config.js: SUPABASE_URL is missing or invalid (expected https://<project>.supabase.co).");
  }
  if (key.startsWith("sb_secret_")) {
    throw new Error("config.js contains a SECRET key. Remove it now and rotate it in the Supabase dashboard. Only the publishable key belongs here.");
  }
  if (!key.startsWith("sb_publishable_")) {
    throw new Error("config.js: SUPABASE_PUBLISHABLE_KEY is missing (expected sb_publishable_...).");
  }
  return window.supabase.createClient(url, key);
}

// ---------- session UI ----------
function renderSession(session) {
  const nextUser = session ? session.user : null;
  // Token refreshes keep the same user: don't re-render (it would wipe an edit in progress).
  if (rendered && (nextUser && nextUser.id) === (currentUser && currentUser.id)) return;
  rendered = true;
  currentUser = nextUser;
  if (currentUser) {
    els.status.textContent = `Signed in as ${currentUser.email}`;
    els.authSection.hidden = true;
    els.notesSection.hidden = false;
    loadNotes();
  } else {
    els.status.textContent = "Signed out";
    els.authSection.hidden = false;
    els.notesSection.hidden = true;
    els.list.replaceChildren();
  }
}

// ---------- auth ----------
function credentials() {
  const email = els.email.value.trim();
  const password = els.password.value;
  if (!email || !password) throw new Error("Enter an email and a password.");
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");
  return { email, password };
}

const authButtons = () => [els.signInBtn, els.signUpBtn];

els.authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  busy(authButtons(), async () => {
    const { error } = await db.auth.signInWithPassword(credentials());
    if (error) throw error;
    els.password.value = "";
  });
});

els.signUpBtn.addEventListener("click", () => {
  busy(authButtons(), async () => {
    const { data, error } = await db.auth.signUp(credentials());
    if (error) throw error;
    els.password.value = "";
    if (!data.session) {
      showInfo("Account created. Check your email to confirm it, then sign in.");
    }
  });
});

els.signOutBtn.addEventListener("click", () => {
  busy([els.signOutBtn], async () => {
    const { error } = await db.auth.signOut();
    if (error) throw error;
  });
});

// ---------- notes CRUD ----------
async function loadNotes() {
  try {
    const { data, error } = await db
      .from("notes")
      .select("id, body, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    renderNotes(data);
  } catch (err) {
    showError(`Could not load notes: ${err.message || err}`);
  }
}

function renderNotes(notes) {
  els.list.replaceChildren(...notes.map(noteItem));
  els.empty.hidden = notes.length > 0;
}

function button(label, className, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (className) b.className = className;
  b.addEventListener("click", onClick);
  return b;
}

function noteItem(note) {
  const li = document.createElement("li");

  const meta = document.createElement("div");
  meta.className = "note-meta";
  meta.textContent = new Date(note.created_at).toLocaleString();

  const body = document.createElement("p");
  body.className = "note-body";
  body.textContent = note.body; // safe: never parsed as HTML

  const actions = document.createElement("div");
  actions.className = "row";

  const editBtn = button("Edit", "secondary", () => startEdit(li, note));
  // Two-step delete inside the page: window.confirm() is blocked in some
  // embedded browsers (e.g. VS Code preview) and silently returns false.
  let armed = false;
  let disarmTimer = null;
  const delBtn = button("Delete", "danger", () => {
    if (!armed) {
      armed = true;
      delBtn.textContent = "Click again to delete";
      disarmTimer = setTimeout(() => {
        armed = false;
        delBtn.textContent = "Delete";
      }, 4000);
      return;
    }
    clearTimeout(disarmTimer);
    armed = false;
    delBtn.textContent = "Deleting…";
    busy([editBtn, delBtn], async () => {
      const { data, error } = await db.from("notes").delete().eq("id", note.id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Note not deleted (not found or not yours).");
      await loadNotes();
    }).then(() => { delBtn.textContent = "Delete"; }); // restore label if it failed
  });

  actions.append(editBtn, delBtn);
  li.append(meta, body, actions);
  return li;
}

function startEdit(li, note) {
  const area = document.createElement("textarea");
  area.rows = 4;
  area.maxLength = 10000;
  area.value = note.body;

  const actions = document.createElement("div");
  actions.className = "row";

  const saveBtn = button("Save", "", () => {
    busy([saveBtn, cancelBtn], async () => {
      const text = area.value.trim();
      if (!text) throw new Error("A note cannot be empty.");
      const { data, error } = await db
        .from("notes").update({ body: text }).eq("id", note.id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Note not updated (not found or not yours).");
      await loadNotes();
    });
  });
  const cancelBtn = button("Cancel", "secondary", () => li.replaceWith(noteItem(note)));

  actions.append(saveBtn, cancelBtn);
  li.replaceChildren(area, actions);
  area.focus();
}

els.newNoteForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const submit = els.newNoteForm.querySelector("button[type=submit]");
  busy([submit], async () => {
    const text = els.newNote.value.trim();
    if (!text) throw new Error("Write something before adding a note.");
    if (!currentUser) throw new Error("You are signed out.");
    const { error } = await db.from("notes").insert({ body: text, owner_id: currentUser.id });
    if (error) throw error;
    els.newNote.value = "";
    await loadNotes();
  });
});

// ---------- start ----------
(async function init() {
  try {
    db = loadClient();
  } catch (err) {
    els.status.textContent = "Not configured";
    showError(err);
    return;
  }

  db.auth.onAuthStateChange((event, session) => {
    // Defer work out of the callback, as recommended by supabase-js.
    setTimeout(() => renderSession(session), 0);
  });

  const { data, error } = await db.auth.getSession();
  if (error) showError(error);
  renderSession(data ? data.session : null);
})();
