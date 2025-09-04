// server.js — Backend Simuch: /, /health, /visit, /api/state (GET/POST)
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");
const CORE_FILE = process.env.CORE_FILE || path.join(__dirname, "core.json");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

function load(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function save(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); }
  catch {}
}

// Estado en memoria
let core = load(CORE_FILE, { core: { ES2SIM: {}, SIM2ES: {} } });
let state = load(DATA_FILE, {
  userDict: { ES2SIM: {}, SIM2ES: {} },
  history: [],
  counts: { learned: 0, total: 0, visits: 0, lastUpdate: null }
});

function recalcCounts(){
  const learned = Object.keys(state.userDict.ES2SIM||{}).length
                + Object.keys(state.userDict.SIM2ES||{}).length;
  const totalCore = (core && core.core)
    ? Object.keys(core.core.ES2SIM||{}).length + Object.keys(core.core.SIM2ES||{}).length
    : 0;
  state.counts.learned = learned;
  state.counts.total = learned + totalCore;
  state.counts.lastUpdate = new Date().toISOString();
}

app.get("/", (_req, res) => {
  // Para el chip Host: OK en el front
  res.json({ ok: true, service: "simuch-backend", ts: new Date().toISOString() });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.get("/visit", (_req, res) => {
  state.counts = state.counts || {};
  state.counts.visits = (state.counts.visits || 0) + 1;
  save(DATA_FILE, state);
  res.json({ ok: true, visits: state.counts.visits });
});

app.get("/api/state", (_req, res) => {
  res.json({ ok: true, userDict: state.userDict, history: state.history, counts: state.counts });
});

app.post("/api/state", (req, res) => {
  const body = req.body || {};
  state.userDict = state.userDict || { ES2SIM: {}, SIM2ES: {} };
  state.history = Array.isArray(state.history) ? state.history : [];

  // Merge (sumar sin borrar)
  if (body && body.userDict) {
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
  console.log(`Simuch backend listo en :${PORT}`);
});
