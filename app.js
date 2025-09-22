// === Constantes & endpoints ===
const PROXY = "https://ratp-proxy.hippodrome-proxy42.workers.dev/?url=";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=48.835&longitude=2.45&current_weather=true";
const RSS_URL = "https://www.francetvinfo.fr/titres.rss";

const STOP_IDS = {
  RER_A: "STIF:StopArea:SP:43135:",
  JOINVILLE: "STIF:StopArea:SP:70640:",
  HIPPODROME: "STIF:StopArea:SP:463641:",
  BREUIL: "STIF:StopArea:SP:463644:"
};

const LINES = {
  RER_A:   { id: "C01742", label: "RER A" },
  BUS_77:  { id: "C02251", label: "77" },
  BUS_201: { id: "C01219", label: "201" }
};

const VELIB_STATIONS = { VINCENNES: "12163", BREUIL: "12128" };

const WEATHER_CODES = {
  0: "Ciel dégagé", 1: "Principalement clair", 2: "Partiellement nuageux", 3: "Couvert",
  45: "Brouillard", 48: "Brouillard givrant",
  51: "Bruine faible", 53: "Bruine", 55: "Bruine forte",
  61: "Pluie faible", 63: "Pluie modérée", 65: "Pluie forte",
  80: "Averses faibles", 81: "Averses modérées", 82: "Fortes averses",
  95: "Orages", 96: "Orages grêle", 99: "Orages grêle"
};

// === État ===
const lineMetaCache = new Map();
let newsItems = [];
let currentNews = 0;
let tickerIndex = 0;
let tickerData = { timeWeather: "", saint: "", horoscope: "", traffic: "" };

// === Utils ===
function decodeEntities(str=""){return str.replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#039;/gi,"'").replace(/&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").trim();}
function cleanText(str=""){return decodeEntities(str).replace(/<[^>]*>/g," ").replace(/[<>]/g," ").replace(/\s+/g," ").trim();}
async function fetchJSON(url, timeout=12000){ try{ const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout); const r=await fetch(url,{signal:c.signal, cache:"no-store"}); clearTimeout(t); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); } catch(e){ console.error("fetchJSON",url,e.message); return null; } }
async function fetchText(url, timeout=12000){ try{ const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout); const r=await fetch(url,{signal:c.signal, cache:"no-store"}); clearTimeout(t); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); } catch(e){ console.error("fetchText",url,e.message); return ""; } }
function minutesFromISO(iso){ if(!iso) return null; return Math.max(0, Math.round((new Date(iso).getTime()-Date.now())/60000)); }
function formatClockTime(iso){ if(!iso) return null; const d=new Date(iso); if(Number.isNaN(d.getTime())) return null; return d.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}); }
function setClock(){ const el=document.getElementById("clock"); if(el) el.textContent=new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}); }
function setLastUpdate(){ const el=document.getElementById("lastUpdate"); if(el) el.textContent=`Maj ${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`; }

