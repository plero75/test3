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

// Joinville — tous bus à afficher même sans données
const JOINVILLE_DECLARED = [
  { lineCode: "101", navitiaId: null }, { lineCode: "108", navitiaId: null },
  { lineCode: "110", navitiaId: null }, { lineCode: "201", navitiaId: "C01219" },
  { lineCode: "281", navitiaId: null }, { lineCode: "317", navitiaId: null },
  { lineCode: "393", navitiaId: null }, { lineCode: "77",  navitiaId: "C02251" },
  { lineCode: "520", navitiaId: null }, // Noctilien divers possibles si tu veux les lister
];

const VELIB_STATIONS = { VINCENNES: "12163", BREUIL: "12128" };

// === État ===
let newsItems = [];
let currentNews = 0;
let tickerIndex = 0;
let tickerData = { timeWeather: "", saint: "", traffic: "" };

// === Utils ===
function decodeEntities(str=""){return str.replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#039;/gi,"'").replace(/&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").trim();}
function cleanText(str=""){return decodeEntities(str).replace(/<[^>]*>/g," ").replace(/[<>]/g," ").replace(/\s+/g," ").trim();}
async function fetchJSON(url, timeout=12000){ try{ const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout); const r=await fetch(url,{signal:c.signal, cache:"no-store"}); clearTimeout(t); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); } catch(e){ console.error("fetchJSON",url,e.message); return null; } }
async function fetchText(url, timeout=12000){ try{ const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout); const r=await fetch(url,{signal:c.signal, cache:"no-store"}); clearTimeout(t); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); } catch(e){ console.error("fetchText",url,e.message); return ""; } }
function minutesFromISO(iso){ if(!iso) return null; return Math.max(0, Math.round((new Date(iso).getTime()-Date.now())/60000)); }
function setClock(){ const d=new Date(); document.getElementById("clock").textContent=d.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}); document.getElementById("date").textContent=d.toLocaleDateString("fr-FR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"}); }
function setLastUpdate(){ const el=document.getElementById("lastUpdate"); if(el) el.textContent=`Maj ${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`; }
function hhmm(iso){ if(!iso) return "—:—"; return new Date(iso).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}); }

// === Parsing PRIM StopMonitoring ===
function parseStop(data){
  const visits=data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit;
  if(!Array.isArray(visits)) return [];
  return visits.map(v=>{
    const mv=v.MonitoredVehicleJourney||{}; const call=mv.MonitoredCall||{};
    const lineRef=mv.LineRef?.value||mv.LineRef||""; 
    const navitiaId=(lineRef.match(/C\d{5}/)||[null])[0];
    const destDisplay=cleanText(call.DestinationDisplay?.[0]?.value || call.DestinationDisplay?.value || "");
    const expected=call.ExpectedDepartureTime||call.ExpectedArrivalTime||null;
    const aimed=call.AimedDepartureTime||call.AimedArrivalTime||null;
    const statusRaw = (call.DepartureStatus || call.ArrivalStatus || "onTime").toLowerCase();
    const cancelled = statusRaw==="cancelled";
    const notServed = statusRaw==="notstopping";
    const moved = statusRaw==="moved";
    const first = call?.Extensions?.FirstOrLastJourney?.toLowerCase()==="first";
    const last  = call?.Extensions?.FirstOrLastJourney?.toLowerCase()==="last";
    const minutes = minutesFromISO(expected);
    const delay = (expected && aimed) ? Math.max(0, Math.round((new Date(expected)-new Date(aimed))/60000)) : 0;
    return { navitiaId, lineCode: mv.PublishedLineName || mv.LineName || navitiaId || "?", dest: destDisplay, minutes, expected, aimed, delay, cancelled, notServed, moved, first, last, status: statusRaw };
  });
}

