// server.js — Simlish Translator Backend (Render)
// Modo: Node + Express
// Funciona con tu frontend actual (GET/POST / para user/history) + ML Chat en /ml-chat

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

// ======== Config básica ========
const app = express();
const PORT = process.env.PORT || 3000;

// Dominios permitidos para CORS (puedes agregar más si los usas)
const ALLOWED = [
  "https://musikdlja.github.io",
  "https://musikdlja.github.io/simlish-translator-frontend",
  "https://simlishtranslator.neocities.org",
  "https://simlish-translator.neocities.org",
  "https://simlishtranslator.neocities.org/",
  "https://simlish-translator-frontend.onrender.com", // por si hosteas front en Render
  "http://localhost:5500",
  "http://localhost:5173",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ALLOWED.some((d) => origin.startsWith(d))) return cb(null, true);
      // Permite todo para simplificar (Render free a veces reescribe origins)
      return cb(null, true);
    },
    methods: ["GET", "POST", "OPTIONS", "HEAD"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);
app.options("*", cors());
app.use(express.json({ limit: "2mb" }));

// ======== Rutas de archivos (persistencia sencilla en disco) ========
const STORE_FILE = path.join(__dirname, "store.json"); // user + history (lo que guarda tu front)
const TRAIN_FILE = path.join(__dirname, "training-data.json"); // 5.4k pares (core + usuario)

function safeReadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.error(`ERROR leyendo ${file}:`, e?.message);
    return fallback;
  }
}
function safeWriteJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error(`ERROR escribiendo ${file}:`, e?.message);
    return false;
  }
}

// ======== Estado en memoria ========
let STORE = safeReadJSON(STORE_FILE, { user: { es2sim: {}, sim2es: {} }, history: [] });
let TRAIN = safeReadJSON(TRAIN_FILE, {}); // esperado: { "simlish": "español / variantes", ... }

// Índices para ML Chat (se reconstruyen cuando se recarga el TRAIN)
let SIM2ES = new Map();
let ES2SIM = new Map();
let MULTI_SIM_KEYS = []; // frases simlish con espacios

function normEs(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
function normSim(s) {
  return String(s || "").toLowerCase().trim();
}
function rebuildIndices() {
  SIM2ES = new Map();
  ES2SIM = new Map();
  MULTI_SIM_KEYS = [];

  // TRAIN: sim -> es(/variantes)
  Object.entries(TRAIN || {}).forEach(([sim, es]) => {
    const kSim = normSim(sim);
    if (!SIM2ES.has(kSim)) SIM2ES.set(kSim, String(es));
    if (sim.includes(" ")) MULTI_SIM_KEYS.push(sim.toLowerCase());

    // invertimos las variantes ES para ES2SIM
    String(es)
      .split("/")
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((esVar) => {
        const kEs = normEs(esVar);
        if (!ES2SIM.has(kEs)) ES2SIM.set(kEs, sim);
      });
  });

  // Mezclamos también el user store para que el chat conozca lo aprendido
  Object.entries(STORE?.user?.sim2es || {}).forEach(([sim, es]) => {
    const kSim = normSim(sim);
    if (!SIM2ES.has(kSim)) SIM2ES.set(kSim, String(es));
    if (sim.includes(" ")) MULTI_SIM_KEYS.push(sim.toLowerCase());
  });
  Object.entries(STORE?.user?.es2sim || {}).forEach(([es, sim]) => {
    const kEs = normEs(es);
    if (!ES2SIM.has(kEs)) ES2SIM.set(kEs, String(sim));
  });

  // ordenar multi-palabras por largo (desc) para capturar primero las más largas
  MULTI_SIM_KEYS = Array.from(new Set(MULTI_SIM_KEYS)).sort((a, b) => b.length - a.length);

  console.log(
    `[ML] Índices reconstruidos. SIM2ES=${SIM2ES.size} · ES2SIM=${ES2SIM.size} · multi=${MULTI_SIM_KEYS.length}`
  );
}
rebuildIndices();

// ======== Utilidades de tokenización sencilla ========
function tokensOf(text) {
  return text.match(/[\wáéíóúñü]+|[.,;:!?]/gi) || [text];
}

// Detectar + “comprimir” multi-palabras simlish: "su laa" -> "su_laa" para que sea 1 token
function compressMultiSim(text) {
  let out = text;
  for (const key of MULTI_SIM_KEYS) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "gi");
    out = out.replace(re, (m) => m.replace(/\s+/g, "_"));
  }
  return out;
}
function expandMultiSimToken(tok) {
  return tok.replace(/_/g, " ");
}