// === Référentiel lignes (couleurs IDFM) ===
function normaliseColor(hex){ if(!hex) return null; const c=hex.toString().trim().replace(/^#/,""); return /^[0-9a-fA-F]{6}$/.test(c)?`#${c}`:null; }
function fallbackLineMeta(id){ return { id, code:id, color:"#2450a4", textColor:"#fff" }; }
async function fetchLineMetadata(lineId){
  if(!lineId) return fallbackLineMeta(lineId);
  if(lineMetaCache.has(lineId)) return lineMetaCache.get(lineId);
  const url = "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/referentiel-des-lignes/records?where=id_line%3D%22"+lineId+"%22&limit=1";
  const data = await fetchJSON(url,10000); let meta=fallbackLineMeta(lineId);
  if(data?.results?.length){ const e=data.results[0]; meta={ id:lineId, code:e.shortname_line||e.name_line||lineId, color: normaliseColor(e.colourweb_hexa)||"#2450a4", textColor: normaliseColor(e.textcolourweb_hexa)||"#fff" }; }
  lineMetaCache.set(lineId, meta); return meta;
}

// === RER/BUS rendering ===
function parseStop(data){
  const visits=data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit;
  if(!Array.isArray(visits)) return [];
  return visits.map(v=>{
    const mv=v.MonitoredVehicleJourney||{}; const call=mv.MonitoredCall||{};
    const lineRef=mv.LineRef?.value||mv.LineRef||""; const lineId=(lineRef.match(/C\d{5}/)||[null])[0];
    const destDisplay=cleanText(call.DestinationDisplay?.[0]?.value||"");
    const destName=cleanText(mv.DestinationName?.[0]?.value||"");
    const expected=call.ExpectedDepartureTime||call.ExpectedArrivalTime||null;
    return { lineId, dest: destDisplay||destName, minutes: minutesFromISO(expected) };
  });
}

function renderSimpleBoard(container, rows, pill){
  if(!container) return; container.innerHTML="";
  rows.forEach(r=>{
    const row=document.createElement("div"); row.className="row";
    const p=document.createElement("span"); p.className="line-pill"; if(pill?.class) p.classList.add(pill.class);
    if(pill?.style){ Object.entries(pill.style).forEach(([k,v])=>p.style[k]=v); }
    p.textContent=pill?.text||""; row.appendChild(p);
    const dest=document.createElement("div"); dest.className="dest"; dest.textContent=r.dest||"Destination"; row.appendChild(dest);
    const times=document.createElement("div"); times.className="times";
    const tb=document.createElement("span"); tb.className="time-box"; tb.textContent= Number.isFinite(r.minutes)? String(Math.max(0,r.minutes)) : "--"; times.appendChild(tb);
    row.appendChild(times); container.appendChild(row);
  });
}

async function renderRer(){
  const data=await fetchJSON(PROXY+encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.RER_A}`));
  const visits=parseStop(data).filter(v=>/paris|la défense|nation|châtelet|haussmann/i.test(v.dest||"")).slice(0,6);
  const cont=document.getElementById("rer-body");
  renderSimpleBoard(cont, visits, {class:"rer-a", text:"A"});
}

async function renderBus(){
  const list=[];
  const hippo=await fetchJSON(PROXY+encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.HIPPODROME}`));
  const breuil=await fetchJSON(PROXY+encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.BREUIL}`));
  const join=await fetchJSON(PROXY+encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.JOINVILLE}`));
  [hippo,breuil,join].forEach(d=>parseStop(d).forEach(v=>list.push(v)));
  const grouped=new Map();
  list.forEach(v=>{ const key=(v.lineId||"")+ "|" + (v.dest||""); const cur=grouped.get(key);
    if(!cur || (Number.isFinite(v.minutes) && v.minutes < cur.minutes)) grouped.set(key, v);
  });
  const rows=[...grouped.values()].slice(0,8);
  // Précharger les couleurs
  await Promise.all([...new Set(rows.map(r=>r.lineId).filter(Boolean))].map(id=>fetchLineMetadata(id)));
  const cont=document.getElementById("bus-blocks"); if(!cont) return; cont.innerHTML="";
  rows.forEach(r=>{
    const row=document.createElement("div"); row.className="row";
    const meta=lineMetaCache.get(r.lineId)||{code:"BUS",color:"#2450a4",textColor:"#fff"};
    const p=document.createElement("span"); p.className="line-pill"; p.style.background=meta.color; p.style.color=meta.textColor; p.textContent=meta.code||"BUS"; row.appendChild(p);
    const dest=document.createElement("div"); dest.className="dest"; dest.textContent=r.dest; row.appendChild(dest);
    const times=document.createElement("div"); times.className="times"; const tb=document.createElement("span"); tb.className="time-box"; tb.textContent=Number.isFinite(r.minutes)?String(Math.max(0,r.minutes)):"--"; times.appendChild(tb); row.appendChild(times);
    cont.appendChild(row);
  });
}

