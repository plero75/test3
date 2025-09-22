// -----------------------------------------------------------------------------
// Tableau d'affichage – Hippodrome Paris-Vincennes (version IDFM + widgets animés)
// -----------------------------------------------------------------------------

const PROXY = "https://ratp-proxy.hippodrome-proxy42.workers.dev/?url=";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=48.835&longitude=2.45&current_weather=true";
const RSS_URL = "https://www.francetvinfo.fr/titres.rss";

const STOP_IDS = {
  RER_A: "STIF:StopArea:SP:43135:",
  JOINVILLE: "STIF:StopArea:SP:70640:",
  HIPPODROME: "STIF:StopArea:SP:463641:",
  BREUIL: "STIF:StopArea:SP:463644:"
};

const VELIB_STATIONS = {
  VINCENNES: "12163",
  BREUIL: "12128"
};

const WEATHER_CODES = {
  0: "Ciel dégagé", 1: "Principalement clair", 2: "Partiellement nuageux", 3: "Couvert",
  45: "Brouillard", 48: "Brouillard givrant",
  51: "Bruine faible", 53: "Bruine", 55: "Bruine forte",
  61: "Pluie faible", 63: "Pluie modérée", 65: "Pluie forte",
  80: "Averses faibles", 81: "Averses modérées", 82: "Fortes averses",
  95: "Orages", 96: "Orages grêle", 99: "Orages grêle"
};

let newsItems = [];
let currentNews = 0;

// -------------------- Utils --------------------
async function fetchJSON(url, timeout = 10000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    console.error("fetchJSON", url, e);
    return null;
  }
}

async function fetchText(url, timeout = 10000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error(r.status);
    return await r.text();
  } catch (e) {
    console.error("fetchText", url, e);
    return null;
  }
}

function minutesFromISO(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}

