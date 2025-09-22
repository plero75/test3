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

// Pour stop-monitoring (horaires dynamiques)
const LINES_NAVITIA = {
  RER_A: "C01742",
  BUS_77: "C02251",
  BUS_201: "C01219"
};

// Pour general-message (trafic perturbé)
const LINES_SIRI = {
  RER_A: "STIF:Line::A:",
  BUS_77: "STIF:Line::77:",
  BUS_201: "STIF:Line::201:"
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

// === Stops parsing ===
function parseStop(data){
  const visits=data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit;
  if(!Array.isArray(visits)) return [];
  return visits.map(v=>{
    const mv=v.MonitoredVehicleJourney||{}; const call=mv.MonitoredCall||{};
    const lineRef=mv.LineRef?.value||mv.LineRef||""; const lineId=(lineRef.match(/C\d{5}/)||[null])[0];
    const destDisplay=cleanText(call.DestinationDisplay?.[0]?.value||"");
    const expected=call.ExpectedDepartureTime||call.ExpectedArrivalTime||null;
    return { lineId, dest: destDisplay, minutes: minutesFromISO(expected) };
  });
}

// === RER ===
async function renderRer(){
  const data=await fetchJSON(PROXY+encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.RER_A}`));
  const visits=parseStop(data).filter(v=>/paris|nation|châtelet|haussmann/i.test(v.dest||"")).slice(0,6);
  const cont=document.getElementById("rer-body");
  cont.innerHTML="";
  visits.forEach(v=>{
    const row=document.createElement("div"); row.className="row";
    const pill=document.createElement("span"); pill.className="line-pill rer-a"; pill.textContent="A"; row.appendChild(pill);
    const dest=document.createElement("div"); dest.className="dest"; dest.textContent=v.dest; row.appendChild(dest);
    const time=document.createElement("div"); time.className="times"; time.textContent=(v.minutes!=null?`${v.minutes} min`:"--"); row.appendChild(time);
    cont.appendChild(row);
  });
}

// === BUS par arrêt ===
async function renderBusByStop() {
  const stops = [
    { id: STOP_IDS.HIPPODROME, name: "Hippodrome de Vincennes" },
    { id: STOP_IDS.BREUIL, name: "École du Breuil" },
    { id: STOP_IDS.JOINVILLE, name: "Joinville-le-Pont" }
  ];

  const container = document.getElementById("bus-blocks");
  container.innerHTML = "";

  for (const stop of stops) {
    const data = await fetchJSON(PROXY + encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${stop.id}`));
    const visits = parseStop(data);
    if (!visits.length) continue;

    const block = document.createElement("div");
    block.className = "bus-stop-block";
    block.innerHTML = `<h3 class="bus-stop-title">🚏 ${stop.name}</h3>`;

    const byLine = {};
    visits.forEach(v => {
      if (!byLine[v.lineId]) byLine[v.lineId] = [];
      byLine[v.lineId].push(v);
    });

    for (const [lineId, rows] of Object.entries(byLine)) {
      const meta = await fetchLineMetadata(lineId);
      const lineHeader = document.createElement("div");
      lineHeader.className = "bus-line-header";
      lineHeader.innerHTML = `<span class="line-pill" style="background:${meta.color};color:${meta.textColor}">${meta.code}</span>`;
      block.appendChild(lineHeader);

      rows.slice(0, 4).forEach(r => {
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML = `<div class="dest">${r.dest}</div><div class="times">${r.minutes != null ? r.minutes + " min" : "--"}</div>`;
        block.appendChild(row);
      });
    }
    container.appendChild(block);
  }
}

