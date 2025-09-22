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

// === Configuration des arrêts ===
const STOP_CONFIG = {
  rer: {
    id: "rer",
    name: "RER A – Joinville-le-Pont",
    stopId: STOP_IDS.RER_A,
    lines: [LINES_NAVITIA.RER_A],
    trafficLines: [LINES_SIRI.RER_A],
    maxDepartures: 6
  },
  joinville: {
    id: "bus-joinville",
    name: "Bus – Joinville-le-Pont",
    stopId: STOP_IDS.JOINVILLE,
    lines: [],
    trafficLines: [],
    maxDepartures: 4
  },
  hippodrome: {
    id: "bus-hippodrome", 
    name: "Bus – Hippodrome de Vincennes",
    stopId: STOP_IDS.HIPPODROME,
    lines: [LINES_NAVITIA.BUS_77, LINES_NAVITIA.BUS_201],
    trafficLines: [LINES_SIRI.BUS_77, LINES_SIRI.BUS_201],
    maxDepartures: 4
  },
  breuil: {
    id: "bus-breuil",
    name: "Bus – École du Breuil", 
    stopId: STOP_IDS.BREUIL,
    lines: [],
    trafficLines: [],
    maxDepartures: 4
  }
};

// === État ===
const lineMetaCache = new Map();
const trafficCache = new Map();
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

// === Référentiel lignes ===
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

// === Parseur horaires ===
function parseStop(data){
  const visits=data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit;
  if(!Array.isArray(visits)) return [];
  return visits.map(v=>{
    const mv=v.MonitoredVehicleJourney||{}; const call=mv.MonitoredCall||{};
    const lineRef=mv.LineRef?.value||mv.LineRef||""; const lineId=(lineRef.match(/C\d{5}/)||[null])[0];
    const destDisplay=cleanText(call.DestinationDisplay?.[0]?.value||"");
    const aimedTime = call.AimedDepartureTime || call.AimedArrivalTime;
    const expectedTime = call.ExpectedDepartureTime || call.ExpectedArrivalTime;
    const cancelled = mv.Cancelled === "true" || call.DepartureStatus === "cancelled";

    return { 
      lineId, 
      dest: destDisplay, 
      aimedTime,
      expectedTime: expectedTime || aimedTime,
      minutes: minutesFromISO(expectedTime || aimedTime),
      delay: expectedTime && aimedTime ? Math.round((new Date(expectedTime) - new Date(aimedTime))/60000) : 0,
      cancelled,
      vehicleMode: mv.VehicleMode?.[0] || "bus"
    };
  });
}

// === Formatage des horaires ===
function formatDeparture(departure) {
  const { aimedTime, expectedTime, minutes, delay, cancelled } = departure;

  if (cancelled) {
    return {
      timeDisplay: "Supprimé",
      countdown: "❌",
      statusClass: "cancelled",
      statusText: "Supprimé"
    };
  }

  if (minutes === null || minutes < 0) {
    return {
      timeDisplay: "--:--",
      countdown: "--",
      statusClass: "unknown",
      statusText: "Horaire indisponible"
    };
  }

  if (minutes <= 1) {
    return {
      timeDisplay: new Date(expectedTime).toLocaleTimeString("fr-FR", {hour:"2-digit", minute:"2-digit"}),
      countdown: "🟢",
      statusClass: "imminent",
      statusText: "À l\'approche"
    };
  }

  const timeDisplay = new Date(expectedTime).toLocaleTimeString("fr-FR", {hour:"2-digit", minute:"2-digit"});
  const delayText = delay > 2 ? `⏳ +${delay} min` : "";
  const statusClass = delay > 2 ? "delayed" : minutes > 90 ? "normal" : "soon";

  return {
    timeDisplay,
    scheduledDisplay: aimedTime && delay > 2 ? new Date(aimedTime).toLocaleTimeString("fr-FR", {hour:"2-digit", minute:"2-digit"}) : null,
    countdown: `${minutes} min`,
    statusClass,
    statusText: delayText || (minutes <= 90 ? "Dans les temps" : "")
  };
}