// === Rendu : ligne → direction (3 prochains), minutes en gros + heure dessous, statuts neutres ===
function renderLineGroup(container, lineLabel, groups, opts={}){
  const lineEl=document.createElement("div");
  lineEl.className="line";
  lineEl.innerHTML=`<div class="line-header">${lineLabel}</div>`;
  Object.keys(groups).sort().forEach(direction=>{
    const block=document.createElement("div");
    block.className="direction";
    const title=document.createElement("div");
    title.className="dest";
    title.textContent=`Direction ${direction}`;
    block.appendChild(title);

    const rows=(groups[direction]||[])
      .sort((a,b)=>(a.minutes??9e9)-(b.minutes??9e9))
      .slice(0,3);

    if(!rows.length){
      const empty=document.createElement("div");
      empty.className="muted";
      empty.textContent= opts.emptyText || "Aucun départ pour cette direction.";
      block.appendChild(empty);
    }else{
      rows.forEach(dep=>{
        const row=document.createElement("div");
        row.className="dep-flex";

        // Attente en minutes (gros)
        const left=document.createElement("div");
        left.className="wait-col";
        const wait=document.createElement("div");
        wait.className="wait";
        wait.textContent = Number.isFinite(dep.minutes) ? `${dep.minutes} min` : "—";
        left.appendChild(wait);

        // Tags / statuts
        const tags=document.createElement("div"); tags.className="tags";
        if(dep.cancelled) tags.appendChild(tag("Supprimé","tag-supprime"));
        if(dep.notServed) tags.appendChild(tag("Non desservi","tag-non"));
        if(dep.moved) tags.appendChild(tag("Arrêt déplacé","tag-deplace"));
        if(dep.delay>0) tags.appendChild(tag(`Retard +${dep.delay} min`,"tag-retard"));
        if(dep.first) tags.appendChild(tag("Premier","tag-first"));
        if(dep.last) tags.appendChild(tag("Dernier","tag-last"));
        if(tags.childNodes.length) left.appendChild(tags);

        // Heure exacte dessous
        const right=document.createElement("div"); right.className="time-col";
        const t=document.createElement("div"); t.className="time"; t.textContent=hhmm(dep.expected);
        right.appendChild(t);
        if(dep.delay>0){
          const planned=document.createElement("div"); planned.className="note"; planned.textContent=`prévu ${hhmm(dep.aimed)}`;
          right.appendChild(planned);
        }

        row.appendChild(left); row.appendChild(right);
        block.appendChild(row);
      });
    }
    lineEl.appendChild(block);
  });
  container.appendChild(lineEl);

  function tag(text, cls){
    const s=document.createElement("span");
    s.className=`tag ${cls||""}`; s.textContent=text; return s;
  }
}

// === RER Joinville (2 affichages : ligne 1 & ligne 2) ===
async function renderRer(){
  const data=await fetchJSON(PROXY+encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.RER_A}`));
  const visits=parseStop(data);
  // Header carte (colonne ligne 1)
  const cont1=document.getElementById("rer-body");
  cont1.innerHTML="";

  // Regroupe tout (liste simple)
  visits.slice(0,6).forEach(v=>{
    const row=document.createElement("div"); row.className="row";
    const pill=document.createElement("span"); pill.className="line-pill rer-a"; pill.textContent="A";
    const dest=document.createElement("div"); dest.className="dest"; dest.textContent=v.dest||"—";
    const times=document.createElement("div"); times.className="times";
    const box=document.createElement("div"); box.className="time-box"; box.textContent=Number.isFinite(v.minutes)?`${v.minutes} min`:"—"; times.appendChild(box);
    const status=document.createElement("div"); status.className="status";
    status.textContent = v.cancelled ? "Supprimé" :
                         v.notServed ? "Non desservi" :
                         v.moved ? "Arrêt déplacé" :
                         (v.delay>0 ? `Retard +${v.delay} min` : "Normal");
    row.appendChild(pill); row.appendChild(dest); row.appendChild(times); row.appendChild(status);
    cont1.appendChild(row);
  });

  // Colonne ligne 2 : groupement par direction (3 prochains)
  const cont2=document.getElementById("rer-col");
  cont2.innerHTML="";
  const byDest={};
  visits.forEach(v=>{ const d=v.dest||"—"; (byDest[d]??=[]).push(v); });
  renderLineGroup(cont2, "RER A", byDest, { emptyText: "Aucun départ pour cette direction." });

  // Message trafic RER A (header bis local)
  const msgs=await getLineMessages([LINES_SIRI.RER_A]);
  const traf=document.getElementById("rer-traffic");
  applyTrafficSub(traf, msgs);
}

// === BUS : un arrêt (Hippodrome, Breuil) => groupement ligne→direction ===
async function renderBusForStop(stopId, bodyId, trafficId){
  const cont=document.getElementById(bodyId);
  cont.innerHTML="Chargement…";
  const data=await fetchJSON(PROXY+encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${stopId}`));
  const visits=parseStop(data);
  cont.innerHTML="";

  // Regroupe par ligne
  const byLine={};
  visits.forEach(v=>{
    const code=v.lineCode?.toString() || v.navitiaId || "?";
    (byLine[code]??=[]).push(v);
  });

  // Affiche chaque ligne → directions
  Object.keys(byLine).sort().forEach(code=>{
    const groups={};
    byLine[code].forEach(v=>{ const d=v.dest||"—"; (groups[d]??=[]).push(v); });
    renderLineGroup(cont, `Bus ${code}`, groups, { emptyText:"Aucun départ pour cette direction." });
  });

  // Messages trafic par lignes vues
  const tEl=document.getElementById(trafficId);
  applyTrafficSub(tEl, []); // si tu veux brancher /general-message ligne par ligne, mappe via LINES_SIRI
}

