// server.js — Simlish backend (Render)
// Node.js + Express, con CORS robusto y estado en memoria.

const express = require("express");
const app = express();

app.set("trust proxy", true);

// ---------- CORS ROBUSTO ----------
app.use((req, res, next) => {
  // Permite cualquier origen (si quieres, cámbialo por tu dominio frontend)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // Evitar caching para que siempre veas el último estado
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

  if (req.method === "OPTIONS") {
    // Responder rápido a preflight
    return res.sendStatus(204);
  }
  next();
});

// ---------- BODY PARSER ----------
app.use(express.json({ limit: "2mb" }));

// ---------- ESTADO EN MEMORIA ----------
let snapshot = {
  core_version: "3.1",
  t: new Date().toISOString(),
  user: { es2sim: {}, sim2es: {} },
  history: []
};

// ---------- ENDPOINTS ----------

// GET raíz: devuelve el estado actual
app.get("/", (req, res) => {
  res.json(snapshot);
});

// POST raíz: reemplaza el estado (validando estructura básica)
app.post("/", (req, res) => {
  const body = req.body || {};
  if (!body.user || typeof body.user !== "object") {
    return res.status(400).json({ ok: false, error: "Payload inválido: falta 'user'." });
  }
  snapshot = {
    core_version: String(body.core_version || snapshot.core_version),
    t: body.t || new Date().toISOString(),
    user: {
      es2sim: body.user.es2sim || {},
      sim2es: body.user.sim2es || {}
    },
    history: Array.isArray(body.history) ? body.history.slice(-100) : snapshot.history
  };
  res.json({ ok: true });
});

// Healthcheck simple
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// ---------- SERVIDOR ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Simlish backend escuchando en puerto", PORT);
});