// === Rendu d'un bloc de transport ===
async function renderTransportBlock(config) {
  const { id, stopId, maxDepartures } = config;
  const board = document.getElementById(`${id}-board`);
  const serviceInfo = document.getElementById(`${id}-service-info`);
  const trafficStatus = document.getElementById(`${id}-traffic-status`);

  if (!board) return;

  try {
    board.innerHTML = '<div class="loading">Chargement des horaires...</div>';

    const data = await fetchJSON(PROXY + encodeURIComponent(
      `https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${stopId}`
    ));

    const departures = parseStop(data);

    if (!departures.length) {
      board.innerHTML = '<div class="no-service">🟡 Service terminé ou aucun passage prévu</div>';
      updateTrafficStatus(trafficStatus, null);
      return;
    }

    // Filtrage spécial pour RER A
    let filteredDepartures = departures;
    if (id === "rer") {
      filteredDepartures = departures.filter(d => 
        /paris|nation|châtelet|haussmann|auber|charles|défense|cergy|poissy/i.test(d.dest || "")
      );
    }

    // Grouper par destination et ligne
    const grouped = groupDeparturesByDestination(filteredDepartures.slice(0, maxDepartures));

    board.innerHTML = Object.entries(grouped)
      .map(([destination, deps]) => renderDestinationGroup(destination, deps, id))
      .join('');

    // Mise à jour des informations de service
    await updateServiceInfo(serviceInfo, config, departures);

    // Mise à jour du statut trafic
    const trafficMessage = await getTrafficMessage(config.trafficLines);
    updateTrafficStatus(trafficStatus, trafficMessage);

  } catch (error) {
    console.error(`Error rendering ${id}:`, error);
    board.innerHTML = '<div class="error">❌ Erreur lors du chargement des horaires</div>';
    updateTrafficStatus(trafficStatus, { type: "error", text: "Erreur de chargement" });
  }
}

// === Mise à jour du statut trafic ===
function updateTrafficStatus(trafficStatus, trafficMessage) {
  if (!trafficStatus) return;

  if (!trafficMessage) {
    trafficStatus.textContent = "";
    trafficStatus.className = "traffic-status normal";
    return;
  }

  trafficStatus.textContent = trafficMessage.text;
  trafficStatus.className = `traffic-status ${trafficMessage.type}`;
}

// === Groupement par destination ===
function groupDeparturesByDestination(departures) {
  const grouped = {};
  departures.forEach(dep => {
    const key = dep.dest || "Destination inconnue";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(dep);
  });

  // Trier chaque groupe par heure de passage
  Object.values(grouped).forEach(group => {
    group.sort((a, b) => (a.minutes || 999) - (b.minutes || 999));
  });

  return grouped;
}

// === Rendu d'un groupe de destination ===
function renderDestinationGroup(destination, departures, blockId) {
  const isRer = blockId === "rer";

  return `
    <div class="departure-group">
      <div class="destination-header">${destination}</div>
      ${departures.map(dep => renderDeparture(dep, isRer)).join('')}
    </div>
  `;
}

// === Rendu d'un départ ===
function renderDeparture(departure, isRer = false) {
  const formatted = formatDeparture(departure);
  const lineClass = getLineClass(departure.lineId, isRer);
  const lineName = getLineName(departure.lineId, isRer);

  return `
    <div class="departure-row">
      <div class="line-badge ${lineClass}">${lineName}</div>
      <div class="departure-info">
        <div class="time-info">
          ${formatted.scheduledDisplay ? `<span class="scheduled-time">${formatted.scheduledDisplay}</span>` : ''}
          <span class="estimated-time">${formatted.timeDisplay}</span>
          <span class="countdown">${formatted.countdown}</span>
        </div>
        ${formatted.statusText ? `<div class="status-indicator ${formatted.statusClass}">${formatted.statusText}</div>` : ''}
      </div>
    </div>
  `;
}