// === Meilleur itinéraire vers Joinville ===
async function computeBestRouteJoinville(){
  const el=document.getElementById("best-route"); if(!el) return;
  // Bus depuis Hippodrome
  const hippo=await fetchJSON(PROXY+encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.HIPPODROME}`));
  const visits=parseStop(hippo);
  // 77 & 201
  const busNext=visits.filter(v=>/C02251|C01219/.test(v.lineId||"")).sort((a,b)=>(a.minutes||99)-(b.minutes||99))[0];
  const nextBusMin = Number.isFinite(busNext?.minutes)? Math.max(0,busNext.minutes) : null;

  // Hypothèses
  const MARCHE=15; // min
  const VELIB=6;   // min si dispo
  const BUS_TRAVEL=5; // min trajet bus

  // Dispo Velib → on check rapido Vincennes
  let velibOK=false;
  try{
    const d=await fetchJSON(`https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/velib-disponibilite-en-temps-reel/records?where=stationcode%3D${encodeURIComponent(VELIB_STATIONS.VINCENNES)}&limit=1`);
    const st=d?.results?.[0]; velibOK = ((st?.mechanical_bikes||0)+(st?.ebike_bikes||0))>0;
  }catch{}

  const options=[
    {label:"🚶 Marche", total:MARCHE, detail:"trajet direct"},
    {label:"🚲 Vélib’", total: velibOK? VELIB : Infinity, detail: velibOK? "vélo disponible" : "aucun vélo disponible"}
  ];
  if(nextBusMin!=null) options.push({label:"🚌 Bus 77/201", total: nextBusMin + BUS_TRAVEL, detail:`attente ${nextBusMin} min + ~${BUS_TRAVEL} min`});
  options.sort((a,b)=>a.total-b.total);
  const best=options[0];

  el.innerHTML = `
    <div class="best-option">
      <span class="tag" style="background:#111;color:#fff">${best.label}</span>
      <div><strong>${best.total===Infinity? "Non recommandé" : best.total+" min"}</strong> • ${best.detail}</div>
    </div>
  `;
}

// === Météo / Vélib / Actus / Courses / Trafic ===
function weatherEmojiFromCode(code){ if([0,1].includes(code)) return "☀️"; if([2,3].includes(code)) return "⛅"; if([61,63,65,80,81,82].includes(code)) return "🌧️"; if([95,96,99].includes(code)) return "⛈️"; if([45,48].includes(code)) return "🌫️"; return "🌤️"; }
async function refreshWeather(){
  const data=await fetchJSON(WEATHER_URL,10000);
  const t=document.getElementById("weather-temp"), d=document.getElementById("weather-desc"), e=document.getElementById("weather-emoji");
  if(!data?.current_weather){ if(t) t.textContent="--°"; if(d) d.textContent="Météo indisponible"; if(e) e.textContent="—"; tickerData.timeWeather=""; return; }
  const { temperature, weathercode }=data.current_weather; const temp=`${Math.round(temperature)}°C`; const desc=WEATHER_CODES[weathercode]||""; const ico=weatherEmojiFromCode(weathercode);
  if(t) t.textContent=temp; if(d) d.textContent=desc; if(e) e.textContent=ico;
  tickerData.timeWeather = `${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})} • ${ico} ${temp} (${desc})`;
}

async function refreshVelib(){
  for(const [key,stationId] of Object.entries(VELIB_STATIONS)){
    try{
      const d=await fetchJSON(`https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/velib-disponibilite-en-temps-reel/records?where=stationcode%3D${encodeURIComponent(stationId)}&limit=1`);
      const st=d?.results?.[0]||null; const el=document.getElementById(`velib-${key.toLowerCase()}`); if(!el) continue;
      if(!st){ el.textContent="Données Vélib indisponibles"; continue; }
      const mech=st.mechanical_bikes ?? st.mechanical ?? 0; const ebike=st.ebike_bikes ?? st.ebike ?? 0; const docks=st.numdocksavailable ?? st.num_docks_available ?? 0;
      el.innerHTML = `
        <div>
          <div class="velib-icon">🚲</div><div class="velib-value">${mech}</div><div class="velib-label">méca</div>
        </div>
        <div>
          <div class="velib-icon">🔌</div><div class="velib-value">${ebike}</div><div class="velib-label">élec</div>
        </div>
        <div>
          <div class="velib-icon">🅿️</div><div class="velib-value">${docks}</div><div class="velib-label">bornes</div>
        </div>`;
    }catch(e){ console.error("Velib",e); }
  }
}

async function refreshNews(){
  const xml=await fetchText(PROXY+encodeURIComponent(RSS_URL),15000); let items=[];
  if(xml){ try{ const doc=new DOMParser().parseFromString(xml,"application/xml"); const nodes=[...doc.querySelectorAll("item")].slice(0,6);
    items=nodes.map(n=>({ title: cleanText(n.querySelector("title")?.textContent||""), desc: cleanText(n.querySelector("description")?.textContent||"") })); }catch(e){} }
  newsItems=items; renderNews();
}
function renderNews(){
  const cont=document.getElementById("news-carousel"); if(!cont) return; cont.innerHTML="";
  if(!newsItems.length){ cont.innerHTML='<div class="news-card active"><div class="news-title">Actualités indisponibles</div></div>'; return; }
  newsItems.forEach((n,i)=>{ const d=document.createElement("div"); d.className="news-card"+(i===currentNews?" active":""); d.innerHTML=`<div class="news-title">${n.title}</div><div class="news-desc">${n.desc}</div>`; cont.appendChild(d); });
}
function nextNews(){ if(!newsItems.length) return; currentNews=(currentNews+1)%newsItems.length; renderNews(); }

async function getVincennesCoursesToday(){
  const d=new Date(); const pmu=`${String(d.getDate()).padStart(2,"0")}${String(d.getMonth()+1).padStart(2,"0")}${d.getFullYear()}`;
  const url=PROXY+encodeURIComponent(`https://offline.turfinfo.api.pmu.fr/rest/client/7/programme/${pmu}`);
  const data=await fetchJSON(url,15000); const res=[];
  if(data?.programme?.reunions){
    data.programme.reunions.forEach(reunion=>{
      if(reunion.hippodrome?.code!=="VIN") return;
      reunion.courses?.forEach(course=>{
        const start=new Date(course.heureDepart); if(Number.isNaN(start.getTime())) return;
        res.push({ heure:start.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}), nom:course.libelle, distance:course.distance, discipline:course.discipline, dotation:course.montantPrix, ts:start.getTime(), r:reunion.numOfficiel, c:course.numOrdre });
      });
    });
  }
  return res.sort((a,b)=>a.ts-b.ts);
}
async function refreshCourses(){
  const courses=await getVincennesCoursesToday();
  const cont=document.getElementById("courses-list"); if(!cont) return; cont.innerHTML="";
  if(!courses.length){ cont.innerHTML="<div class='muted'>Aucune course aujourd’hui.</div>"; return; }
  courses.forEach((c,i)=>{
    const row=document.createElement("div"); row.className="course"; row.style.animationDelay=`${i*0.05}s`; const ref=(c.r&&c.c)?`R${c.r}C${c.c}`:"";
    row.innerHTML=`<div class="badge-time">${c.heure}</div><div><div class="course-name">${ref? ref+" – " : ""}${c.nom}</div><div class="course-meta">🏇 ${c.distance}m • ${c.discipline}</div></div><div class="course-meta">💰 ${Number(c.dotation||0).toLocaleString("fr-FR")}€</div>`;
    cont.appendChild(row);
  });
}