function formatClockTime(iso) {
  if (!iso) return "--";
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// -------------------- RER / BUS --------------------
function parseStop(data) {
  const visits = data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit || [];
  return visits.map(v => {
    const mv = v.MonitoredVehicleJourney || {};
    const call = mv.MonitoredCall || {};
    return {
      line: (mv.LineRef?.value || "").split(":").pop(),
      dest: call.DestinationDisplay?.[0]?.value || mv.DestinationName?.[0]?.value || "Destination",
      minutes: minutesFromISO(call.ExpectedDepartureTime),
    };
  });
}

function groupByDestination(visits) {
  const map = new Map();
  visits.forEach(v => {
    const key = v.dest.toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(v);
  });
  return Array.from(map.values()).map(list => ({
    dest: list[0].dest,
    line: list[0].line,
    times: list.map(v => v.minutes).filter(m => m !== null).slice(0, 3)
  }));
}

function renderTimeBox(minutes) {
  const span = document.createElement("span");
  span.className = "time-box";
  span.textContent = minutes === 0 ? "0" : minutes;
  return span;
}

function renderBoard(container, groups) {
  container.innerHTML = "";
  groups.forEach(g => {
    const row = document.createElement("div");
    row.className = "rer-row";

    const pill = document.createElement("span");
    pill.className = "line-pill";
    pill.style.background = g.line === "C01742" ? "#e6002e" : "#2450a4"; // Rouge pour RER A
    pill.textContent = g.line === "C01742" ? "A" : g.line;
    row.appendChild(pill);

    const dest = document.createElement("div");
    dest.className = "rer-destination";
    dest.textContent = g.dest;
    row.appendChild(dest);

    g.times.forEach(m => row.appendChild(renderTimeBox(m)));
    container.appendChild(row);
  });
}

// -------------------- Vélib --------------------
async function refreshVelib() {
  for (const [key, id] of Object.entries(VELIB_STATIONS)) {
    const url = `https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/velib-disponibilite-en-temps-reel/records?where=stationcode=${id}&limit=1`;
    const data = await fetchJSON(url);
    const st = data?.results?.[0];
    if (!st) continue;
    const container = document.getElementById(`velib-${key.toLowerCase()}`);
    container.innerHTML = `
      <div class="icon">🚲</div>
      <div class="value">${st.mechanical_bikes || 0} méca</div>
      <div class="icon">🔌</div>
      <div class="value">${st.ebike_bikes || 0} élec</div>
      <div class="icon">🅿️</div>
      <div class="value">${st.numdocksavailable || 0} bornes</div>
    `;
  }
}

// -------------------- Courses --------------------
async function refreshCourses() {
  const date = new Date();
  const pmu = `${String(date.getDate()).padStart(2, "0")}${String(date.getMonth() + 1).padStart(2, "0")}${date.getFullYear()}`;
  const url = PROXY + encodeURIComponent(`https://offline.turfinfo.api.pmu.fr/rest/client/7/programme/${pmu}`);
  const data = await fetchJSON(url);
  const courses = [];
  data?.programme?.reunions?.forEach(r => {
    if (r.hippodrome?.code === "VIN") {
      r.courses?.forEach(c => {
        courses.push({
          heure: formatClockTime(c.heureDepart),
          nom: c.libelle,
          dist: c.distance,
          disc: c.discipline,
          dot: c.montantPrix
        });
      });
    }
  });

  const container = document.getElementById("courses-list");
  container.innerHTML = "";
  courses.forEach(c => {
    const div = document.createElement("div");
    div.className = "course-card";
    div.innerHTML = `
      <div class="course-time">${c.heure}</div>
      <div class="course-name">${c.nom}</div>
      <div class="course-meta">🏇 ${c.dist}m • ${c.disc} • 💰 ${c.dot}€</div>
    `;
    container.appendChild(div);
  });
}

// -------------------- News --------------------
async function refreshNews() {
  const xml = await fetchText(PROXY + encodeURIComponent(RSS_URL));
  const items = [];
  if (xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    doc.querySelectorAll("item").forEach((node, i) => {
      if (i < 5) items.push({
        title: node.querySelector("title")?.textContent || "",
        desc: node.querySelector("description")?.textContent || "",
        source: node.querySelector("source")?.textContent || "France Info"
      });
    });
  }
  newsItems = items;
  renderNews();
}

function renderNews() {
  const container = document.getElementById("news-carousel");
  container.innerHTML = "";
  newsItems.forEach((n, i) => {
    const div = document.createElement("div");
    div.className = "news-item" + (i === currentNews ? " active" : "");
    div.innerHTML = `<div class="news-title">${n.title}</div><div class="news-desc">${n.desc}</div>`;
    container.appendChild(div);
  });
}

function nextNews() {
  if (!newsItems.length) return;
  currentNews = (currentNews + 1) % newsItems.length;
  renderNews();
}

// -------------------- Weather --------------------
async function refreshWeather() {
  const data = await fetchJSON(WEATHER_URL);
  const tempEl = document.getElementById("weather-temp");
  const descEl = document.getElementById("weather-desc");
  if (!data?.current_weather) {
    tempEl.textContent = "--°"; descEl.textContent = "Météo indisponible"; return;
  }
  const { temperature, weathercode } = data.current_weather;
  tempEl.textContent = `${Math.round(temperature)}°`;
  descEl.textContent = WEATHER_CODES[weathercode] || "Conditions actuelles";
}

// -------------------- Horloge --------------------
function setClock() {
  document.getElementById("clock").textContent =
    new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// -------------------- Main refresh --------------------
async function refreshTransport() {
  const [rerRaw, busRaw, hippoRaw, breuilRaw] = await Promise.all([
    fetchJSON(PROXY + encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.RER_A}`)),
    fetchJSON(PROXY + encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.JOINVILLE}`)),
    fetchJSON(PROXY + encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.HIPPODROME}`)),
    fetchJSON(PROXY + encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.BREUIL}`))
  ]);

  const rerGroups = groupByDestination(parseStop(rerRaw));
  renderBoard(document.getElementById("rer-body"), rerGroups);

  const busGroups = groupByDestination(parseStop(busRaw).concat(parseStop(hippoRaw)).concat(parseStop(breuilRaw)));
  renderBoard(document.getElementById("bus-blocks"), busGroups);
}

// -------------------- Init --------------------
async function init() {
  setClock();
  await Promise.all([
    refreshTransport(),
    refreshWeather(),
    refreshVelib(),
    refreshCourses(),
    refreshNews()
  ]);
  setInterval(refreshTransport, 60000);
  setInterval(refreshWeather, 1800000);
  setInterval(refreshVelib, 180000);
  setInterval(refreshCourses, 300000);
  setInterval(refreshNews, 900000);
  setInterval(nextNews, 10000);
  setInterval(setClock, 1000);
}
init();
