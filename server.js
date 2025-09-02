// server.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");

// CORS: ajusta el origin si quieres restringirlo
const app = express();
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: "1mb" }));

// Estado en memoria
let state = {
  core_version: "3.1",
  user: { es2sim: {}, sim2es: {} },
  history: []
};

// Cargar desde archivo si existe
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (raw && raw.user) state = raw;
  }
} catch (e) {
  console.error("No se pudo leer data.json:", e.message);
}

// Helpers de guardado
function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (e) {
    console.error("No se pudo guardar data.json:", e.message);
  }
}

// GET: devuelve estado completo
app.get("/", (req, res) => {
  res.json({
    core_version: state.core_version,
    user: state.user,
    history: state.history
  });
});

// POST: recibe payload del cliente y guarda (merge simple o replace si viene flag flush)
app.post("/", (req, res) => {
  const body = req.body || {};
  const flush = !!body.flush;

  // Opcionalmente podrías validar core_version si quieres
  // if (body.core_version && body.core_version !== state.core_version) { ... }

  if (!body.user || typeof body.user !== "object") {
    return res.status(400).json({ error: "Payload inválido: falta user{es2sim,sim2es}" });
  }

  if (flush) {
    // Reemplazo completo
    state.user = {
      es2sim: body.user.es2sim || {},
      sim2es: body.user.sim2es || {}
    };
    state.history = Array.isArray(body.history) ? body.history.slice(-10) : state.history;
  } else {
    // Merge conservador
    state.user.es2sim = Object.assign({}, state.user.es2sim, body.user.es2sim || {});
    state.user.sim2es = Object.assign({}, state.user.sim2es, body.user.sim2es || {});
    if (Array.isArray(body.history)) {
      state.history = body.history.slice(-10);
    }
  }

  save();
  res.json({ ok: true });
});

// Healthcheck
app.get("/health", (req, res) => res.json({ ok: true }));

// === Visits endpoint: fetch count from hits.sh and return JSON ===
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
app.get("/visits", async (req, res) => {
  try {
    const desk = "https://hits.sh/https://musidklja.github.io/simuch-translator.svg";
    const mob  = "https://hits.sh/musidklja.github.io/simuch-translator.svg";
    async function read(url){
      const r = await fetch(url);
      if(!r.ok) throw new Error("bad");
      const svg = await r.text();
      const matches = [...svg.matchAll(/<text[^>]*>([^<]+)<\/text>/gi)].map(m=>m[1].trim()).reverse();
      const raw = matches.find(t => /^\d[\d,\.]*$/.test(t)) || "0";
      const n = parseInt(raw.replace(/[^\d]/g,""), 10) || 0;
      return n;
    }
    let count = 0;
    try { count = await read(desk); } catch { count = await read(mob); }
    res.set("Access-Control-Allow-Origin", "*");
    res.json({ count });
  } catch (e) {
    res.set("Access-Control-Allow-Origin", "*");
    res.json({ count: 0 });
  }
});

app.listen(PORT, () => {
  console.log(`Simlish backend listo en :${PORT}`);
});