// === Utilitaires ligne ===
function getLineClass(lineId, isRer) {
  if (isRer) return "rer-a";
  if (lineId === LINES_NAVITIA.BUS_77) return "bus-77";
  if (lineId === LINES_NAVITIA.BUS_201) return "bus-201";
  return "bus-other";
}

function getLineName(lineId, isRer) {
  if (isRer) return "A";
  if (lineId === LINES_NAVITIA.BUS_77) return "77";
  if (lineId === LINES_NAVITIA.BUS_201) return "201";
  return lineId ? lineId.substring(1) : "?";
}

// === Mise à jour des infos de service ===
async function updateServiceInfo(serviceInfo, config, departures) {
  if (!serviceInfo) return;

  // Lignes desservies
  const uniqueLines = [...new Set(departures.map(d => d.lineId).filter(Boolean))];
  const linesText = uniqueLines.length > 0 ? `Lignes: ${uniqueLines.map(id => getLineName(id, config.id === "rer")).join(', ')}` : '';

  // Horaires de service (premier/dernier passage)
  const serviceHours = getServiceHours();

  serviceInfo.innerHTML = `
    ${linesText ? `<div class="lines-served">${linesText}</div>` : ''}
    ${serviceHours ? `<div class="service-hours">${serviceHours}</div>` : ''}
  `;
}

// === Horaires de service ===
function getServiceHours() {
  const now = new Date();
  const hours = now.getHours();

  if (hours >= 1 && hours < 5) {
    return "🔴 Service réduit (nuit)";
  } else if (hours >= 23 || hours < 1) {
    return "🟡 Fin de service proche";
  }

  return null; // Service normal, pas d'affichage
}

// === Messages trafic ===
async function getTrafficMessage(trafficLines) {
  if (!trafficLines || !trafficLines.length) return null;

  const messages = [];

  for (const lineRef of trafficLines) {
    const cached = trafficCache.get(lineRef);
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      if (cached.message) messages.push(cached.message);
      continue;
    }

    try {
      const url = PROXY + encodeURIComponent(
        `https://prim.iledefrance-mobilites.fr/marketplace/general-message?LineRef=${lineRef}`
      );
      const data = await fetchJSON(url, 10000);

      let message = null;
      const deliveries = data?.Siri?.ServiceDelivery?.GeneralMessageDelivery || [];

      for (const delivery of deliveries) {
        const infoMessages = delivery.InfoMessage || [];
        for (const msg of infoMessages) {
          const txt = cleanText(
            msg?.Content?.Message?.[0]?.MessageText?.[0]?.value ||
            msg?.Content?.Message?.MessageText?.value ||
            msg?.Description || ""
          );
          if (txt && !txt.toLowerCase().includes('normal')) {
            message = txt;
            break;
          }
        }
        if (message) break;
      }

      trafficCache.set(lineRef, { message, timestamp: Date.now() });
      if (message) messages.push(message);

    } catch (error) {
      console.error(`Traffic error for ${lineRef}:`, error);
      trafficCache.set(lineRef, { message: null, timestamp: Date.now() });
    }
  }

  if (messages.length === 0) return null;

  return {
    type: "disrupted",
    text: `${messages[0]}`
  };
}

