// Backend mínimo con CORS correcto para Render
const express = require("express");
const app = express();

// CORS robusto para GET/POST/OPTIONS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");           // o pon tu dominio exacto si quieres restringir
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // evita caches raras
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.sendStatus(204);    // preflight ok
  next();
});

app.use(express.json({ limit: "1mb" }));

// Estado en memoria (simple)
let state = {
  core_version: "3.1",
  t: new Date().toISOString(),
  user: { es2sim: {}, sim2es: {} },
  history: []
};

// GET raíz → devuelve snapshot
app.get("/", (req, res) => {
  res.json(state);
});

// POST raíz → guarda snapshot
app.post("/", (req, res) => {
  if (!req.body || !req.body.user) {
    return res.status(400).json({ ok: false, error: "payload inválido" });
  }
  state = {
    core_version: String(req.body.core_version || "3.1"),
    t: req.body.t || new Date().toISOString(),
    user: req.body.user || { es2sim: {}, sim2es: {} },
    history: Array.isArray(req.body.history) ? req.body.history.slice(-10) : []
  };
  res.json({ ok: true, t: state.t });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Simlish backend escuchando en", PORT));