// === Itinéraire optimal Joinville ===
async function computeBestRouteJoinville(){
  const el=document.getElementById("best-route"); if(!el) return;
  const hippo=await fetchJSON(PROXY+encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.HIPPODROME}`));
  const visits=parseStop(hippo);
  const busNext=visits.filter(v=>/C02251|C01219/.test(v.lineId||"")).sort((a,b)=>(a.minutes||99)-(b.minutes||99))[0];
  const nextBusMin = Number.isFinite(busNext?.minutes)? Math.max(0,busNext.minutes) : null;

  const MARCHE=15, VELIB=6, BUS_TRAVEL=5;
  let velibOK=false;
  try{
    const d=await fetchJSON(`https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/velib-disponibilite-en-temps-reel/records?where=stationcode%3D${encodeURIComponent(VELIB_STATIONS.VINCENNES)}&limit=1`);
    const st=d?.results?.[0]; velibOK = ((st?.mechanical_bikes||0)+(st?.ebike_bikes||0))>0;
  }catch{}

  const options=[
    {label:"🚶 Marche", total:MARCHE, detail:"trajet direct"},
    {label:"🚲 Vélib’", total: velibOK? VELIB : Infinity, detail: velibOK? "vélo disponible" : "aucun vélo dispo"}
  ];
  if(nextBusMin!=null) options.push({label:"🚌 Bus 77/201", total: nextBusMin+BUS_TRAVEL, detail:`attente ${nextBusMin} min + ~${BUS_TRAVEL} min`});
  options.sort((a,b)=>a.total-b.total);
  const best=options[0];

  el.innerHTML = `<div class="best-option"><span class="tag">${best.label}</span><div><strong>${best.total===Infinity? "Non recommandé" : best.total+" min"}</strong> • ${best.detail}</div></div>`;
}

// === Horoscope ===
const SIGNS = [
  { fr: "Bélier", en: "Aries" },
  { fr: "Taureau", en: "Taurus" },
  { fr: "Gémeaux", en: "Gemini" },
  { fr: "Cancer", en: "Cancer" },
  { fr: "Lion", en: "Leo" },
  { fr: "Vierge", en: "Virgo" },
  { fr: "Balance", en: "Libra" },
  { fr: "Scorpion", en: "Scorpio" },
  { fr: "Sagittaire", en: "Sagittarius" },
  { fr: "Capricorne", en: "Capricorn" },
  { fr: "Verseau", en: "Aquarius" },
  { fr: "Poissons", en: "Pisces" }
];
let signIdx = 0;

async function fetchHoroscope(signEn) {
  const target = `https://horoscope-app-api.vercel.app/api/v1/get-horoscope/daily?sign=${signEn}&day=today`;
  const url = PROXY + encodeURIComponent(target);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data?.data?.horoscope_data || "Horoscope indisponible.";
  } catch (e) {
    console.error("fetchHoroscope", signEn, e);
    return "Erreur horoscope";
  }
}

async function refreshHoroscopeCycle() {
  const { fr, en } = SIGNS[signIdx];
  const text = await fetchHoroscope(en);
  tickerData.horoscope = `🔮 ${fr} : ${text}`;
  signIdx = (signIdx + 1) % SIGNS.length;
}


// === Saint du jour ===
async function refreshSaint(){
  try{ const data=await fetchJSON("https://nominis.cef.fr/json/nominis.php",10000); if(data?.response?.prenoms) tickerData.saint=`🎂 Ste ${data.response.prenoms}`; }
  catch{ tickerData.saint="🎂 Fête indisponible"; }
}

// === Météo ===
function weatherEmojiFromCode(code){ if([0,1].includes(code)) return "☀️"; if([2,3].includes(code)) return "⛅"; if([61,63,65,80,81,82].includes(code)) return "🌧️"; if([95,96,99].includes(code)) return "⛈️"; if([45,48].includes(code)) return "🌫️"; return "🌤️"; }
async function refreshWeather(){
  const data=await fetchJSON(WEATHER_URL,10000);
  const t=document.getElementById("weather-temp"), d=document.getElementById("weather-desc"), e=document.getElementById("weather-emoji");
  if(!data?.current_weather){ if(t) t.textContent="--°"; return; }
  const { temperature, weathercode }=data.current_weather;
  const temp=`${Math.round(temperature)}°C`; const desc=WEATHER_CODES[weathercode]||""; const ico=weatherEmojiFromCode(weathercode);
  if(t) t.textContent=temp; if(d) d.textContent=desc; if(e) e.textContent=ico;
  tickerData.timeWeather=`${ico} ${temp} (${desc})`;
}

// === Vélib ===
async function refreshVelib(){
  for(const [key,stationId] of Object.entries(VELIB_STATIONS)){
    try{
      const d=await fetchJSON(`https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/velib-disponibilite-en-temps-reel/records?where=stationcode%3D${encodeURIComponent(stationId)}&limit=1`);
      const st=d?.results?.[0]; const el=document.getElementById(`velib-${key.toLowerCase()}`); if(!el) continue;
      if(!st){ el.textContent="Indispo"; continue; }
      const mech=st.mechanical_bikes||0, ebike=st.ebike_bikes||0, docks=st.numdocksavailable||0;
      el.innerHTML=`🚲${mech} 🔌${ebike} 🅿️${docks}`;
    }catch{}
  }
}