// === Trajet optimal ===
async function updateOptimalRoute() {
  const walkingOption = document.getElementById("walking-option");
  const velibOption = document.getElementById("velib-option");
  const busOption = document.getElementById("bus-option");
  const velibAvail = document.getElementById("velib-availability");

  if (!walkingOption || !velibOption || !busOption) return;

  try {
    // Récupérer les prochains bus depuis l'hippodrome
    const busData = await fetchJSON(PROXY + encodeURIComponent(
      `https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.HIPPODROME}`
    ));

    const busDepartures = parseStop(busData)
      .filter(d => [LINES_NAVITIA.BUS_77, LINES_NAVITIA.BUS_201].includes(d.lineId))
      .filter(d => !d.cancelled && d.minutes !== null)
      .sort((a, b) => (a.minutes || 999) - (b.minutes || 999));

    // Vélib disponibilité
    let velibAvailable = false;
    let velibCount = 0;
    try {
      const velibData = await fetchJSON(
        `https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/velib-disponibilite-en-temps-reel/records?where=stationcode%3D${encodeURIComponent(VELIB_STATIONS.VINCENNES)}&limit=1`
      );
      const station = velibData?.results?.[0];
      velibCount = (station?.mechanical_bikes || 0) + (station?.ebike_bikes || 0);
      velibAvailable = velibCount > 0;
    } catch (e) {
      console.error("Velib error:", e);
    }

    // Mise à jour de la disponibilité Vélib
    if (velibAvail) {
      if (velibAvailable) {
        velibAvail.textContent = `${velibCount} vélo${velibCount > 1 ? 's' : ''}`;
        velibAvail.className = "availability available";
      } else {
        velibAvail.textContent = "Aucun vélo";
        velibAvail.className = "availability unavailable";
      }
    }

    // Calculer les temps
    const walkTime = 15;
    const velibTime = velibAvailable ? 7 : 999;
    const nextBus = busDepartures[0];
    const busWaitTime = nextBus ? Math.max(0, nextBus.minutes || 0) : 999;
    const busTimeTotal = nextBus ? busWaitTime + 5 : 999; // +5min de trajet

    // Retirer la classe optimal de tous
    [walkingOption, velibOption, busOption].forEach(el => {
      el.classList.remove("optimal");
    });

    // Déterminer la meilleure option
    const options = [
      { element: walkingOption, time: walkTime, type: 'walk' },
      { element: velibOption, time: velibTime, type: 'velib' },
      { element: busOption, time: busTimeTotal, type: 'bus' }
    ];

    const bestOption = options.reduce((best, current) => 
      current.time < best.time ? current : best
    );

    // Mise à jour des affichages
    walkingOption.querySelector(".route-time").textContent = `${walkTime} min`;

    if (velibAvailable) {
      velibOption.querySelector(".route-time").textContent = `${velibTime} min`;
    } else {
      velibOption.querySelector(".route-time").textContent = "Indispo";
    }

    if (nextBus && busTimeTotal < 999) {
      busOption.querySelector(".route-time").textContent = `${busTimeTotal} min`;
      const nextDepartureEl = busOption.querySelector(".next-departure");
      if (nextDepartureEl) {
        if (busWaitTime === 0) {
          nextDepartureEl.textContent = "Maintenant";
        } else {
          nextDepartureEl.textContent = `Prochain: ${busWaitTime} min`;
        }
      }
    } else {
      busOption.querySelector(".route-time").textContent = "Pas de bus";
      const nextDepartureEl = busOption.querySelector(".next-departure");
      if (nextDepartureEl) {
        nextDepartureEl.textContent = "Service terminé";
      }
    }

    // Marquer la meilleure option
    if (bestOption.time < 999) {
      bestOption.element.classList.add("optimal");
    }

  } catch (error) {
    console.error("Optimal route error:", error);
  }
}

// === Météo ===
function weatherEmojiFromCode(code){ 
  if([0,1].includes(code)) return "☀️"; 
  if([2,3].includes(code)) return "⛅"; 
  if([61,63,65,80,81,82].includes(code)) return "🌧️"; 
  if([95,96,99].includes(code)) return "⛈️"; 
  if([45,48].includes(code)) return "🌫️"; 
  return "🌤️"; 
}

