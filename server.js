// server.js — Simlish backend + ML-lite
// Runtime: Node 18+
// Start command en Render:  node server.js

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "4mb" }));

/* ===== CORS ===== */
const ALLOWED = new Set([
  "https://musikdlja.github.io",
  "http://localhost:5173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost"
]);
app.use((req, res, next) => {
  const org = req.headers.origin || "";
  if (ALLOWED.has(org)) {
    res.setHeader("Access-Control-Allow-Origin", org);
  } else {
    // permitir lectura básica desde otros orígenes (GET) sin credenciales
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* ===== Memoria en proceso (persistencia ligera en disco) ===== */
const DATA_FILE = path.join(__dirname, "store.json");
function readStore() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { user: { es2sim: {}, sim2es: {} }, history: [] };
  }
}
function writeStore(obj) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2)); } catch {}
}
let STORE = readStore();

/* ===== / (GET/POST) — sync de usuario + historial ===== */
// GET: devuelve { user, history }
app.get("/", (req, res) => {
  res.json({ ok: true, user: STORE.user || { es2sim: {}, sim2es: {} }, history: STORE.history || [] });
});
// POST: { user, history } -> merge + guarda
app.post("/", (req, res) => {
  const body = req.body || {};
  const incomingUser = body.user || {};
  const incomingHistory = Array.isArray(body.history) ? body.history : [];

  const u = STORE.user || (STORE.user = { es2sim: {}, sim2es: {} });
  // Merge “ganando” lo nuevo
  for (const [k, v] of Object.entries(incomingUser.es2sim || {})) u.es2sim[k] = v;
  for (const [k, v] of Object.entries(incomingUser.sim2es || {})) u.sim2es[k] = v;

  STORE.history = [...(STORE.history || []), ...incomingHistory].slice(-100);
  writeStore(STORE);
  res.json({ ok: true });
});

/* ===== Opcional: carga de datos para ML ===== */
let TRAIN = { pairs: [] };
try {
  const tfile = path.join(__dirname, "training-data.json");
  if (fs.existsSync(tfile)) {
    TRAIN = JSON.parse(fs.readFileSync(tfile, "utf8"));
  }
} catch { TRAIN = { pairs: [] }; }

/* ===== Utilidades de “simlish-lite” ===== */
const deacc = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const normEs = s => deacc(String(s||"").toLowerCase()).trim();
const normSim = s => String(s||"").toLowerCase().trim();

// Construimos mapa rápido con store + training
function buildMaps() {
  const ES2 = new Map();
  const SIM2 = new Map();
  for (const [k,v] of Object.entries(STORE.user?.es2sim || {})) ES2.set(k, v);
  for (const [k,v] of Object.entries(STORE.user?.sim2es || {})) SIM2.set(k, v);
  for (const p of TRAIN.pairs || []) {
    if (p.es && p.sim) {
      ES2.set(normEs(p.es), p.sim);
      SIM2.set(normSim(p.sim), p.es);
    }
  }
  return { ES2, SIM2 };
}

// generador tonto de simlish (para no dejar en blanco)
const SYLL = ["su","la","noo","boo","zim","zam","sha","bah","voh","plar","gib","yib","flo","fru","doo","ka","ru","shi","ku","va","na","mo","ta","re","lo"];
function synth(word){
  const w = normEs(word).replace(/[^a-z0-9\s]/g,"");
  if(!w) return word;
  let n = Math.max(2, Math.min(4, Math.ceil(w.length/4)));
  let out = [];
  for (let i=0;i<n;i++) out.push(SYLL[Math.floor(Math.random()*SYLL.length)]);
  let res = out.join("");
  if(/r$/.test(w)) res+="ru";
  if(/n$/.test(w)) res+="nu";
  return res;
}

/* ===== Config ML ===== */
let ML_CFG = { temp: 0.8, top_k: 180, top_p: 0.92 };
let TRAVIESO_KEY = null;
function newTraviesoKey(){
  const seeds = ["zabba","fruuvy","plumba","shishi","whazzu","dag dag","sul sul","su laa","vrashoo"];
  const pick = seeds[Math.floor(Math.random()*seeds.length)];
  TRAVIESO_KEY = `${pick} ${Math.floor(100+Math.random()*900)}`;
}

/* ===== Endpoints ML ===== */
app.get("/mml/ping", (req,res)=> res.json({ ok:true, mode:"lite" }));

app.post("/mml/config", (req,res)=>{
  const { temp, top_k, top_p } = req.body || {};
  if (typeof temp === "number") ML_CFG.temp = temp;
  if (typeof top_k === "number") ML_CFG.top_k = top_k;
  if (typeof top_p === "number") ML_CFG.top_p = top_p;
  res.json({ ok:true, cfg: ML_CFG });
});

app.post("/mml/chat", (req,res)=>{
  const { ES2, SIM2 } = buildMaps();
  const persona = (req.body?.persona||"tierno");
  const textRaw = String(req.body?.text||"").trim();
  const needs = req.body?.needs || {};

  if (!textRaw) return res.json({ simlish:"...", spanish:"..." });

  // traducción palabra a palabra como base de “respuesta”
  const toks = textRaw.split(/\s+/);
  const toSim = toks.map(t=>{
    const k = normEs(t);
    return ES2.get(k) || synth(t);
  }).join(" ");

  // un par de adornos según personalidad
  let prefix = persona==="travieso" ? "Hehe, " : "Su sul, ";
  if (persona==="tierno") prefix = "Su sul, ";
  if (persona==="sabio") prefix = "Shobru, ";
  if (persona==="payasin") prefix = "Hihi, ";

  let simlish = `${prefix}${toSim}.`;
  let spanish = (persona==="travieso")
    ? "Jeje, aquí tienes en simlish."
    : "Hola, te respondo en simlish.";

  // toque por necesidades (muy básico)
  if ((needs?.hambre||0) < 35) { simlish += " Meeba nomma soonru."; spanish += " Tengo hambre."; }
  if ((needs?.energia||0) < 30) { simlish += " Meeba to-sleepu."; spanish += " Estoy cansado."; }

  res.json({ simlish, spanish, cfg: ML_CFG });
});

app.post("/mml/travieso-pass", (req,res)=>{
  newTraviesoKey();
  res.json({ ok:true, key: TRAVIESO_KEY });
});
app.post("/mml/travieso-check", (req,res)=>{
  const key = String(req.body?.key||"");
  if (key && TRAVIESO_KEY && key.trim()===TRAVIESO_KEY) return res.json({ ok:true });
  res.status(401).json({ ok:false });
});

app.post("/mml/generate", (req,res)=>{
  // frase amable que recuerde respaldo
  const sim = "Vrashoo ta backup JSON, klavrus!";
  const es  = "¡Ojalá hagas un respaldo del JSON, queridos!";
  res.json({ simlish: sim, spanish: es });
});
app.post("/mml/negativa", (req,res)=>{
  const words = ["nah-zabba","nuvva-plar","boo-nu","zam-nah","plar-nuvva"];
  res.json({ word: words[Math.floor(Math.random()*words.length)] });
});

/* ===== Arranque ===== */
const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> {
  console.log("Simlish backend up on", PORT);
});