// === BUS : Joinville — tous bus (affichage persistant) ===
async function renderBusJoinville(){
  const cont=document.getElementById("bus-joinville-body");
  cont.innerHTML="Chargement…";
  const data=await fetchJSON(PROXY+encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.JOINVILLE}`));
  const visits=parseStop(data);
  cont.innerHTML="";

  // 1) indexe par code affiché (e.g. "77", "201", etc.)
  const byCode={};
  visits.forEach(v=>{
    const code=(v.lineCode||"").toString();
    const dest=v.dest||"—";
    const arr=(byCode[code]??={}); (arr[dest]??=[]).push(v);
  });

  // 2) s’assure que toutes les lignes attendues existent, même vides
  JOINVILLE_DECLARED.forEach(ref=>{
    if(!byCode[ref.lineCode]) byCode[ref.lineCode]={};
  });

  // 3) rendu par ligne → direction (3 prochains)
  Object.keys(byCode).sort((a,b)=>a.localeCompare(b,"fr",{numeric:true})).forEach(code=>{
    renderLineGroup(cont, `Bus ${code}`, byCode[code], { emptyText:"Aucun départ pour cette direction." });
  });

  // Messages trafic (global) pour bannière locale Joinville
  const tEl=document.getElementById("bus-joinville-traffic");
  applyTrafficSub(tEl, []); // idem : brancher /general-message si besoin par codes
}

// === Messages PRIM /general-message (bannière globale) ===
async function getLineMessages(lineRefs){
  const msgs=[];
  await Promise.all((lineRefs||[]).map(async lr=>{
    try{
      const url=PROXY+encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/general-message?LineRef=${encodeURIComponent(lr)}`);
      const data=await fetchJSON(url,12000);
      const deliveries=data?.Siri?.ServiceDelivery?.GeneralMessageDelivery||[];
      deliveries.forEach(del=>(del.InfoMessage||[]).forEach(msg=>{
        const txt=cleanText(
          msg?.Content?.Message?.[0]?.MessageText?.[0]?.value ||
          msg?.Content?.Message?.MessageText?.value || msg?.Description || ""
        );
        if(txt) msgs.push(txt);
      }));
    }catch(e){ /* ignore */ }
  }));
  return msgs;
}

function applyTrafficSub(el,msgs){
  if(!el) return;
  if(!msgs || !msgs.length){ el.style.display="none"; el.className="traffic-sub ok"; el.textContent=""; return; }
  el.style.display="block"; el.className="traffic-sub alert"; el.textContent=msgs.join(" • ");
}

async function refreshGlobalBanner(){
  const banner=document.getElementById("traffic-banner");
  const msgs=await getLineMessages([LINES_SIRI.RER_A, LINES_SIRI.BUS_77, LINES_SIRI.BUS_201]);
  if(msgs.length){ banner.textContent=msgs[0]; banner.className="traffic-banner alert"; tickerData.traffic="Perturbations en cours"; }
  else { banner.textContent="Trafic normal"; banner.className="traffic-banner ok"; tickerData.traffic="Trafic normal"; }
}

// === Météo & Saint ===
const WEATHER_CODES = { 0:"Grand soleil",1:"Ciel dégagé",2:"Éclaircies",3:"Ciel couvert",45:"Brouillard",48:"Brouillard givrant",51:"Bruine légère",53:"Bruine",55:"Forte bruine",61:"Pluie faible",63:"Pluie",65:"Pluie forte",80:"Averses",81:"Averses",82:"Forte averse",95:"Orages" };
function describeWeather(code){ return WEATHER_CODES[code] || "Météo"; }
async function refreshWeather(){
  const data=await fetchJSON(WEATHER_URL);
  if(!data?.current_weather){ document.getElementById("weather-desc").textContent="Météo indisponible"; return; }
  const {temperature,weathercode}=data.current_weather;
  document.getElementById("weather-temp").textContent=`${Math.round(temperature)}°C`;
  document.getElementById("weather-desc").textContent=describeWeather(weathercode);
  document.getElementById("weather-emoji").textContent=""; // neutre, sans émojis visuels
  tickerData.timeWeather = `${Math.round(temperature)}°C • ${describeWeather(weathercode)}`;
}
async function refreshSaint(){
  try{
    const data=await fetchJSON("https://nominis.cef.fr/json/nominis.php");
    const name=data?.response?.prenoms || "";
    document.getElementById("saint").textContent = name ? `Fête : ${name}` : "Fête du jour";
  }catch{ document.getElementById("saint").textContent="Fête du jour indisponible"; }
}