// === Actus ===
async function refreshNews(){
  const xml=await fetchText(PROXY+encodeURIComponent(RSS_URL),15000); let items=[];
  if(xml){ try{ const doc=new DOMParser().parseFromString(xml,"application/xml"); const nodes=[...doc.querySelectorAll("item")].slice(0,6); items=nodes.map(n=>({title:cleanText(n.querySelector("title")?.textContent||""),desc:cleanText(n.querySelector("description")?.textContent||"")})); }catch{} }
  newsItems=items; renderNews();
}
function renderNews(){ const cont=document.getElementById("news-carousel"); if(!cont) return; cont.innerHTML=""; if(!newsItems.length){ cont.textContent="Aucune actu"; return; } newsItems.forEach((n,i)=>{ const d=document.createElement("div"); d.className="news-card"+(i===currentNews?" active":""); d.innerHTML=`<div class="news-title">${n.title}</div><div class="news-desc">${n.desc}</div>`; cont.appendChild(d); }); }
function nextNews(){ if(newsItems.length){ currentNews=(currentNews+1)%newsItems.length; renderNews(); } }

// === Courses Vincennes ===
async function getVincennesCoursesToday(){
  const d=new Date(); const pmu=`${String(d.getDate()).padStart(2,"0")}${String(d.getMonth()+1).padStart(2,"0")}${d.getFullYear()}`;
  const url=PROXY+encodeURIComponent(`https://offline.turfinfo.api.pmu.fr/rest/client/7/programme/${pmu}`);
  const data=await fetchJSON(url,15000); const res=[];
  if(data?.programme?.reunions){ data.programme.reunions.forEach(reunion=>{ if(reunion.hippodrome?.code!=="VIN") return; reunion.courses?.forEach(course=>{ const start=new Date(course.heureDepart); if(!isNaN(start)){ res.push({heure:start.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),nom:course.libelle}); } }); }); }
  return res;
}
async function refreshCourses(){ const courses=await getVincennesCoursesToday(); const cont=document.getElementById("courses-list"); cont.innerHTML=""; courses.forEach(c=>{ const row=document.createElement("div"); row.textContent=`${c.heure} – ${c.nom}`; cont.appendChild(row); }); }

// === Trafic routier (via data.gouv Sytadin) ===
async function refreshRoad() {
  try {
    const url = PROXY + encodeURIComponent(
      "https://opendata.paris.fr/api/records/1.0/search/?dataset=comptages-routiers-permanents&sort=-horodate&rows=5"
    );
    const data = await fetchJSON(url, 15000);
    const cont = document.getElementById("road-list");
    cont.innerHTML = "";
    if (!data || !data.records) throw new Error("Pas de données trafic");

    data.records.forEach(rec => {
      const fields = rec.fields;
      const libelle = fields.libelle || "Inconnu";
      const debit = fields.debit || "-";
      const taux = fields.taux_occupation || fields.taux_occupation_htps || "-";
      const hd = fields.horodate;  // champ horodate probable
      const horodate = hd ? new Date(hd).toLocaleString("fr-FR",{ hour:"2-digit",minute:"2-digit"}) : "";

      const div = document.createElement("div");
      div.textContent = `${libelle} • débit: ${debit} véhicules/h • taux: ${taux}% • ${horodate}`;
      cont.appendChild(div);
    });
  } catch (e) {
    console.error("refreshRoad", e);
    const cont = document.getElementById("road-list");
    if (cont) cont.textContent = "Trafic routier indisponible 🚧";
  }
}