async function refreshRoad(){
  try{
    const data=await fetchJSON(PROXY+encodeURIComponent("https://opendata.sytadin.fr/velc/SYTR.json"),15000);
    const cont=document.getElementById("road-list"); if(!cont) return;
    if(!data){ cont.innerHTML="<div class='muted'>Info trafic indisponible.</div>"; return; }
    const entries=Array.isArray(data)?data:(data.records||[]).map(r=>r.fields||r);
    const KEY=["Périph","A4","A86","Vincennes","Joinville","Charenton"];
    const filtered=entries.filter(e=>e.libelle&&KEY.some(k=>new RegExp(k,"i").test(e.libelle))).slice(0,6);
    cont.innerHTML="";
    if(!filtered.length){ cont.innerHTML="<div class='road'><span class='badge ok'>OK</span> Circulation fluide autour de Vincennes</div>"; return; }
    filtered.forEach(e=>{ const div=document.createElement("div"); const status=e.commentaire||e.indice_traffic||"—";
      const sev=/ralenti|dense|satur|bouch/.test(String(status).toLowerCase())? "warn":"ok";
      div.className="road"; div.innerHTML=`<span class="badge ${sev}">${sev==="ok"?"OK":"⚠"}</span> ${e.libelle} • ${status}`; cont.appendChild(div); });
  }catch(e){ console.error("Sytadin",e); }
}

