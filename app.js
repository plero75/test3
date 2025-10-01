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

const LINES_SIRI = {
  RER_A: "STIF:Line::A:",
  BUS_77: "STIF:Line::77:",
  BUS_201: "STIF:Line::201:"
};

const VELIB_STATIONS = { VINCENNES: "12163", BREUIL: "12128" };

// === État ===
let newsItems = [];
let currentNews = 0;
let tickerIndex = 0;
let tickerData = { timeWeather: "", saint: "", horoscope: "", traffic: "" };
let signIdx = 0;

// === Utils ===
function decodeEntities(str=""){return str.replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#039;/gi,"'").replace(/&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").trim();}
function cleanText(str=""){return decodeEntities(str).replace(/<[^>]*>/g," ").replace(/[<>]/g," ").replace(/\s+/g," ").trim();}
async function fetchJSON(url, timeout=12000){ try{ const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout); const r=await fetch(url,{signal:c.signal, cache:"no-store"}); clearTimeout(t); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); } catch(e){ console.error("fetchJSON",url,e.message); return null; } }
async function fetchText(url, timeout=12000){ try{ const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout); const r=await fetch(url,{signal:c.signal, cache:"no-store"}); clearTimeout(t); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); } catch(e){ console.error("fetchText",url,e.message); return ""; } }
function minutesFromISO(iso){ if(!iso) return null; return Math.max(0, Math.round((new Date(iso).getTime()-Date.now())/60000)); }
function setClock(){ const el=document.getElementById("clock"); if(el) el.textContent=new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}); }
function setLastUpdate(){ const el=document.getElementById("lastUpdate"); if(el) el.textContent=`Maj ${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`; }

// === Stops parsing ===
function parseStop(data){
  const visits=data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit;
  if(!Array.isArray(visits)) return [];
  return visits.map(v=>{
    const mv=v.MonitoredVehicleJourney||{}; const call=mv.MonitoredCall||{};
    const lineRef=mv.LineRef?.value||mv.LineRef||""; 
    const lineId=(lineRef.match(/C\d{5}/)||[null])[0];
    const destDisplay=cleanText(call.DestinationDisplay?.[0]?.value||"");
    const expected=call.ExpectedDepartureTime||call.ExpectedArrivalTime||null;
    const status = call.DepartureStatus || call.ArrivalStatus || "onTime";
    return { lineId, dest: destDisplay, minutes: minutesFromISO(expected), status };
  });
}

// === Statuts départ ===
function renderStatus(status, minutes){
  if (minutes === 0) {
    return `<span class="time-imminent">🚉 À quai</span>`;
  }
  if (minutes !== null && minutes <= 1) {
    return `<span class="time-imminent">🟢 Imminent</span>`;
  }
  switch(status){
    case "cancelled":   return `<span class="time-cancelled">❌ Supprimé</span>`;
    case "delayed":     return `<span class="time-delay">⏳ Retardé</span>`;
    case "last":        return `<span class="time-last">🔴 Dernier passage</span>`;
    case "notStopping": return `<span class="time-cancelled">🚫 Non desservi</span>`;
    case "noService":   return `<span class="time-cancelled">⚠️ Service terminé</span>`;
    default:            return `<span class="time-estimated">🟢 OK</span>`;
  }
}

function formatTimeBox(v){
  if (v.minutes === 0) {
    return `<div class="time-box time-imminent">🚉 À quai</div>`;
  }
  if (v.minutes !== null && v.minutes <= 1) {
    return `<div class="time-box time-imminent">🟢 Imminent</div>`;
  }
  if (v.status === "cancelled") {
    return `<div class="time-box time-cancelled">❌ Supprimé</div>`;
  }
  if (v.status === "last") {
    return `<div class="time-box time-last">🔴 Dernier passage</div>`;
  }
  if (v.status === "delayed") {
    return `<div class="time-box time-delay">⏳ Retardé</div>`;
  }
  return `<div class="time-box">${v.minutes} min</div>`;
}



