import { decodeEntities, cleanText, minutesFromISO } from "./utils.js";

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
async function fetchJSON(url, timeout=12000){ try{ const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout); const r=await fetch(url,{signal:c.signal, cache:"no-store"}); clearTimeout(t); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); } catch(e){ console.error("fetchJSON",url,e.message); return null; } }
async function fetchText(url, timeout=12000){ try{ const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout); const r=await fetch(url,{signal:c.signal, cache:"no-store"}); clearTimeout(t); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); } catch(e){ console.error("fetchText",url,e.message); return ""; } }
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
  const normalized = (status || "").toLowerCase();

  switch(normalized){
    case "cancelled":
      return `<span class="time-cancelled">❌ Supprimé</span>`;
    case "delayed":
      return `<span class="time-delay">⏳ Retardé</span>`;
    case "last":
      return `<span class="time-last">🔴 Dernier passage</span>`;
    case "notstopping":
      return `<span class="time-cancelled">🚫 Non desservi</span>`;
    case "noservice":
      return `<span class="time-cancelled">⚠️ Service terminé</span>`;
  }

  if (minutes === 0) {
    return `<span class="time-imminent">🚉 À quai</span>`;
  }

  return `<span class="time-estimated">🟢 OK</span>`;
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
  const label = Number.isFinite(v.minutes) ? `${v.minutes} min` : "—";
  return `<div class="time-box">${label}</div>`;
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

  cont.classList.remove("bus-grid");
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

  cont.classList.add("bus-grid");

  // Regrouper par ligne puis par destination
  const byLine = {};
  visits.forEach(v => {
    if (!byLine[v.lineId]) byLine[v.lineId] = [];
    byLine[v.lineId].push(v);
  });

  const sortedLines = Object.entries(byLine).sort(([a],[b]) => (a || "").localeCompare(b || ""));

  for (const [lineId, rows] of sortedLines) {
    let meta = { code: lineId || "?", color: "#2450a4", textColor: "#fff" };
    if (typeof fetchLineMetadata === "function") {
      try { meta = await fetchLineMetadata(lineId); } catch {}
    }

    const byDest = {};
    rows.forEach(r => {
      const key = r.dest || "—";
      if (!byDest[key]) byDest[key] = [];
      byDest[key].push(r);
    });

    const sortedDest = Object.entries(byDest).sort(([a],[b]) => a.localeCompare(b, "fr", { sensitivity: "base" }));

    for (const [dest, list] of sortedDest) {
      const card = document.createElement("div");
      card.className = "bus-card";

      const header = document.createElement("div");
      header.className = "bus-card-header";
      header.innerHTML = `
        <span class="line-pill" style="background:${meta.color};color:${meta.textColor}">${meta.code}</span>
        <span class="bus-card-dest">${dest}</span>
      `.trim();
      card.appendChild(header);

      const timesEl = document.createElement("div");
      timesEl.className = "times";

      list
        .sort((a,b)=>(a.minutes??9e9)-(b.minutes??9e9))
        .slice(0,4)
        .forEach(it => {
          timesEl.insertAdjacentHTML("beforeend", formatTimeBox(it));
        });

      card.appendChild(timesEl);
      cont.appendChild(card);
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
const WEATHER_CODES = {
  0: { emoji: "☀️", text: "Grand soleil" },
  1: { emoji: "🌤️", text: "Ciel dégagé" },
  2: { emoji: "⛅", text: "Éclaircies" },
  3: { emoji: "☁️", text: "Ciel couvert" },
  45: { emoji: "🌫️", text: "Brouillard" },
  48: { emoji: "🌫️", text: "Brouillard givrant" },
  51: { emoji: "🌦️", text: "Bruine légère" },
  53: { emoji: "🌦️", text: "Bruine" },
  55: { emoji: "🌧️", text: "Forte bruine" },
  56: { emoji: "🌧️", text: "Bruine verglaçante" },
  57: { emoji: "🌧️", text: "Bruine verglaçante" },
  61: { emoji: "🌦️", text: "Pluie faible" },
  63: { emoji: "🌧️", text: "Pluie" },
  65: { emoji: "🌧️", text: "Pluie forte" },
  66: { emoji: "🌧️", text: "Pluie verglaçante" },
  67: { emoji: "🌧️", text: "Pluie verglaçante" },
  71: { emoji: "🌨️", text: "Neige légère" },
  73: { emoji: "🌨️", text: "Neige" },
  75: { emoji: "❄️", text: "Neige forte" },
  77: { emoji: "❄️", text: "Grésil" },
  80: { emoji: "🌦️", text: "Averses" },
  81: { emoji: "🌧️", text: "Averses" },
  82: { emoji: "🌧️", text: "Forte averse" },
  85: { emoji: "🌨️", text: "Averses de neige" },
  86: { emoji: "❄️", text: "Averses de neige" },
  95: { emoji: "⛈️", text: "Orages" },
  96: { emoji: "⛈️", text: "Orages grêle" },
  99: { emoji: "⛈️", text: "Orages grêle" }
};

function describeWeather(code){
  return WEATHER_CODES[code] || { emoji: "🌤️", text: "Météo" };
}

async function refreshWeather(){
  const data=await fetchJSON(WEATHER_URL);
  const tempEl=document.getElementById("weather-temp");
  const emojiEl=document.getElementById("weather-emoji");
  const descEl=document.getElementById("weather-desc");

  if(!data?.current_weather){
    if(descEl) descEl.textContent="Météo indisponible";
    tickerData.timeWeather="Météo indisponible";
    return;
  }

  const {temperature, weathercode} = data.current_weather;
  const info = describeWeather(weathercode);
  const tempStr = `${Math.round(temperature)}°C`;
  if(tempEl) tempEl.textContent=tempStr;
  if(emojiEl) emojiEl.textContent=info.emoji;
  if(descEl) descEl.textContent=info.text;
  tickerData.timeWeather = `${tempStr} • ${info.text}`;
}

async function refreshVelib(){
  await Promise.all(Object.entries(VELIB_STATIONS).map(async ([key,id])=>{
    const el=document.getElementById(`velib-${key.toLowerCase()}`);
    if(!el) return;
    try{
      const url=`https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/velib-disponibilite-en-temps-reel/records?where=stationcode%3D${id}&limit=1`;
      const data=await fetchJSON(url);
      const st=data?.results?.[0];
      if(!st){ el.textContent="Indispo"; return; }
      const mech=st.mechanical_bikes||0;
      const elec=st.ebike_bikes||0;
      const docks=st.numdocksavailable||0;
      el.textContent=`🚲${mech} 🔌${elec} 🅿️${docks}`;
    }catch(e){
      console.error("refreshVelib", key, e);
      el.textContent="Indispo";
    }
  }));
}

async function refreshNews(){
  const xml=await fetchText(PROXY+encodeURIComponent(RSS_URL));
  let items=[];
  if(xml){
    try{
      const doc=new DOMParser().parseFromString(xml,"application/xml");
      items=[...doc.querySelectorAll("item")]
        .slice(0,5)
        .map(node=>({
          title:cleanText(node.querySelector("title")?.textContent||""),
          desc:cleanText(node.querySelector("description")?.textContent||"")
        }));
    }catch(e){
      console.error("refreshNews", e);
    }
  }
  newsItems=items;
  renderNews();
}

function renderNews(){
  const cont=document.getElementById("news-carousel");
  if(!cont) return;
  cont.innerHTML="";
  if(!newsItems.length){
    cont.textContent="Aucune actualité";
    return;
  }
  newsItems.forEach((item,idx)=>{
    const card=document.createElement("div");
    card.className="news-card"+(idx===currentNews?" active":"");
    card.innerHTML=`<div>${item.title}</div><div>${item.desc}</div>`;
    cont.appendChild(card);
  });
}

function nextNews(){
  if(!newsItems.length) return;
  currentNews=(currentNews+1)%newsItems.length;
  renderNews();
}

const SIGNS = [
  { fr: "Bélier", en: "Aries" },{ fr: "Taureau", en: "Taurus" },{ fr: "Gémeaux", en: "Gemini" },
  { fr: "Cancer", en: "Cancer" },{ fr: "Lion", en: "Leo" },{ fr: "Vierge", en: "Virgo" },
  { fr: "Balance", en: "Libra" },{ fr: "Scorpion", en: "Scorpio" },{ fr: "Sagittaire", en: "Sagittarius" },
  { fr: "Capricorne", en: "Capricorn" },{ fr: "Verseau", en: "Aquarius" },{ fr: "Poissons", en: "Pisces" }
];

async function fetchHoroscope(signEn){
  try{
    const url=`https://horoscope-app-api.vercel.app/api/v1/get-horoscope/daily?sign=${signEn}&day=today`;
    const data=await fetchJSON(PROXY+encodeURIComponent(url));
    return data?.data?.horoscope_data||"Horoscope indisponible.";
  }catch{
    return "Horoscope indisponible.";
  }
}

async function refreshHoroscopeCycle(){
  const {fr,en}=SIGNS[signIdx];
  const text=await fetchHoroscope(en);
  tickerData.horoscope=`🔮 ${fr} : ${text}`;
  signIdx=(signIdx+1)%SIGNS.length;
}

async function refreshSaint(){
  try{
    const data=await fetchJSON("https://nominis.cef.fr/json/nominis.php");
    const name=data?.response?.prenoms;
    tickerData.saint = name ? `🎂 Ste ${name}` : "🎂 Fête du jour";
  }catch{
    tickerData.saint="🎂 Fête du jour indisponible";
  }
}

function updateTicker(){
  const slot=document.getElementById("ticker-slot");
  if(!slot) return;
  const clock=`${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`;
  const entries=[`${clock} • ${tickerData.timeWeather}`];
  if(tickerData.saint) entries.push(tickerData.saint);
  if(tickerData.horoscope) entries.push(tickerData.horoscope);
  if(tickerData.traffic) entries.push(tickerData.traffic);
  const pool=entries.filter(Boolean);
  if(!pool.length){ slot.textContent="Chargement…"; return; }
  slot.textContent=pool[tickerIndex%pool.length];
  tickerIndex++;
}

function summarizeTrafficItem(item){
  const title=cleanText(item?.title||"");
  const message=cleanText(item?.message||"");
  if(!message || message===title) return title;
  return `${title} – ${message}`.trim();
}

async function refreshTransitTraffic(){
  const banner=document.getElementById("traffic-banner");
  const rerInfo=document.getElementById("rer-traffic");
  const events=document.getElementById("events-list");

  if(events) events.innerHTML="Chargement…";

  try{
    const data=await fetchJSON("https://api-ratp.pierre-grimaud.fr/v4/traffic", 10000);
    const result=data?.result;
    if(!result) throw new Error("no result");

    const impacted=[];

    const rerA=result.rers?.find(r=>r.line==="A");
    if(rerInfo){
      if(rerA){
        rerInfo.style.display="block";
        rerInfo.textContent=summarizeTrafficItem(rerA);
        rerInfo.className=`traffic-sub ${rerA.slug==="normal"?"ok":"alert"}`;
        if(rerA.slug!=="normal") impacted.push({label:"RER A", detail:summarizeTrafficItem(rerA)});
      }else{
        rerInfo.style.display="none";
      }
    }

    const linesToWatch=["77","201"];
    const busItems=linesToWatch.map(code=>result.buses?.find(b=>b.line===code)).filter(Boolean);

    if(events){
      events.innerHTML="";
      if(!busItems.length){
        const div=document.createElement("div");
        div.className="traffic-sub ok";
        div.textContent="Aucune information bus.";
        events.appendChild(div);
      }else{
        let appended=false;
        busItems.forEach(item=>{
          const div=document.createElement("div");
          const alert=item.slug!=="normal";
          div.className=`traffic-sub ${alert?"alert":"ok"}`;
          div.innerHTML=`<strong>Bus ${item.line}</strong> — ${summarizeTrafficItem(item)}`;
          events.appendChild(div);
          appended=true;
          if(alert) impacted.push({label:`Bus ${item.line}`, detail:summarizeTrafficItem(item)});
        });
        if(!appended){
          const div=document.createElement("div");
          div.className="traffic-sub ok";
          div.textContent="Trafic normal sur les bus suivis.";
          events.appendChild(div);
        }
      }
    }

    if(banner){
      if(impacted.length){
        const list=impacted.map(i=>i.label).join(", ");
        const detail=impacted[0].detail;
        banner.textContent=`⚠️ ${list} : ${detail}`;
        banner.className="traffic-banner alert";
        tickerData.traffic=`⚠️ ${list} perturbé`;
      }else{
        banner.textContent="🟢 Trafic normal sur les lignes suivies.";
        banner.className="traffic-banner ok";
        tickerData.traffic="🟢 Trafic normal";
      }
    }
  }catch(e){
    console.error("refreshTransitTraffic", e);
    if(banner){
      banner.textContent="⚠️ Trafic indisponible";
      banner.className="traffic-banner alert";
    }
    if(rerInfo) rerInfo.style.display="none";
    if(events){
      events.innerHTML='<div class="traffic-sub alert">Données trafic indisponibles</div>';
    }
    tickerData.traffic="⚠️ Trafic indisponible";
  }
}

function distanceKm(lat1, lon1, lat2, lon2){
  const R=6371;
  const dLat=(lat2-lat1)*Math.PI/180;
  const dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

async function refreshRoadTraffic(){
  const cont=document.getElementById("road-list");
  if(!cont) return;
  cont.textContent="Chargement…";
  try{
    const url="https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/comptages-routiers-permanents/records?limit=60&order_by=-t_1h";
    const data=await fetchJSON(url, 12000);
    const results=data?.results||[];
    const center={lat:48.825, lon:2.45};
    const seen=new Set();
    const rows=[];
    for(const rec of results){
      const libelle=(rec.libelle||"").replace(/_/g," ").trim();
      if(!libelle || seen.has(libelle)) continue;
      const point=rec.geo_point_2d;
      if(point){
        const d=distanceKm(center.lat, center.lon, point.lat, point.lon);
        if(d>5) continue;
      }
      seen.add(libelle);
      rows.push({
        libelle,
        status:rec.etat_trafic||"Indisponible",
        updated:rec.t_1h?new Date(rec.t_1h):null
      });
      if(rows.length>=4) break;
    }
    cont.innerHTML="";
    if(!rows.length){
      cont.innerHTML='<div class="traffic-sub ok">Pas de capteur routier proche.</div>';
      return;
    }
    rows.forEach(item=>{
      const row=document.createElement("div");
      row.className="road";
      const status=item.status.toLowerCase();
      const emoji=status.includes("fluide")?"🟢":status.includes("dense")?"🟠":status.includes("sature")?"🔴":"ℹ️";
      const time=item.updated?item.updated.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}):"--:--";
      row.innerHTML=`<span>${emoji}</span><div><div class="road-name">${item.libelle}</div><div class="road-meta">${item.status} · ${time}</div></div>`;
      cont.appendChild(row);
    });
  }catch(e){
    console.error("refreshRoadTraffic", e);
    cont.innerHTML='<div class="traffic-sub alert">Données routières indisponibles</div>';
  }
}

async function refreshCourses(){
  const cont=document.getElementById("courses-list");
  if(!cont) return;
  cont.textContent="Chargement…";
  try{
    // Les endpoints publics fiables sont rares : on affiche un lien de référence si la récupération échoue.
    const html=await fetchText("https://r.jina.ai/https://www.letrot.com/stats/Evenement/GetEvenements?hippodrome=VINCENNES&startDate="+new Date().toISOString().slice(0,10)+"&endDate="+new Date(Date.now()+90*86400000).toISOString().slice(0,10));
    const entries=[...html.matchAll(/(\d{1,2} \w+ \d{4}).*?Réunion\s*(\d+)/gis)]
      .map(m=>({ date:m[1], reunion:m[2] }));
    cont.innerHTML="";
    if(!entries.length){
      throw new Error("no entries");
    }
    entries.slice(0,4).forEach(({date,reunion})=>{
      const div=document.createElement("div");
      div.className="traffic-sub ok";
      div.textContent=`${date} — Réunion ${reunion}`;
      cont.appendChild(div);
    });
  }catch(e){
    console.warn("refreshCourses", e);
    cont.innerHTML='<div class="traffic-sub alert">Programme indisponible. Consultez <a href="https://www.letrot.com/stats/Evenement" target="_blank" rel="noopener">letrot.com</a>.</div>';
  }
}

// === Boucles ===
function startLoops(){
  setInterval(setClock,1000);
  setInterval(renderRer,60000);
  setInterval(()=>renderBusForStop(STOP_IDS.JOINVILLE,"bus-joinville-body","bus-joinville-traffic"),60000);
  setInterval(()=>renderBusForStop(STOP_IDS.HIPPODROME,"bus-hippodrome-body","bus-hippodrome-traffic"),60000);
  setInterval(()=>renderBusForStop(STOP_IDS.BREUIL,"bus-breuil-body","bus-breuil-traffic"),60000);
  setInterval(computeBestRouteJoinville,120000);
  setInterval(refreshVelib,180000);
  setInterval(refreshWeather,1800000);
  setInterval(refreshNews,900000);
  setInterval(nextNews,12000);
  setInterval(refreshHoroscopeCycle,60000);
  setInterval(refreshSaint,3600000);
  setInterval(refreshTransitTraffic,120000);
  setInterval(refreshRoadTraffic,300000);
  setInterval(refreshCourses,900000);
  setInterval(()=>{updateTicker(); setLastUpdate();},10000);
}

// === Init ===
(async function init(){
  setClock();
  await Promise.allSettled([
    renderRer(),
    renderBusForStop(STOP_IDS.JOINVILLE,"bus-joinville-body","bus-joinville-traffic"),
    renderBusForStop(STOP_IDS.HIPPODROME,"bus-hippodrome-body","bus-hippodrome-traffic"),
    renderBusForStop(STOP_IDS.BREUIL,"bus-breuil-body","bus-breuil-traffic"),
    computeBestRouteJoinville(),
    refreshVelib(),
    refreshWeather(),
    refreshNews(),
    refreshHoroscopeCycle(),
    refreshSaint(),
    refreshTransitTraffic(),
    refreshRoadTraffic(),
    refreshCourses()
  ]);
  updateTicker();
  setLastUpdate();
  startLoops();
})();



