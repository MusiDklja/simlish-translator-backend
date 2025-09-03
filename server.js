// server.js (Render FIX) — responde a "/", "/health", "/api/core", "/api/state"
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");
const CORE_FILE = process.env.CORE_FILE || path.join(__dirname, "core.json");

const app = express();

// CORS: abre para cualquier origen (ajusta si quieres restringir)
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

// Helpers de disco
function load(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function save(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}

// Estado persistente
let state = load(DATA_FILE, {
  userDict: { ES2SIM: {}, SIM2ES: {} },
  history: [],
  counts: { learned: 0, total: 0, lastUpdate: null }
});

function recalcCounts() {
  const learned = Object.keys(state.userDict?.ES2SIM || {}).length;
  const learned2 = Object.keys(state.userDict?.SIM2ES || {}).length;
  state.counts.learned = Math.max(learned, learned2);

  const core = load(CORE_FILE, { core: { ES2SIM: {}, SIM2ES: {} } });
  const coreSize = Object.keys(core.core?.ES2SIM || {}).length;
  state.counts.total = coreSize + state.counts.learned;
  state.counts.lastUpdate = new Date().toISOString();
}

// Raíz — para que Render no muestre "Cannot GET /"
app.get("/", (_, res) => {
  res.type("text/plain").send("OK");
});

// Health
app.get("/health", (_, res) => res.json({ ok: true }));

// Core (opcional para el front)
app.get("/api/core", (_, res) => {
  const core = load(CORE_FILE, { core: { ES2SIM: {}, SIM2ES: {} } });
  res.json(core);
});

// State (GET)
app.get("/api/state", (_, res) => {
  recalcCounts();
  res.json(state);
});

// State (POST merge)
app.post("/api/state", (req, res) => {
  const body = req.body || {};
  if (body.userDict && typeof body.userDict === "object") {
    state.userDict.ES2SIM = { ...(state.userDict.ES2SIM||{}), ...(body.userDict.ES2SIM||{}) };
    state.userDict.SIM2ES = { ...(state.userDict.SIM2ES||{}), ...(body.userDict.SIM2ES||{}) };
  }
  if (Array.isArray(body.history)) {
    state.history = [...state.history, ...body.history].slice(-50);
  }
  recalcCounts();
  save(DATA_FILE, state);
  res.json({ ok: true, counts: state.counts });
});

app.listen(PORT, () => {
  console.log(`Simlish backend (Render FIX) escuchando en :${PORT}`);
});