// === Ticker: alterne heure+météo / fête / horoscope / trafic ===
const SIGNS=["belier","taureau","gemeaux","cancer","lion","vierge","balance","scorpion","sagittaire","capricorne","verseau","poissons"];
let signIdx=0;
async function refreshSaint(){
  try{
    const data=await fetchJSON("https://nominis.cef.fr/json/nominis.php",10000);
    if(data?.response?.prenoms) tickerData.saint = `🎂 Ste ${data.response.prenoms}`;
  }catch{ tickerData.saint="🎂 Fête du jour indisponible"; }
}
// === Horoscope (via proxy Worker + clé cachée) ===
async function fetchHoroscope(sign) {
  const target = "https://api.freeastrologyapi.com/horoscope/daily";
  const url = PROXY + encodeURIComponent(target);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sunSign: sign,   // Exemple: "belier", "taureau", ...
        day: "today"
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data?.prediction || "Horoscope indisponible.";
  } catch (e) {
    console.error("fetchHoroscope", sign, e);
    return "Erreur horoscope";
  }
}

async function refreshHoroscopeCycle(){
  const sign=SIGNS[signIdx]; const text=await fetchHoroscope(sign);
  const label = sign.charAt(0).toUpperCase()+sign.slice(1);
  tickerData.horoscope = `🔮 ${label} : ${text||"—"}`;
  signIdx=(signIdx+1)%SIGNS.length;
}
function updateTicker(){
  const slot=document.getElementById("ticker-slot"); if(!slot) return;
  const pool=[tickerData.timeWeather, tickerData.saint, tickerData.horoscope, tickerData.traffic].filter(Boolean);
  if(!pool.length){ slot.textContent="Chargement…"; return; }
  slot.textContent = pool[tickerIndex % pool.length];
  tickerIndex++;
}

// === Trafic (messages généraux lignes suivies) ===
async function fetchGeneralMessages(){
  const lineIds=Object.values(LINES).map(l=>l.id); const msgs=[];
  await Promise.all(lineIds.map(async id=>{
    const url=PROXY+encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/general-message?LineRef=${encodeURIComponent(id)}`);
    const data=await fetchJSON(url,10000);
    const deliveries=data?.Siri?.ServiceDelivery?.GeneralMessageDelivery||[];
    deliveries.forEach(del=>{ (del.InfoMessage||[]).forEach(msg=>{
      const txt=cleanText(msg?.Content?.Message?.[0]?.MessageText?.[0]?.value || msg?.Content?.Message?.MessageText?.value || msg?.Description || "");
      if(txt) msgs.push(`[${id}] ${txt}`);
    });});
  }));
  const banner=document.getElementById("traffic-banner");
  if(!msgs.length){ if(banner){ banner.className="traffic-banner ok"; banner.textContent="Trafic normal sur les lignes suivies."; } tickerData.traffic="✅ Trafic normal"; }
  else{ if(banner){ banner.className="traffic-banner alert"; banner.textContent=msgs.join("  •  "); } tickerData.traffic=`⚠️ ${msgs[0]}`; }
}

// === Loops & init ===
function startLoops(){
  setInterval(setClock,1000);
  setInterval(renderRer,60*1000);
  setInterval(renderBus,60*1000);
  setInterval(computeBestRouteJoinville,120*1000);
  setInterval(refreshVelib,3*60*1000);
  setInterval(refreshWeather,30*60*1000);
  setInterval(refreshCourses,5*60*1000);
  setInterval(refreshNews,15*60*1000);
  setInterval(nextNews,12*1000);
  setInterval(refreshHoroscopeCycle,5*1000);
  setInterval(fetchGeneralMessages,5*60*1000);
  setInterval(()=>{ updateTicker(); setLastUpdate(); }, 10*1000);
}

(async function init(){
  setClock();
  await Promise.allSettled([
    renderRer(),
    renderBus(),
    computeBestRouteJoinville(),
    refreshVelib(),
    refreshWeather(),
    refreshCourses(),
    refreshNews(),
    refreshHoroscopeCycle(),
    refreshSaint(),
    fetchGeneralMessages()
  ]);
  updateTicker();
  setLastUpdate();
  startLoops();
})();