async function refreshWeather(){
  const data=await fetchJSON(WEATHER_URL,10000);
  const weatherInfo = document.getElementById("weather-info");

  if(!data?.current_weather || !weatherInfo){ 
    if(weatherInfo) weatherInfo.innerHTML = '<span class="weather-icon">❓</span><span class="weather-temp">--°C</span><span class="weather-desc">Indisponible</span>';
    return; 
  }

  const { temperature, weathercode }=data.current_weather;
  const temp=`${Math.round(temperature)}°C`; 
  const desc=WEATHER_CODES[weathercode]||""; 
  const ico=weatherEmojiFromCode(weathercode);

  weatherInfo.innerHTML = `<span class="weather-icon">${ico}</span><span class="weather-temp">${temp}</span><span class="weather-desc">${desc}</span>`;
  tickerData.timeWeather=`${ico} ${temp} (${desc})`;
}

// === Horoscope ===
const SIGNS = [
  { fr: "Bélier", en: "Aries" }, { fr: "Taureau", en: "Taurus" }, { fr: "Gémeaux", en: "Gemini" },
  { fr: "Cancer", en: "Cancer" }, { fr: "Lion", en: "Leo" }, { fr: "Vierge", en: "Virgo" },
  { fr: "Balance", en: "Libra" }, { fr: "Scorpion", en: "Scorpio" }, { fr: "Sagittaire", en: "Sagittarius" },
  { fr: "Capricorne", en: "Capricorn" }, { fr: "Verseau", en: "Aquarius" }, { fr: "Poissons", en: "Pisces" }
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
  try{ 
    const data=await fetchJSON("https://nominis.cef.fr/json/nominis.php",10000); 
    if(data?.response?.prenoms) tickerData.saint=`🎂 Ste ${data.response.prenoms}`; 
  } catch{ 
    tickerData.saint="🎂 Fête indisponible"; 
  }
}

// === Trafic général ===
async function updateGeneralTraffic() {
  const generalTraffic = document.getElementById("general-traffic");
  if (!generalTraffic) return;

  // Récupérer les messages de toutes les lignes suivies
  const allMessages = [];
  const allLines = Object.values(LINES_SIRI);

  for (const lineRef of allLines) {
    const cached = trafficCache.get(lineRef);
    if (cached?.message) {
      allMessages.push(cached.message);
    }
  }

  if (allMessages.length === 0) {
    generalTraffic.innerHTML = '<span class="traffic-icon">🟢</span><span class="traffic-summary">Trafic normal sur le réseau</span>';
    tickerData.traffic = "✅ Trafic normal";
  } else {
    generalTraffic.innerHTML = `<span class="traffic-icon">⚠️</span><span class="traffic-summary">${allMessages.length} perturbation(s) détectée(s)</span>`;
    tickerData.traffic = `⚠️ ${allMessages[0]}`;
  }
}

// === Ticker ===
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
  slot.offsetHeight; // Force reflow
  slot.textContent = pool[tickerIndex % pool.length];
  slot.classList.add("fade-in");
  tickerIndex++;
}

// === Rendu de tous les blocs ===
async function renderAllTransportBlocks() {
  await Promise.allSettled([
    renderTransportBlock(STOP_CONFIG.rer),
    renderTransportBlock(STOP_CONFIG.joinville),  
    renderTransportBlock(STOP_CONFIG.hippodrome),
    renderTransportBlock(STOP_CONFIG.breuil)
  ]);
}

// === Boucles ===
function startLoops(){
  setInterval(setClock, 1000);

  setInterval(renderAllTransportBlocks, 60 * 1000);
  setInterval(updateOptimalRoute, 120 * 1000);

  setInterval(refreshWeather, 30 * 60 * 1000);
  setInterval(refreshHoroscopeCycle, 15 * 1000);
  setInterval(refreshSaint, 60 * 60 * 1000);

  setInterval(updateGeneralTraffic, 5 * 60 * 1000);
  setInterval(() => { updateTicker(); setLastUpdate(); }, 10 * 1000);
}

// === Init ===
(async function init(){
  setClock();

  await Promise.allSettled([
    renderAllTransportBlocks(),
    updateOptimalRoute(),
    refreshWeather(),
    refreshHoroscopeCycle(),
    refreshSaint()
  ]);

  updateTicker();
  setLastUpdate();
  startLoops();
})();
