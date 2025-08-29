import express from "express";
const app = express();
app.use(express.json({ limit: "2mb" }));

// CORS robusto
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Estado en memoria
let snapshot = {
  core_version: "3.1",
  t: new Date().toISOString(),
  user: { es2sim: {}, sim2es: {} },
  history: []
};

app.get("/", (_req, res) => res.json(snapshot));

app.post("/", (req, res) => {
  if (req.body && req.body.user) {
    snapshot = { ...req.body, t: req.body.t || new Date().toISOString() };
    return res.sendStatus(200);
  }
  res.status(400).json({ error: "Payload inválido (falta user)" });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Simlish backend listo en puerto " + port));
