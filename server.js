// server.js
const express = require("express");
const cors = require("cors");

const app = express();
app.disable("x-powered-by");

// CORS — permite cualquier origen (si quieres, luego restringimos)
app.use(cors({
  origin: true,              // refleja el Origin que venga
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400              // cachea el preflight 24h
}));

// Necesario para que Express responda a OPTIONS en todas las rutas
app.options("*", cors());

// Body JSON
app.use(express.json({ limit: "2mb" }));

// Estado en memoria (simple)
let state = {
  core_version: "3.1",
  t: new Date().toISOString(),
  user: { es2sim: {}, sim2es: {} },
  history: []
};

// Salud
app.get("/health", (req, res) => res.status(200).json({ ok: true }));

// GET raíz → lee
app.get("/", (req, res) => {
  res.status(200).json(state);
});

// POST raíz → guarda
app.post("/", (req, res) => {
  if (!req.body || !req.body.user) {
    return res.status(400).json({ error: "Payload inválido; falta campo 'user'." });
  }
  state = {
    core_version: String(req.body.core_version || "3.1"),
    t: new Date().toISOString(),
    user: req.body.user || { es2sim: {}, sim2es: {} },
    history: Array.isArray(req.body.history) ? req.body.history.slice(-10) : []
  };
  return res.status(200).json({ ok: true, t: state.t });
});

// Arranque
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Simlish backend on port", port));