// === Messages trafic (IDFM GeneralMessage) ===
async function fetchGeneralMessages() {
  const msgs = [];
const ids = Object.values(LINES_SIRI);

  await Promise.all(ids.map(async (lineRef) => {
    const url = PROXY + encodeURIComponent(
      `https://prim.iledefrance-mobilites.fr/marketplace/general-message?LineRef=${lineRef}`
    );
    const data = await fetchJSON(url, 12000);

    const deliveries = data?.Siri?.ServiceDelivery?.GeneralMessageDelivery || [];
    deliveries.forEach(del => {
      (del.InfoMessage || []).forEach(msg => {
        const txt =
          cleanText(msg?.Content?.Message?.[0]?.MessageText?.[0]?.value ||
                    msg?.Content?.Message?.MessageText?.value ||
                    msg?.Description || "");
        if (txt) msgs.push(`[${lineRef}] ${txt}`);
      });
    });
  }));

  const banner = document.getElementById("traffic-banner");
  if (!banner) return;

  if (!msgs.length) {
    banner.className = "traffic-banner ok";
    banner.textContent = "Trafic normal sur les lignes suivies.";
    tickerData.traffic = "✅ Trafic normal";
  } else {
    banner.className = "traffic-banner alert";
    banner.textContent = msgs.join("  •  ");
    tickerData.traffic = `⚠️ ${msgs[0]}`;
  }
}
// === Événements affectant la circulation parisienne ===
async function refreshEventsCirculation() {
  try {
    const url = PROXY + encodeURIComponent(
      "https://opendata.paris.fr/api/records/1.0/search/?dataset=circulation_evenement&sort=-datedebut&rows=5"
    );
    const data = await fetchJSON(url, 15000);
    const cont = document.getElementById("events-list");
    cont.innerHTML = "";
    if (!data || !data.records) throw new Error("Pas de données événements");

    data.records.forEach(rec => {
      const f = rec.fields;
      const titre = f.objet || "Événement circulation";
      const debut = f.datedebut ? new Date(f.datedebut).toLocaleDateString("fr-FR") : "";
      const fin = f.datefin ? new Date(f.datefin).toLocaleDateString("fr-FR") : "";
      const secteur = f.localisation || "";

      const div = document.createElement("div");
      div.textContent = `${titre} • ${secteur} (${debut} → ${fin})`;
      cont.appendChild(div);
    });
  } catch (e) {
    console.error("refreshEventsCirculation", e);
    const cont = document.getElementById("events-list");
    if (cont) cont.textContent = "Événements circulation indisponibles 🚧";
  }
}

    data.records.forEach(record => {
      const fields = record.fields;
      const desc = fields.description || fields.type || "Événement";
      const rue = fields.rue || "";
      const dateDebut = fields.date_debut;
      const dateFin = fields.date_fin;
      // Formater les heures
      const debut = dateDebut ? new Date(dateDebut).toLocaleString("fr-FR",{ hour:"2-digit",minute:"2-digit"}) : "";
      const fin = dateFin ? new Date(dateFin).toLocaleString("fr-FR",{ hour:"2-digit",minute:"2-digit"}) : "";

      const div = document.createElement("div");
      div.className = "event-row";
      div.textContent = `${desc} ${rue ? "– " + rue : ""} (${debut}${fin ? " → " + fin : ""})`;
      cont.appendChild(div);
    });
  } catch (e) {
    console.error("refreshEventsCirculation", e);
    const cont = document.getElementById("events-circulation-list");
    if (cont) cont.textContent = "Informations circulation indisponibles.";
  }
}

// === Ticker (alterne météo/heure, fête, horoscope, trafic) ===
function updateTicker(){
  const slot = document.getElementById("ticker-slot");
  if (!slot) return;
  const pool = [
    `${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})} • ${tickerData.timeWeather}`.trim(),
    tickerData.saint,
    tickerData.horoscope,
    tickerData.traffic
  ].filter(Boolean);

  if (!pool.length) {
    slot.textContent = "Chargement…";
    return;
  }
  slot.classList.remove("fade-in");
  // petit reflow pour relancer l’anim CSS
  // eslint-disable-next-line no-unused-expressions
  slot.offsetHeight;
  slot.textContent = pool[tickerIndex % pool.length];
  slot.classList.add("fade-in");
  tickerIndex++;
}

// === Boucles ===
function startLoops(){
  setInterval(setClock, 1000);

  setInterval(renderRer, 60 * 1000);
  setInterval(renderBusByStop, 60 * 1000);

  setInterval(computeBestRouteJoinville, 120 * 1000);

  setInterval(refreshVelib, 3 * 60 * 1000);
  setInterval(refreshWeather, 30 * 60 * 1000);
  setInterval(refreshCourses, 5 * 60 * 1000);
  setInterval(refreshNews, 15 * 60 * 1000);
  setInterval(nextNews, 12 * 1000);
  setInterval(refreshEventsCirculation, 5 * 60 * 1000);

  setInterval(refreshHoroscopeCycle, 5 * 1000);
  setInterval(fetchGeneralMessages, 5 * 60 * 1000);

  setInterval(() => { updateTicker(); setLastUpdate(); }, 10 * 1000);
}

// === Init ===

// dans startLoops
setInterval(refreshEventsCirculation, 5 * 60 * 1000);

(async function init(){
  setClock();

  await Promise.allSettled([
    renderRer(),
    renderBusByStop(),
    computeBestRouteJoinville(),
    refreshEventsCirculation(),
    refreshVelib(),
    refreshWeather(),
    refreshCourses(),
    refreshNews(),  // remplit le carrousel actus
    refreshHoroscopeCycle(),
    refreshSaint(),
    fetchGeneralMessages(),
    refreshRoad()
  ]);

  updateTicker();
  setLastUpdate();
  startLoops();
})();
