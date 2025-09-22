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

const LINES_NAVITIA = {
  RER_A: "C01742",
  BUS_77: "C02251",
  BUS_201: "C01219"
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
    const lineRef=mv.LineRef?.value||mv.LineRef||""; const lineId=(lineRef.match(/C\d{5}/)||[null])[0];
    const destDisplay=cleanText(call.DestinationDisplay?.[0]?.value||"");
    const expected=call.ExpectedDepartureTime||call.ExpectedArrivalTime||null;
    const status = call.DepartureStatus || call.ArrivalStatus || "onTime";
    return { lineId, dest: destDisplay, minutes: minutesFromISO(expected), status };
  });
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
    const row=document.createElement("div"); row.className="row";
    row.innerHTML=`<span class="line-pill rer-a">A</span>
      <div class="dest">${v.dest}</div>
      <div class="times">${v.minutes!=null?`${v.minutes} min`:"--"}</div>
      <div class="status">${renderStatus(v.status)}</div>`;
    cont.appendChild(row);
  });
}

// === BUS par arrêt ===
async function renderBusForStop(stopId, containerId, trafficId) {
  const cont=document.getElementById(containerId);
  cont.innerHTML="Chargement…";

  const data = await fetchJSON(PROXY + encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${stopId}`));
  const visits = parseStop(data);

  cont.innerHTML="";
  if (!visits.length){ cont.textContent="Aucun passage"; return; }

  const byDest = {};
  visits.forEach(v=>{
    if(!byDest[v.dest]) byDest[v.dest]=[];
    byDest[v.dest].push(v);
  });

  for (const [dest, rows] of Object.entries(byDest)) {
    const block=document.createElement("div");
    block.className="dest-block";
    block.innerHTML=`<div class="dest-title">${dest}</div>`;
    rows.slice(0,4).forEach(r=>{
      const div=document.createElement("div");
      div.className="row";
      div.innerHTML=`<span class="line-pill">${r.lineId}</span>
        <div class="times">${r.minutes!=null?r.minutes+" min":"--"}</div>
        <div class="status">${renderStatus(r.status)}</div>`;
      block.appendChild(div);
    });
    cont.appendChild(block);
  }

  // Messages trafic
  const tEl=document.getElementById(trafficId);
  tEl.textContent="Trafic normal";
  tEl.className="traffic-msg ok";
}

// === Statuts départ ===
function renderStatus(status){
  switch(status){
    case "delayed": return "⏳ Retardé";
    case "cancelled": return "❌ Supprimé";
    case "last": return "🔴 Dernier passage";
    default: return "🟢 OK";
  }
}

// === Trajet optimal ===
async function computeBestRouteJoinville(){
  const el=document.getElementById("best-route");
  el.textContent="Calcul en cours…";

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

// === Horoscope cycle ===
const SIGNS = [
  { fr: "Bélier", en: "Aries" },{ fr: "Taureau", en: "Taurus" },{ fr: "Gémeaux", en: "Gemini" },
  { fr: "Cancer", en: "Cancer" },{ fr: "Lion", en: "Leo" },{ fr: "Vierge", en: "Virgo" },
  { fr: "Balance", en: "Libra" },{ fr: "Scorpion", en: "Scorpio" },{ fr: "Sagittaire", en: "Sagittarius" },
  { fr: "Capricorne", en: "Capricorn" },{ fr: "Verseau", en: "Aquarius" },{ fr: "Poissons", en: "Pisces" }
];
async function fetchHoroscope(signEn){
  try{
    const url=PROXY+encodeURIComponent(`https://horoscope-app-api.vercel.app/api/v1/get-horoscope/daily?sign=${signEn}&day=today`);
    const res=await fetch(url); if(!res.ok) throw new Error();
    const data=await res.json(); return data?.data?.horoscope_data||"Horoscope indisponible.";
  }catch{return "Erreur horoscope";}
}
async function refreshHoroscopeCycle(){
  const {fr,en}=SIGNS[signIdx]; const txt=await fetchHoroscope(en);
  tickerData.horoscope=`🔮 ${fr} : ${txt}`;
  signIdx=(signIdx+1)%SIGNS.length;
}

// === Saint ===
async function refreshSaint(){
  try{const d=await fetchJSON("https://nominis.cef.fr/json/nominis.php"); if(d?.response?.prenoms) tickerData.saint=`🎂 Ste ${d.response.prenoms}`;}
  catch{tickerData.saint="🎂 Fête indisponible";}
}

// === Météo ===
async function refreshWeather(){
  const d=await fetchJSON(WEATHER_URL);
  const t=document.getElementById("weather-temp"), e=document.getElementById("weather-emoji"), desc=document.getElementById("weather-desc");
  if(d?.current_weather){ const {temperature,weathercode}=d.current_weather; const temp=`${Math.round(temperature)}°C`; if(t) t.textContent=temp; if(desc) desc.textContent=weathercode; if(e) e.textContent="☀️"; tickerData.timeWeather=`${temp}`; }
}

// === Vélib ===
async function refreshVelib(){
  for(const [key,id] of Object.entries(VELIB_STATIONS)){
    const el=document.getElementById(`velib-${key.toLowerCase()}`);
    try{const d=await fetchJSON(`https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/velib-disponibilite-en-temps-reel/records?where=stationcode%3D${id}&limit=1`);
      const st=d?.results?.[0]; if(st) el.textContent=`🚲${st.mechanical_bikes||0} 🔌${st.ebike_bikes||0} 🅿️${st.numdocksavailable||0}`;
    }catch{el.textContent="Indispo";}
  }
}

// === News ===
async function refreshNews(){
  const xml=await fetchText(PROXY+encodeURIComponent(RSS_URL)); let items=[];
  if(xml){ try{ const doc=new DOMParser().parseFromString(xml,"application/xml"); items=[...doc.querySelectorAll("item")].slice(0,5).map(n=>({title:cleanText(n.querySelector("title")?.textContent||""),desc:cleanText(n.querySelector("description")?.textContent||"")})); }catch{} }
  newsItems=items; renderNews();
}
function renderNews(){ const cont=document.getElementById("news-carousel"); cont.innerHTML=""; newsItems.forEach((n,i)=>{const d=document.createElement("div"); d.className="news-card"+(i===currentNews?" active":""); d.innerHTML=`<div>${n.title}</div><div>${n.desc}</div>`; cont.appendChild(d);});}
function nextNews(){if(newsItems.length){currentNews=(currentNews+1)%newsItems.length; renderNews();}}

// === Ticker ===
function updateTicker(){
  const slot=document.getElementById("ticker-slot");
  const pool=[`${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})} • ${tickerData.timeWeather}`,tickerData.saint,tickerData.horoscope,tickerData.traffic].filter(Boolean);
  if(!pool.length){slot.textContent="Chargement…";return;}
  slot.textContent=pool[tickerIndex%pool.length]; tickerIndex++;
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
  setInterval(()=>{updateTicker();setLastUpdate();},10000);
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
    refreshSaint()
  ]);
  updateTicker();
  setLastUpdate();
  startLoops();
})();
