import { nanoid } from 'https://cdn.jsdelivr.net/npm/nanoid/nanoid.js';

const socket = io();
let editor = null;
const decorations = {};
const userColors = {};
const activeUsers = new Set();
let suppressNextChange = false;

// 🔧 Helper: force Monaco to match the editorContainer size
function layoutEditorToContainer() {
  if (!editor) return;
  const container = document.getElementById("editorContainer");
  if (!container) return;
  const rect = container.getBoundingClientRect();
  editor.layout({
    width: rect.width,
    height: rect.height,
  });
}

// 🧩 Monaco Setup
require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.36.1/min/vs' } });
require(['vs/editor/editor.main'], () => {
  editor = monaco.editor.create(document.getElementById('editorContainer'), {
    theme: 'vs-dark',
    automaticLayout: false,         // we control layout manually
    minimap: { enabled: false },
    language: 'javascript'
  });

  layoutEditorToContainer();

  editor.onDidChangeModelContent(() => {
    if (suppressNextChange) { suppressNextChange = false; return; }
    if (!currentFile) return;
    const code = editor.getValue();
    socket.emit('code-change', { roomId, filename: currentFile, code });
    if (files[currentFile]) files[currentFile].code = code;
  });

  editor.onDidChangeCursorPosition(() => {
    socket.emit("presence", { roomId, username, position: editor.getPosition() });
  });

  window.addEventListener('resize', () => {
    layoutEditorToContainer();
  });
});

// 🎛️ DOM Elements
const homePage = document.getElementById("homePage");
const editorPage = document.getElementById("editorPage");
const joinBtn = document.getElementById("joinBtn");
const createBtn = document.getElementById("createNewBtn");
const leaveBtn = document.getElementById("leaveBtn");
const runBtn = document.getElementById("runBtn");
const sendBtn = document.getElementById("sendBtn");
const newFileBtn = document.getElementById("newFileBtn");
const saveBtn = document.getElementById("saveBtn");
const saveServerBtn = document.getElementById("saveServerBtn");
const deleteFileBtn = document.getElementById("deleteFileBtn");

const roomIdInput = document.getElementById("roomIdInput");
const usernameInput = document.getElementById("usernameInput");
const languageSelect = document.getElementById("languageSelect");
const versionSelect = document.getElementById("versionSelect"); // might be null in current UI
const inputArea = document.getElementById("inputArea");
const chatArea = document.getElementById("chatArea");
const chatInput = document.getElementById("chatInput");
const outputArea = document.getElementById("outputArea");
const clientsList = document.getElementById("clientsList");
const fileTabs = document.getElementById("fileTabs");

const editorPanel = document.getElementById("editorPanel");
const leftPanel = document.getElementById("leftPanel");
const chatPanel = document.getElementById("chatPanel");
const dividerLeft = document.getElementById("dividerLeft");
const dividerRight = document.getElementById("dividerRight");

// new sections in sidebar
const usersSection = document.getElementById("usersSection");
const filesSection = document.getElementById("filesSection");

// activity bar buttons
const activityIcons = document.querySelectorAll('.activityIcon');
const explorerBtn = Array.from(activityIcons).find(btn => btn.title === 'Explorer');
const usersBtn = Array.from(activityIcons).find(btn => btn.title === 'Users');
const chatToggleBtn = Array.from(activityIcons).find(btn => btn.title === 'Chat');

let username = "";
let roomId = "";
const MAX_USERS = 20;

// 📁 File Management
let files = {};
let currentFile = null;
const models = {};

// 🏠 Room Actions
createBtn.addEventListener("click", () => roomIdInput.value = nanoid(8));

joinBtn.addEventListener("click", () => {
  roomId = roomIdInput.value.trim();
  username = usernameInput.value.trim();
  if (!roomId || !username) return alert("Room ID & Username required!");

  homePage.style.display = "none";
  editorPage.style.display = "flex";
  socket.emit("join", { roomId, username });
  socket.emit("get-files", roomId);

  setTimeout(layoutEditorToContainer, 400);
});

leaveBtn.addEventListener("click", () => {
  socket.emit("leave", { roomId, username });
  window.location.reload();
});

// ➕ New File
newFileBtn.addEventListener("click", () => {
  const filename = prompt("New file name (e.g., index.html or main.py):");
  if (!filename) return;
  const lang = detectLanguage(filename);
  socket.emit("create-file", { roomId, filename, language: lang });
});