// === RER Joinville ===
async function renderRer(){
  const cont=document.getElementById("rer-body");
  cont.innerHTML="Chargement…";

  const data=await fetchJSON(PROXY+encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.RER_A}`));
  const visits=parseStop(data).slice(0,6);

  cont.innerHTML="";
  if(!visits.length){ cont.textContent="Aucun passage"; return; }

  visits.forEach(v=>{
    const row=document.createElement("div");
    row.className="row";

    const pill=document.createElement("span");
    pill.className="line-pill rer-a";
    pill.textContent="A";
    row.appendChild(pill);

    const destEl=document.createElement("div");
    destEl.className="dest";
    destEl.textContent=v.dest || "—";
    row.appendChild(destEl);

    const timesEl=document.createElement("div");
    timesEl.className="times";
    timesEl.innerHTML=formatTimeBox(v);
    row.appendChild(timesEl);

    const statusEl=document.createElement("div");
    statusEl.className="status";
    statusEl.innerHTML=renderStatus(v.status, v.minutes);
    row.appendChild(statusEl);

    cont.appendChild(row);
  });
}

// === BUS par arrêt ===
async function renderBusForStop(stopId, bodyId, trafficId) {
  const cont = document.getElementById(bodyId);
  const tEl  = document.getElementById(trafficId);
  if (!cont) return;

  cont.innerHTML = "Chargement…";
  if (tEl) { tEl.style.display = "none"; tEl.className = "traffic-sub ok"; tEl.textContent = ""; }

  const data = await fetchJSON(
    PROXY + encodeURIComponent(
      `https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${stopId}`
    ),
    12000
  );

  const visits = parseStop(data);
  cont.innerHTML = "";

  if (!visits.length) {
    cont.innerHTML = `<div class="traffic-sub alert">🚧 Aucun passage prévu</div>`;
    return;
  }

  // Regrouper par ligne puis par destination
  const byLine = {};
  visits.forEach(v => {
    if (!byLine[v.lineId]) byLine[v.lineId] = [];
    byLine[v.lineId].push(v);
  });

  for (const [lineId, rows] of Object.entries(byLine)) {
    // Métadonnées de ligne (couleur, code) si tu as la fonction; sinon fallback
    let meta = { code: lineId || "?", color: "#2450a4", textColor: "#fff" };
    if (typeof fetchLineMetadata === "function") {
      try { meta = await fetchLineMetadata(lineId); } catch {}
    }

    // En-tête de ligne
    const header = document.createElement("div");
    header.className = "bus-line-header";
    header.innerHTML = `<span class="line-pill" style="background:${meta.color};color:${meta.textColor}">${meta.code}</span>`;
    cont.appendChild(header);

    // Regroupement par destination
    const byDest = {};
    rows.forEach(r => {
      const key = r.dest || "—";
      if (!byDest[key]) byDest[key] = [];
      byDest[key].push(r);
    });

   for (const [dest, list] of Object.entries(byDest)) {
  const row = document.createElement("div");
  row.className = "row";

  // Nom de la destination
  const destEl = document.createElement("div");
  destEl.className = "dest";
  destEl.textContent = dest;
  row.appendChild(destEl);

  // Horaires regroupés
  const timesEl = document.createElement("div");
  timesEl.className = "times";

  list
    .sort((a,b)=>(a.minutes??9e9)-(b.minutes??9e9))
    .slice(0,4)
    .forEach(it => {
      const box = document.createElement("div");
      box.innerHTML = formatTimeBox(it);
      timesEl.appendChild(box);
    });

  row.appendChild(timesEl);
  cont.appendChild(row);
}

  }

  // (Optionnel) message trafic par arrêt — ici “normal” si rien d’IDFM GeneralMessage mappé
  if (tEl) {
    tEl.textContent = "Trafic normal";
    tEl.className = "traffic-sub ok";
    tEl.style.display = "inline-block";
  }
}


// === Trajet optimal ===
async function computeBestRouteJoinville(){
  const el=document.getElementById("best-route");
  el.textContent="Calcul…";

  const hippo=await fetchJSON(PROXY+encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.HIPPODROME}`));
  const visits=parseStop(hippo);
  const busNext=visits.sort((a,b)=>(a.minutes||99)-(b.minutes||99))[0];
  const nextBusMin = Number.isFinite(busNext?.minutes)? busNext.minutes : null;

  const MARCHE=15, VELIB=6, BUS_TRAVEL=5;
  let velibOK=false;
  try{
    const d=await fetchJSON(`https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/velib-disponibilite-en-temps-reel/records?where=stationcode%3D${VELIB_STATIONS.VINCENNES}&limit=1`);
    const st=d?.results?.[0]; velibOK=((st?.mechanical_bikes||0)+(st?.ebike_bikes||0))>0;
  }catch{}

  const options=[
    {label:"🚶 Marche", total:MARCHE, detail:"trajet direct"},
    {label:"🚲 Vélib’", total:velibOK?VELIB:Infinity, detail:velibOK?"vélo dispo":"aucun vélo"}
  ];
  if(nextBusMin!=null) options.push({label:"🚌 Bus", total:nextBusMin+BUS_TRAVEL, detail:`attente ${nextBusMin} min + trajet ${BUS_TRAVEL} min`});
  options.sort((a,b)=>a.total-b.total);

  const best=options[0];
  el.innerHTML=`<strong>${best.label}</strong> → ${best.total===Infinity?"Non recommandé":best.total+" min"} (${best.detail})`;
}

// === Horoscope, Saint, Météo, Vélib, News ===
// (identiques à ta version précédente – je les garde tels quels pour ne pas doubler ici)

// === Boucles ===
function startLoops(){
  setInterval(setClock,1000);
  setInterval(renderRer,60000);
setInterval(() => renderBusForStop(STOP_IDS.JOINVILLE,  "bus-joinville-body",  "bus-joinville-traffic"), 60000);
setInterval(() => renderBusForStop(STOP_IDS.HIPPODROME, "bus-hippodrome-body", "bus-hippodrome-traffic"), 60000);
setInterval(() => renderBusForStop(STOP_IDS.BREUIL,     "bus-breuil-body",     "bus-breuil-traffic"),    60000);

  setInterval(computeBestRouteJoinville,120000);
}

// === Init ===
(async function init(){
  setClock();
await Promise.allSettled([
  renderRer(),
  renderBusForStop(STOP_IDS.JOINVILLE,  "bus-joinville-body",  "bus-joinville-traffic"),
  renderBusForStop(STOP_IDS.HIPPODROME, "bus-hippodrome-body", "bus-hippodrome-traffic"),
  renderBusForStop(STOP_IDS.BREUIL,     "bus-breuil-body",     "bus-breuil-traffic"),
     computeBestRouteJoinville()
  ]);
  updateTicker();
  setLastUpdate();
  startLoops();
})();



