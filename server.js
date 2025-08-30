// server.js — Backend único con ML “real” (tablas + LM n-gram) + JSON global + admin
// Ejecuta: npm start  (Render Start command -> "npm start")

import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const app = express();
app.use(express.json());
const __dirname = path.resolve();

// ========================= Persistencia de datos globales =========================
const DATA_FILE = "./simlish-data.json";
let STORE = {
  user: { es2sim: {}, sim2es: {} },
  history: [],
  settings: { traviesoPhrase: "" }
};
if (fs.existsSync(DATA_FILE)) {
  try { STORE = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")); } catch {}
}
function saveStore(){ fs.writeFileSync(DATA_FILE, JSON.stringify(STORE, null, 2)); }

// ========================= Seguridad admin =========================
const ADMIN_PASS = process.env.ADMIN_PASS || "";
const activeAdminTokens = new Set();
function makeToken(){ return crypto.randomBytes(24).toString("hex"); }
function requireAdmin(req,res,next){
  const t=req.header("x-auth-token");
  if(!t || !activeAdminTokens.has(t)) return res.status(401).json({ok:false,error:"no-auth"});
  next();
}
app.post("/auth",(req,res)=>{
  const { pass="" } = req.body || {};
  if(!ADMIN_PASS) return res.status(500).json({ok:false,error:"ADMIN_PASS missing"});
  if(String(pass)===String(ADMIN_PASS)){
    const token=makeToken(); activeAdminTokens.add(token);
    setTimeout(()=>activeAdminTokens.delete(token), 60*60*1000);
    return res.json({ok:true,token});
  }
  res.status(403).json({ok:false,error:"bad-pass"});
});

// ========================= API JSON (igual que antes) =========================
app.get("/",(req,res)=>res.json({
  ok:true, version:"3.1",
  sizeES:Object.keys(STORE.user.es2sim||{}).length,
  sizeSIM:Object.keys(STORE.user.sim2es||{}).length,
  history:(STORE.history||[]).length
}));

app.get("/data",(req,res)=>res.json(STORE));

app.post("/data",(req,res)=>{
  const b=req.body||{};
  if(!b.user||!b.user.es2sim||!b.user.sim2es) return res.status(400).json({ok:false,error:"payload inválido"});
  STORE.user=b.user;
  STORE.history=Array.isArray(b.history)? b.history.slice(-10) : [];
  saveStore();
  res.json({ok:true});
});

app.get("/backup/download",(req,res)=>{
  const fname = `simlish-backup-${new Date().toISOString().slice(0,10)}.json`;
  res.setHeader("Content-Type","application/json");
  res.setHeader("Content-Disposition",`attachment; filename="${fname}"`);
  res.end(JSON.stringify(STORE,null,2));
});

// ========================= Frase “Travieso” =========================
function rand(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function randomSimSyl(){
  const SYL=["su","la","noo","boo","zim","zam","sha","bah","voh","plar","gib","yib","flo","fru","doo","ka","ru","shi","ku","va","na","mo","ta","re","lo"];
  return rand(SYL);
}
function generateTraviesoPhrase(){
  const len = 3 + Math.floor(Math.random()*3);
  let out=[]; for(let i=0;i<len;i++) out.push(randomSimSyl());
  return out.join(" ")+" 😉";
}
app.post("/admin/travieso/new-pass", requireAdmin, (req,res)=>{
  STORE.settings.traviesoPhrase = generateTraviesoPhrase();
  saveStore();
  res.json({ok:true, phrase: STORE.settings.traviesoPhrase});
});
app.post("/chat/verify",(req,res)=>{
  const { phrase="" } = req.body||{};
  const ok = phrase.trim() && STORE.settings.traviesoPhrase && (phrase.trim()===STORE.settings.traviesoPhrase);
  res.json({ ok: !!ok });
});

// =============================================================================
// =========================  M O D E L O   R E A L  ===========================
// =============================================================================
// Entrenamiento desde archivo:
//  - Si existe ./training-data.json -> lo usa (RECOMENDADO).
//  - Si no, usa STORE.user (lo ya guardado).
//
// Admite dos formatos de training-data.json:
//  (A) { "user": { "es2sim": {...}, "sim2es": {...} }, "history": [...] }
//  (B) { "es2sim": {...}, "sim2es": {...} }
//
// Construye:
//  • Tabla ES→SIM y SIM→ES (frecuencia/normalización).
//  • N-grama de caracteres (n=3) para lenguaje Simlish.
//  • Manejador de “multi-palabras” (p.ej. "su laa").
//  • Decodificador ES→SIM y SIM→ES con fallback generativo y fuzzy-match.

const TRAIN_FILE = "./training-data.json";

function deacc(s){ return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,""); }
function normEs(s){ return deacc(String(s||"").toLowerCase()).trim(); }
function normSim(s){ return String(s||"").toLowerCase().trim(); }
function tokenizeES(text){ return (text.match(/[\wáéíóúñü]+|[.,;:!?]/gi)||[]); }
function tokenizeSIM(text){ return (text.match(/[\w_]+|[.,;:!?]/gi)||[]); }

const SynthSyl=["su","la","noo","boo","zim","zam","sha","bah","voh","plar","gib","yib","flo","fru","doo","ka","ru","shi","ku","va","na","mo","ta","re","lo"];
function xorshift32(seed){ let x=seed|0; return ()=> (x^=x<<13,x^=x>>>17,x^=x<<5,(x>>>0)/4294967296); }
function hashStr(s){ let h=2166136261>>>0; for(const c of s) h=Math.imul(h ^ c.charCodeAt(0),16777619); return h>>>0; }
function synthFromWord(word){
  const w=normEs(word).replace(/[^a-z0-9\s]/g,""); if(!w) return word;
  const rnd=xorshift32(hashStr(w));
  let n=Math.max(2,Math.min(4,Math.ceil(w.length/4)));
  let out=[]; for(let i=0;i<n;i++) out.push(SynthSyl[Math.floor(rnd()*SynthSyl.length)]);
  let res=out.join("");
  if(/r$/.test(w)) res+="ru"; if(/n$/.test(w)) res+="nu";
  return res;
}

class SimlishModel {
  constructor(){
    this.es2sim = new Map();         // key: normEs    -> sim (string)
    this.sim2es = new Map();         // key: normSim   -> es (string)
    this.multiSim = new Set();       // multi-palabras sim ("su laa")
    this.charLM = {};                // n-grama (n=3): {"pl":"{a:count,...}"}
    this.ngramN = 3;
  }
  loadTraining(){
    let E2S={}, S2E={};
    if(fs.existsSync(TRAIN_FILE)){
      try{
        const raw = JSON.parse(fs.readFileSync(TRAIN_FILE,"utf-8"));
        if(raw.user && raw.user.es2sim && raw.user.sim2es){ E2S=raw.user.es2sim; S2E=raw.user.sim2es; }
        else if(raw.es2sim && raw.sim2es){ E2S=raw.es2sim; S2E=raw.sim2es; }
      }catch{}
    }else{
      // usa lo que ya tengas guardado globalmente
      E2S = STORE.user?.es2sim || {};
      S2E = STORE.user?.sim2es || {};
    }
    // Construye tablas
    this.es2sim = new Map(Object.entries(E2S||{}));   // ya vienen normalizados en nuestro flujo
    this.sim2es = new Map(Object.entries(S2E||{}));
    // Multi-palabras SIM
    for(const sim of this.sim2es.keys()){ if(sim.includes(" ")) this.multiSim.add(sim.toLowerCase()); }
    // LM de caracteres sobre SIM (a partir de todas las claves SIM)
    this.trainCharLM([...this.sim2es.keys()]);
    // Si no hay nada aún, evita caída
    if(this.es2sim.size===0 && this.sim2es.size===0){
      // mínimo de arranque
      this.es2sim.set("hola","sul sul");
      this.sim2es.set("sul sul","hola");
    }
  }
  trainCharLM(simWords){
    const N=this.ngramN;
    const counts = {};
    function add(prefix, ch){
      if(!counts[prefix]) counts[prefix]={};
      counts[prefix][ch]=(counts[prefix][ch]||0)+1;
    }
    for(const w of simWords){
      const word = `^${w}$`;
      for(let i=0;i<word.length;i++){
        const pref = word.slice(Math.max(0, i-N), i);
        const ch = word[i];
        add(pref, ch);
      }
    }
    this.charLM = counts;
  }
  sampleNext(prefix, temperature=0.7, topk=8){
    const table=this.charLM[prefix] || this.charLM[""] || {};
    let entries=Object.entries(table);
    if(entries.length===0) entries=[["a",1],["u",1],["o",1]];
    // softmax con temp
    let probs=entries.map(([ch,c])=>[ch, Math.pow(c, 1/Math.max(0.01,temperature))]);
    // top-k
    probs.sort((a,b)=>b[1]-a[1]); probs=probs.slice(0, Math.max(1,topk));
    const sum=probs.reduce((s,[_c,p])=>s+p,0);
    let r=Math.random()*sum;
    for(const [ch,p] of probs){ r-=p; if(r<=0) return ch; }
    return probs[probs.length-1][0];
  }
  generateSimlish(seed="", maxLen=10, temperature=0.7, topk=8){
    const N=this.ngramN;
    let w="^"; let count=0;
    while(count<maxLen+2){
      const pref = w.slice(-N);
      const ch=this.sampleNext(pref, temperature, topk);
      w+=ch; count++;
      if(ch==="$") break;
    }
    let out=w.replace(/[\^\$]/g,"").trim();
    if(!out) out=synthFromWord(seed||"x");
    return out;
  }
  compressMultiSim(text){
    let out=text;
    const keys=[...this.multiSim].sort((a,b)=>b.length-a.length);
    for(const key of keys){
      const re=new RegExp("\\b"+key.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b","gi");
      out=out.replace(re, m=>m.replace(/\s+/g,"_"));
    }
    return out;
  }
  expandMultiSimToken(t){ return t.replace(/_/g," "); }
  translateES2SIM(text,{temperature=0.6,topk=8}={}){
    const toks=tokenizeES(text);
    const out=[];
    for(const t of toks){
      if(/^[.,;:!?]$/.test(t)){ out.push(t); continue; }
      const key=normEs(t);
      let sim = this.es2sim.get(key);
      if(!sim){
        // genera candidato con LM; si LM es pobre, usa síntesis por sílabas
        const candLM = this.generateSimlish(t, 10, temperature, topk);
        sim = candLM || synthFromWord(t);
      }
      out.push(sim);
    }
    // minilimpieza de espacios
    return out.join(" ").replace(/\s+([.,;:!?])/g,"$1");
  }
  translateSIM2ES(text){
    const pre=this.compressMultiSim(text);
    const toks=tokenizeSIM(pre);
    const out=[];
    for(const t0 of toks){
      if(/^[.,;:!?]$/.test(t0)){ out.push(t0); continue; }
      const t=this.expandMultiSimToken(t0);
      const key=normSim(t);
      let es = this.sim2es.get(key);
      if(!es){
        // intenta sin prefijos/sufijos (dra-/to-, -nu/-ru)
        const base = key.replace(/^(dra-|to-)/,"").replace(/(-nu|-ru)$/,"");
        es = this.sim2es.get(base);
      }
      out.push(es || t);
    }
    return out.join(" ").replace(/\s+([.,;:!?])/g,"$1");
  }
  chat(text,{temperature=0.7,topk=8}={}){
    // Simple: SIM a partir del ES (o mezcla), y espejeo ES básico
    const sim = this.translateES2SIM(text,{temperature,topk});
    const es  = this.translateSIM2ES(sim);
    return { simlish: sim, es };
  }
}

const MODEL = new SimlishModel();
MODEL.loadTraining();

// ========================= Endpoint ML =========================
// body: { text, mode="chat", temperature?, topk? }
app.post("/ml",(req,res)=>{
  const { text="", mode="chat", temperature=0.7, topk=8 } = req.body||{};
  try{
    let out={simlish:"", es:""};
    if(mode==="simlish"){ out.simlish = MODEL.translateES2SIM(text,{temperature,topk}); }
    else if(mode==="es"){ out.es = MODEL.translateSIM2ES(text); }
    else { out = MODEL.chat(text,{temperature,topk}); }
    res.json(out);
  }catch(e){
    res.status(500).json({ok:false,error:"ml-fail"});
  }
});

// ========================= Estáticos (sirve index.html) =========================
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log("Simlish backend ML listo en puerto "+PORT));