// === Vélib’ (2 stations) ===
async function refreshVelib(){
  const targets=[["VINCENNES","12163"],["BREUIL","12128"]];
  const out=[];
  for(const [label,id] of targets){
    let txt="Indispo";
    try{
      const url=`https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/velib-disponibilite-en-temps-reel/records?where=stationcode%3D${id}&limit=1`;
      const data=await fetchJSON(url,10000);
      const st=data?.results?.[0];
      if(st){
        const mech=st.mechanical_bikes||0, elec=st.ebike_bikes||0, docks=st.numdocksavailable||0;
        txt=`${label.toLowerCase()}: ${mech+elec} vélos • ${docks} bornes`;
      }
    }catch{}
    out.push(txt);
  }
  document.getElementById("velib-body").textContent = out.join(" | ");
}

// === News (France Info) ===
async function refreshNews(){
  const xml=await fetchText(PROXY+encodeURIComponent(RSS_URL));
  let items=[];
  if(xml){
    try{
      const doc=new DOMParser().parseFromString(xml,"application/xml");
      items=[...doc.querySelectorAll("item")].slice(0,5).map(n=>({
        title:cleanText(n.querySelector("title")?.textContent||""),
        desc:cleanText(n.querySelector("description")?.textContent||"")
      }));
    }catch{}
  }
  newsItems=items; renderNews();
}
function renderNews(){
  const cont=document.getElementById("news-carousel");
  cont.innerHTML="";
  if(!newsItems.length){ cont.textContent="Aucune actualité"; return; }
  newsItems.forEach((it,idx)=>{
    const card=document.createElement("div"); card.className="news-card"+(idx===currentNews?" active":"");
    card.innerHTML=`<div>${it.title}</div><div class="muted">${it.desc}</div>`; cont.appendChild(card);
  });
}
function nextNews(){ if(!newsItems.length) return; currentNews=(currentNews+1)%newsItems.length; renderNews(); }

// === Trafic routier (proximité Hippodrome) — simple proxy via open data Paris (exemple) ===
async function refreshRoadTraffic(){
  const cont=document.getElementById("road-list"); cont.textContent="Chargement…";
  try{
    const url="https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/comptages-routiers-permanents/records?limit=40&order_by=-t_1h";
    const data=await fetchJSON(url,12000); const results=data?.results||[];
    cont.innerHTML="";
    if(!results.length){ cont.innerHTML='<div class="traffic-sub ok">Pas de capteur routier proche.</div>'; return; }
    results.slice(0,4).forEach(rec=>{
      const name=(rec.libelle||"").replace(/_/g," ").trim() || "Capteur";
      const status=rec.etat_trafic||"Indisponible";
      const time=rec.t_1h? new Date(rec.t_1h).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}) : "--:--";
      const row=document.createElement("div"); row.className="road";
      row.innerHTML=`<div class="road-name">${name}</div><div class="road-meta">${status} · ${time}</div>`;
      cont.appendChild(row);
    });
  }catch{ cont.innerHTML='<div class="traffic-sub alert">Données routières indisponibles</div>'; }
}

// === Global ticker ===
function updateTicker(){
  const slot=document.getElementById("ticker-slot");
  const clock=new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
  const entries=[ `${clock} • ${tickerData.timeWeather||""}`, tickerData.saint||"", tickerData.traffic||"" ].filter(Boolean);
  slot.textContent = entries.length ? entries[tickerIndex%entries.length] : "Chargement…";
  tickerIndex++;
}

// === Bannière PRIM globale ===
async function refreshGlobal(){
  await refreshGlobalBanner();
}

// === Init & boucles ===
function startLoops(){
  setInterval(setClock, 1000);
  setInterval(renderRer, 60000);
  setInterval(()=>renderBusForStop(STOP_IDS.HIPPODROME,"bus-hippodrome-body","bus-hippodrome-traffic"),60000);
  setInterval(()=>renderBusForStop(STOP_IDS.BREUIL,"bus-breuil-body","bus-breuil-traffic"),60000);
  setInterval(renderBusJoinville, 60000);
  setInterval(refreshWeather, 30*60*1000);
  setInterval(refreshNews, 15*60*1000);
  setInterval(nextNews, 12000);
  setInterval(refreshRoadTraffic, 5*60*1000);
  setInterval(updateTicker, 10000);
  setInterval(refreshGlobal, 2*60*1000);
  setInterval(setLastUpdate, 10000);
}

(async function init(){
  setClock();
  await Promise.allSettled([
    refreshWeather(), refreshSaint(), refreshGlobal(),
    renderRer(),
    renderBusForStop(STOP_IDS.HIPPODROME,"bus-hippodrome-body","bus-hippodrome-traffic"),
    renderBusForStop(STOP_IDS.BREUIL,"bus-breuil-body","bus-breuil-traffic"),
    renderBusJoinville(),
    refreshVelib(), refreshNews(), refreshRoadTraffic()
  ]);
  updateTicker(); setLastUpdate(); startLoops();
})();