// Traducciones básicas para el ML Chat (no tocan tu traductor del front)
function sim2esLine(s) {
  const pre = compressMultiSim(String(s || ""));
  const toks = tokensOf(pre);
  const out = toks.map((t) => {
    if (/^[.,;:!?]$/.test(t)) return t;
    const key = normSim(expandMultiSimToken(t));
    // Intento directo
    let es = SIM2ES.get(key);
    if (!es) {
      // Quitar prefijos/sufijos temporales
      const base = key.replace(/^(dra-|to-)/, "").replace(/(-nu|-ru)$/, "");
      es = SIM2ES.get(base);
    }
    return es ? String(es).split("/")[0] : expandMultiSimToken(t);
  });
  return out.join(" ").replace(/\s+([.,;:!?])/g, "$1");
}
function es2simLine(s) {
  const toks = tokensOf(String(s || ""));
  const out = toks.map((t) => {
    if (/^[.,;:!?]$/.test(t)) return t;
    const key = normEs(t);
    const sim = ES2SIM.get(key);
    return sim || t;
  });
  return out.join(" ").replace(/\s+([.,;:!?])/g, "$1");
}

// ======== Health ========
app.head("/", (_req, res) => res.status(200).end());
app.get("/ping", (_req, res) => res.json({ ok: true, t: new Date().toISOString() }));

// ======== Compatibilidad con tu frontend (user/history) ========
// GET /  -> devuelve store (lo usas al cargar)
// POST / -> guarda user/history (lo usas al aprender)
app.get("/", (_req, res) => {
  res.json({
    core_version: "3.1",
    t: new Date().toISOString(),
    user: STORE.user || { es2sim: {}, sim2es: {} },
    history: Array.isArray(STORE.history) ? STORE.history.slice(-10) : [],
  });
});

app.post("/", (req, res) => {
  const { user, history } = req.body || {};
  if (!user || typeof user !== "object") {
    return res.status(400).json({ ok: false, error: "Falta user" });
  }
  // Merge suave (no clobber total)
  STORE.user = {
    es2sim: { ...(STORE.user?.es2sim || {}), ...(user.es2sim || {}) },
    sim2es: { ...(STORE.user?.sim2es || {}), ...(user.sim2es || {}) },
  };
  if (Array.isArray(history)) {
    const prev = Array.isArray(STORE.history) ? STORE.history : [];
    STORE.history = [...prev, ...history].slice(-100); // guarda 100 para no crecer infinito
  }
  const ok = safeWriteJSON(STORE_FILE, STORE);
  if (ok) rebuildIndices(); // para que el chat aprenda de inmediato
  res.json({ ok });
});

// Descargar backup user/history
app.get("/export", (_req, res) => {
  const data = {
    t: new Date().toISOString(),
    user: STORE.user || { es2sim: {}, sim2es: {} },
    history: Array.isArray(STORE.history) ? STORE.history : [],
  };
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="simlish-user-backup.json"`);
  res.send(JSON.stringify(data, null, 2));
});

// Recargar training-data.json sin redeploy
app.post("/reload", (_req, res) => {
  TRAIN = safeReadJSON(TRAIN_FILE, TRAIN || {});
  rebuildIndices();
  res.json({ ok: true, train_entries: Object.keys(TRAIN || {}).length });
});

// ======== ML Chat ========
// Body esperado: { msg: string, lang?: 'ES'|'SIM', persona?: 'clasico'|'tierno'|'sabio'|'payasin'|'travieso' }
app.post("/ml-chat", (req, res) => {
  const { msg, lang = "ES", persona = "clasico" } = req.body || {};
  if (!msg) return res.json({ reply_es: "(sin mensaje)", reply_sim: "(sin mensaje)" });

  // 1) Normalizamos y traducimos base
  let reply_es = "";
  let reply_sim = "";

  if (String(lang).toUpperCase() === "SIM") {
    // Usuario habló en Simlish → devolvemos interpretación en ES + eco mejorado a SIM
    reply_es = sim2esLine(msg);
    // si no hay traducción conocida, fabricamos una respuesta amable
    reply_sim = reply_es === msg ? "Yibu! Meeba gluppa tivra brasha." : es2simLine(reply_es);
  } else {
    // Usuario habló en Español → devolvemos versión en SIM + espejo en ES
    reply_sim = es2simLine(msg);
    reply_es = reply_sim === msg ? "Entiendo, ¿puedes decirlo de otra forma?" : sim2esLine(reply_sim);
  }

  // 2) Estilo de personalidad simple (tono)
  const tones = {
    clasico: { es: ["¡Yibu!", ""], sim: ["Yibu!", ""] },
    tierno: { es: ["(sonríe) ", " 💚"], sim: ["(firbs) ", " 💚"] },
    sabio: { es: ["Hmm… ", ""], sim: ["Hmm… ", ""] },
    payasin: { es: ["jaja ", ""], sim: ["shishi ", ""] },
    travieso: { es: ["(guiño) ", ""], sim: ["(kiju) ", ""] },
  };
  const tone = tones[persona] || tones["clasico"];

  reply_es = `${tone.es[0]}${reply_es}${tone.es[1]}`.trim();
  reply_sim = `${tone.sim[0]}${reply_sim}${tone.sim[1]}`.trim();

  // 3) Respuesta
  res.json({
    ok: true,
    persona,
    reply_es,
    reply_sim,
  });
});

// ======== Arranque ========
app.listen(PORT, () => {
  console.log(`Simlish backend listo en puerto ${PORT}`);
  console.log(`Entradas de TRAIN: ${Object.keys(TRAIN || {}).length}`);
});