// 💾 Save Local
saveBtn.addEventListener("click", () => {
  if (!currentFile) return alert("Open a file to save.");
  const content = editor.getValue();
  const blob = new Blob([content], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = currentFile;
  link.click();
});

// ☁️ Save to Server (in-memory)
saveServerBtn.addEventListener("click", () => {
  if (!currentFile) return alert("Open a file to save.");
  const content = editor.getValue();
  socket.emit("save-file-server", { roomId, filename: currentFile, code: content });
});

// 🗑️ Delete File
deleteFileBtn.addEventListener("click", () => {
  if (!currentFile) return alert("Open a file to delete.");
  if (!confirm(`Delete ${currentFile}? This removes it for everyone in the room.`)) return;
  socket.emit("delete-file", { roomId, filename: currentFile });
  currentFile = null;
  socket.emit("get-files", roomId);
});

// ▶️ Run / Preview
runBtn.addEventListener("click", async () => {
  if (!currentFile) return alert("Open a file first.");
  const entry = files[currentFile];
  if (!entry) return alert("File not found.");

  if (['html', 'css', 'javascript'].includes(entry.language)) {
    const html = files['index.html']?.code || (entry.language === 'html' ? entry.code : '<!-- no index.html -->');
    const css = files['style.css']?.code || '';
    const js = files['script.js']?.code || (entry.language === 'javascript' ? entry.code : '');
    const preview = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}<script>${js}<\/script></body></html>`;
    const win = window.open('', '_blank');
    win.document.open();
    win.document.write(preview);
    win.document.close();
    outputArea.value = 'Preview opened in a new tab.';
    return;
  }

  const code = editor.getValue();
  const language = entry.language || languageSelect.value;
  const stdin = inputArea.value || '';
  const versionIndex = versionSelect ? versionSelect.value : "4";

  try {
    const response = await fetch('/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language, versionIndex, stdin })
    });
    const result = await response.json();
    outputArea.value = result.output || result.error || 'No output.';
  } catch (err) {
    outputArea.value = 'Error executing code.';
    console.error(err);
  }
});

// 💬 Chat
sendBtn.addEventListener("click", () => {
  const msg = chatInput.value.trim();
  if (msg) {
    socket.emit("chat-message", { username, message: msg, roomId });
    chatInput.value = "";
  }
});

// 🔑 Press Enter to send chat
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendBtn.click();
  }
});

// 🧠 Socket Events
socket.on("chat-message", ({ username, message }) => {
  const msgDiv = document.createElement("div");
  msgDiv.innerHTML = `<strong>${escapeHtml(username)}:</strong> ${escapeHtml(message)}`;
  chatArea.appendChild(msgDiv);
  chatArea.scrollTop = chatArea.scrollHeight;
});

socket.on("joined", ({ clients }) => {
  updateClientList(clients);
  clients.forEach(c => activeUsers.add(c));
});

socket.on("disconnected", ({ clients }) => {
  updateClientList(clients);
  [...activeUsers].forEach(user => {
    if (!clients.includes(user)) {
      removeUserCursor(user);
      activeUsers.delete(user);
    }
  });
});

socket.on("file-list", ({ files: serverFiles }) => {
  files = serverFiles || {};
  renderFileTabs();
  if (!currentFile) {
    const first = Object.keys(files)[0];
    if (first) switchFile(first);
  } else if (files[currentFile] && editor) {
    const cached = models[currentFile];
    if (cached) cached.setValue(files[currentFile].code || '');
    else {
      const m = monaco.editor.createModel(
        files[currentFile].code || '',
        files[currentFile].language || detectLanguage(currentFile)
      );
      models[currentFile] = m;
      editor.setModel(m);
    }
  }
});

socket.on("file-exists", ({ filename }) => alert(`File "${filename}" already exists in this room.`));
socket.on("file-saved", ({ filename }) => alert(`Saved "${filename}" on server.`));

socket.on("code-change", ({ filename, code }) => {
  if (filename === currentFile && editor.getValue() !== code) {
    suppressNextChange = true;
    editor.setValue(code);
  }
  if (files[filename]) files[filename].code = code;
});

socket.on("room-full", ({ message }) => {
  alert(message || 'Room full');
  window.location.reload();
});

// 🧩 Helpers
function renderFileTabs() {
  fileTabs.innerHTML = '';
  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '6px';

  Object.keys(files).forEach(fname => {
    const btn = document.createElement('button');
    btn.className = 'file-tab-btn';
    btn.innerText = fname;
    btn.onclick = () => switchFile(fname);
    if (fname === currentFile) btn.classList.add('active-tab');
    list.appendChild(btn);
  });

  fileTabs.appendChild(list);
}

function switchFile(fname) {
  if (!files[fname]) return alert('File not found.');
  if (currentFile && models[currentFile]) files[currentFile].code = models[currentFile].getValue();
  currentFile = fname;
  const file = files[fname];
  if (!models[fname]) {
    const m = monaco.editor.createModel(
      file.code || '',
      mapToMonacoLang(file.language || detectLanguage(fname))
    );
    models[fname] = m;
  }
  editor.setModel(models[fname]);
  languageSelect.value = file.language || detectLanguage(fname);
  document.querySelectorAll('.file-tab-btn').forEach(b =>
    b.classList.toggle('active-tab', b.innerText === fname)
  );
  layoutEditorToContainer();
}

function detectLanguage(f) {
  const n = f.toLowerCase();
  if (n.endsWith('.html')) return 'html';
  if (n.endsWith('.css')) return 'css';
  if (n.endsWith('.js')) return 'javascript';
  if (n.endsWith('.py')) return 'python3';
  if (n.endsWith('.java')) return 'java';
  if (n.endsWith('.c') || n.endsWith('.cpp') || n.endsWith('.cc')) return 'cpp';
  return 'plaintext';
}

function mapToMonacoLang(lang) {
  if (!lang) return 'plaintext';
  if (lang === 'python3') return 'python';
  if (lang === 'cpp') return 'cpp';
  return lang;
}

function updateClientList(clients) {
  clientsList.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'leftBox';
  clients.forEach((client, i) => {
    const line = document.createElement('div');
    line.textContent = `USER ${i + 1} = ${client}`;
    box.appendChild(line);
  });
  clientsList.appendChild(box);
}

function escapeHtml(unsafe) {
  return unsafe
    ? unsafe.replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[c])
    : '';
}

function getRandomColor() {
  const colors = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// 🧹 Properly remove remote cursor of a user
function removeUserCursor(user) {
  if (!editor) return;
  const deco = decorations[user];
  if (deco && deco.length) {
    // Clear existing decorations for this user
    decorations[user] = editor.deltaDecorations(deco, []);
  }
  delete decorations[user];
  delete userColors[user];
}

/* 🧱 Chat panel toggle via activity bar */

let isChatOpen = false; // closed by default

function applyChatVisibility() {
  if (isChatOpen) {
    chatPanel.style.display = "flex";
    dividerRight.style.display = "block";
    chatToggleBtn?.classList.add("active");
  } else {
    chatPanel.style.display = "none";
    dividerRight.style.display = "none";
    chatToggleBtn?.classList.remove("active");

    // important: let flexbox reclaim the space
    editorPanel.style.width = "";
  }
  layoutEditorToContainer();
}

applyChatVisibility();

if (chatToggleBtn) {
  chatToggleBtn.addEventListener("click", () => {
    isChatOpen = !isChatOpen;
    applyChatVisibility();
  });
}

/* 🧭 Left panel mode: Explorer / Users */

let leftMode = "explorer"; // default: show files

function applyLeftPanelVisibility() {
  if (!leftPanel) return;

  if (leftMode === "explorer") {
    leftPanel.style.display = "flex";
    dividerLeft.style.display = "block";
    filesSection.style.display = "block";
    usersSection.style.display = "none";
    explorerBtn?.classList.add("active");
    usersBtn?.classList.remove("active");
  } else if (leftMode === "users") {
    leftPanel.style.display = "flex";
    dividerLeft.style.display = "block";
    filesSection.style.display = "none";
    usersSection.style.display = "block";
    usersBtn?.classList.add("active");
    explorerBtn?.classList.remove("active");
  } else {
    // leftMode = null → hide entire sidebar
    leftPanel.style.display = "none";
    dividerLeft.style.display = "none";
    filesSection.style.display = "none";
    usersSection.style.display = "none";
    explorerBtn?.classList.remove("active");
    usersBtn?.classList.remove("active");
  }

  layoutEditorToContainer();
}

// initial state: explorer visible, users hidden
applyLeftPanelVisibility();

if (explorerBtn) {
  explorerBtn.addEventListener("click", () => {
    leftMode = (leftMode === "explorer") ? null : "explorer";
    applyLeftPanelVisibility();
  });
}

if (usersBtn) {
  usersBtn.addEventListener("click", () => {
    leftMode = (leftMode === "users") ? null : "users";
    applyLeftPanelVisibility();
  });
}

/* ↔️ Draggable Dividers */

function makeResizable(divider, prev, next) {
  let dragging = false;
  divider.addEventListener('mousedown', e => {
    e.preventDefault();
    dragging = true;
    document.body.style.cursor = 'col-resize';
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
    document.body.style.cursor = 'default';
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const total = window.innerWidth;

    if (divider.id === 'dividerRight' && chatPanel.style.display === 'none') {
      return;
    }
    if (divider.id === 'dividerLeft' && leftPanel.style.display === 'none') {
      return;
    }

    if (divider.id === 'dividerLeft') {
      const leftPct = (e.clientX / total) * 100;
      if (leftPct > 8 && leftPct < 35) prev.style.width = leftPct + '%';
    } else if (divider.id === 'dividerRight') {
      const editorPct = ((e.clientX - prev.getBoundingClientRect().width) / total) * 100;
      if (editorPct > 30 && editorPct < 85) editorPanel.style.width = editorPct + '%';
    }
    layoutEditorToContainer();
  });
}

makeResizable(dividerLeft, leftPanel, editorPanel);
makeResizable(dividerRight, editorPanel, chatPanel);
