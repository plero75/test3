// app.js - Dashboard Hippodrome Paris-Vincennes
const PROXY = "https://ratp-proxy.hippodrome-proxy42.workers.dev/?url=";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=48.835&longitude=2.45&current_weather=true";
const VELIB_URL = "https://velib-metropole-opendata.smoove.pro/opendata/Velib_Metropole/station_status.json";
const RSS_URL = "https://www.francetvinfo.fr/titres.rss";

const STOP_IDS = {
  RER_A: "STIF:StopArea:SP:43135:",
  JOINVILLE_AREA: "STIF:StopArea:SP:70640:",
  HIPPODROME: "STIF:StopArea:SP:463641:",
  BREUIL: "STIF:StopArea:SP:463644:"
};

const LINES = {
  RER_A: "line:IDFM:C01742",
  BUS_77: "line:IDFM:C02251",
  BUS_201: "line:IDFM:C01219"
};

const $ = (sel, root = document) => root.querySelector(sel);

let currentNews = 0;
let newsItems = [];
let currentInfoPanel = 0;

// --- Helpers fetch ---
async function fetchJSON(url, timeout = 10000) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(id);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch (e) {
    console.error("Fetch JSON " + url + ":", e.message);
    return null;
  }
}

async function fetchText(url, timeout = 10000) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(id);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } catch (e) {
    console.error("Fetch Text " + url + ":", e.message);
    return null;
  }
}

// --- Rendu erreurs ---
function renderError(el, message, type = "warning") {
  el.innerHTML = "";
  const div = document.createElement("div");
  div.className = "error-message";
  div.textContent = message;
  el.appendChild(div);
}

// --- Divers ---
function makeChip(text) {
  const span = document.createElement("span");
  span.className = "chip";
  span.textContent = text;
  return span;
}

function setClock() {
  const d = new Date();
  $("#clock").textContent = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function setLastUpdate() {
  const d = new Date();
  $("#lastUpdate").textContent = "Maj " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// --- Parsing Transport ---
function minutesFromISO(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}

function parseStop(data) {
  if (!data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit) {
    return null;
  }
  const visits = data.Siri.ServiceDelivery.StopMonitoringDelivery[0].MonitoredStopVisit;
  return visits.map(v => {
    const mv = v.MonitoredVehicleJourney || {};
    const call = mv.MonitoredCall || {};
    const dest = mv.DestinationName?.[0]?.value || "";
    const stop = call.StopPointName?.[0]?.value || "";
    const line = (mv.LineRef?.value || "").replace("STIF:Line:", "");
    const mins = minutesFromISO(call.ExpectedDepartureTime);
    return { line, dest, stop, minutes: mins != null ? [mins] : [] };
  });
}

function groupByDest(arr) {
  const map = {};
  arr.forEach(x => {
    const k = x.dest || "—";
    map[k] = map[k] || { destination: k, minutes: [] };
    if (x.minutes?.length) map[k].minutes.push(x.minutes[0]);
  });
  return Object.values(map).map(r => ({
    ...r,
    minutes: r.minutes.sort((a, b) => a - b).slice(0, 4)
  }));
}

function regroupRER(data) {
  const rows = parseStop(data);
  if (!rows) return null;
  return {
    directionParis: groupByDest(rows.filter(r => /paris|la défense/i.test(r.dest))),
    directionBoissy: groupByDest(rows.filter(r => /boissy|marne/i.test(r.dest)))
  };
}

// --- Render Transport ---
function renderRER(el, rows) {
  el.innerHTML = "";
  if (!rows || rows.length === 0) return;
  rows.slice(0, 3).forEach(r => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<div class="dir">${r.destination}</div><div class="times"></div>`;
    r.minutes.forEach(m => row.querySelector(".times").appendChild(makeChip(m)));
    el.append(row);
  });
}

function renderBus(el, buses, cls) {
  el.innerHTML = "";
  if (!buses || buses.length === 0) return;
  buses.slice(0, 4).forEach(b => {
    const row = document.createElement("div");
    row.className = "bus-row " + cls;
    row.innerHTML = `
      <div class="badge">${b.line || "—"}</div>
      <div class="dest">${b.dest}<div class="sub">${b.stop}</div></div>
      <div class="bus-times"></div>`;
    b.minutes.forEach(m => row.querySelector(".bus-times").appendChild(makeChip(m)));
    el.append(row);
  });
}

// --- Vélib ---
function parseVelibDetailed(data) {
  const out = {}, map = { 
    "12163": "Vincennes – Hippodrome",
    "12128": "École du Breuil / Pyramides"
  };
  if (!data?.data?.stations) return null;
  data.data.stations.forEach(st => {
    if (map[st.station_id]) {
      out[st.station_id] = {
        name: map[st.station_id],
        mechanical: st.num_bikes_available_types?.mechanical || 0,
        electric: st.num_bikes_available_types?.ebike || 0,
        docks: st.num_docks_available || 0
      };
    }
  });
  return Object.keys(out).length > 0 ? out : null;
}

function renderVelib(el, stations) {
  el.innerHTML = "";
  if (!stations) return;
  Object.entries(stations).forEach(([id, info]) => {
    const st = document.createElement("div");
    st.className = "velib-station";
    st.innerHTML = `
      <div class="velib-header">
        <div class="velib-name">${info.name}</div>
        <div class="velib-id">#${id}</div>
      </div>
      <div class="velib-counts">
        <div class="velib-count meca">🚲 <strong>${info.mechanical}</strong> méca</div>
        <div class="velib-count elec">⚡ <strong>${info.electric}</strong> élec</div>
        <div class="velib-count docks">📍 <strong>${info.docks}</strong> places</div>
      </div>`;
    el.append(st);
  });
}

// --- Courses Vincennes ---
async function getVincennes() {
  const arr = [];
  for (let d = 0; d < 3; d++) {
    const dt = new Date();
    dt.setDate(dt.getDate() + d);
    const pmu = String(dt.getDate()).padStart(2, "0") + String(dt.getMonth() + 1).padStart(2, "0") + dt.getFullYear();
    const url = PROXY + encodeURIComponent("https://offline.turfinfo.api.pmu.fr/rest/client/7/programme/" + pmu);
    const data = await fetchJSON(url);
    if (!data) continue;
    data.programme.reunions.forEach(r => {
      if (r.hippodrome.code === "VIN") {
        r.courses.forEach(c => {
          const hd = new Date(c.heureDepart);
          if (hd > new Date()) {
            arr.push({
              heure: hd.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
              nom: c.libelle,
              distance: c.distance,
              discipline: c.discipline,
              dotation: c.montantPrix,
              ts: hd.getTime()
            });
          }
        });
      }
    });
  }
  return arr.sort((a, b) => a.ts - b.ts).slice(0, 6);
}

function renderCourses(el, courses) {
  el.innerHTML = "";
  if (!courses || courses.length === 0) return;
  courses.forEach(c => {
    const row = document.createElement("div");
    row.className = "course-row";
    row.innerHTML = `
      <div class="course-time">${c.heure}</div>
      <div class="course-info">
        <div class="course-name">${c.nom}</div>
        <div class="course-details">${c.distance}m • ${c.discipline}</div>
      </div>
      <div class="course-prize">${(c.dotation / 1000).toFixed(0)}k€</div>`;
    el.append(row);
  });
}

// --- News ---
function renderNews(items) {
  newsItems = items; 
  currentNews = 0;
  const el = $("#news-content"); 
  el.innerHTML = "";
  if (!items || items.length === 0) {
    renderError(el, "📰 Actualités indisponibles");
    $("#news-counter").textContent = "0/0";
    return;
  }
  items.forEach((n, i) => {
    const d = document.createElement("div");
    d.className = "news-item" + (i === 0 ? " active" : "");
    d.innerHTML = `<div class="news-title">${n.title}</div><div class="news-text">${n.description}</div><div class="news-meta">France Info</div>`;
    el.append(d);
  });
  $("#news-counter").textContent = "1/" + items.length;
}

function nextNews() {
  if (!newsItems.length) return;
  document.querySelector(".news-item.active")?.classList.remove("active");
  currentNews = (currentNews + 1) % newsItems.length;
  document.querySelectorAll(".news-item")[currentNews].classList.add("active");
  $("#news-counter").textContent = (currentNews + 1) + "/" + newsItems.length;
}

// --- Traffic ---
async function getTraffic(lineId, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="loader">Chargement trafic...</div>`;
  try {
    const url = PROXY + encodeURIComponent(
      `https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/line_reports/lines/${lineId}`
    );
    const data = await fetchJSON(url, 15000);
    el.innerHTML = "";
    if (data?.line_reports?.length > 0) {
      data.line_reports.forEach(report => {
        const msg = report.messages?.[0]?.text || "Perturbation en cours";
        const div = document.createElement("div");
        div.className = "traffic-alert";
        div.innerHTML = `⚠️ ${msg}`;
        el.appendChild(div);
      });
    } else {
      const ok = document.createElement("div");
      ok.className = "traffic-ok";
      ok.innerHTML = "✅ Trafic normal";
      el.appendChild(ok);
    }
  } catch (e) {
    console.error("Erreur trafic", e);
    el.innerHTML = `<div class="traffic-error">❌ Trafic indisponible</div>`;
  }
}

// --- Modules principaux ---
async function news() {
  const xml = await fetchText(PROXY + encodeURIComponent(RSS_URL));
  let actus = [];
  if (xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const items = Array.from(doc.querySelectorAll("item")).slice(0, 10);
    actus = items.map(i => ({
      title: i.querySelector("title")?.textContent || "",
      description: i.querySelector("description")?.textContent || ""
    }));
  }
  renderNews(actus);
}

async function meteo() {
  const weather = await fetchJSON(WEATHER_URL);
  if (weather?.current_weather) {
    $("#meteo-temp").textContent = Math.round(weather.current_weather.temperature);
    $("#meteo-desc").textContent = "Conditions actuelles";
    $("#meteo-extra").textContent = "Vent " + weather.current_weather.windspeed + " km/h";
  }
}

async function velib() {
  const velibData = await fetchJSON(PROXY + encodeURIComponent(VELIB_URL), 20000);
  const velibStations = parseVelibDetailed(velibData);
  if (velibStations) renderVelib($("#velib-list"), velibStations);
}

async function transport() {
  const [rer, jv, hp, br] = await Promise.all([
    fetchJSON(PROXY + encodeURIComponent("https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=" + STOP_IDS.RER_A)),
    fetchJSON(PROXY + encodeURIComponent("https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=" + STOP_IDS.JOINVILLE_AREA)),
    fetchJSON(PROXY + encodeURIComponent("https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=" + STOP_IDS.HIPPODROME)),
    fetchJSON(PROXY + encodeURIComponent("https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=" + STOP_IDS.BREUIL))
  ]);

  const rerData = regroupRER(rer);
  if (rerData) {
    renderRER($("#rer-paris"), rerData.directionParis);
    renderRER($("#rer-boissy"), rerData.directionBoissy);
  }
  const jvData = parseStop(jv);
  if (jvData) renderBus($("#bus-joinville-list"), jvData, "joinville");
  const hpData = parseStop(hp);
  if (hpData) renderBus($("#bus-hippodrome-list"), hpData, "hippodrome");
  const brData = parseStop(br);
  if (brData) renderBus($("#bus-breuil-list"), brData, "breuil");
}

async function courses() {
  const vincennesCourses = await getVincennes();
  if (vincennesCourses) renderCourses($("#courses-list"), vincennesCourses);
}

// --- Boucles ---
function startAllLoops() {
  setInterval(transport, 60 * 1000);
  setInterval(courses, 5 * 60 * 1000);
  setInterval(velib, 10 * 60 * 1000);
  setInterval(news, 15 * 60 * 1000);
  setInterval(meteo, 30 * 60 * 1000);

  setInterval(() => getTraffic(LINES.RER_A, "traffic-rer"), 5 * 60 * 1000);
  setInterval(() => getTraffic(LINES.BUS_77, "traffic-77"), 5 * 60 * 1000);
  setInterval(() => getTraffic(LINES.BUS_201, "traffic-201"), 5 * 60 * 1000);

  setInterval(nextNews, 20000);
  setInterval(setClock, 1000);
  setClock();
}

// --- Initialisation ---
async function initialRefresh() {
  await Promise.all([
    transport(),
    courses(),
    velib(),
    news(),
    meteo(),
    getTraffic(LINES.RER_A, "traffic-rer"),
    getTraffic(LINES.BUS_77, "traffic-77"),
    getTraffic(LINES.BUS_201, "traffic-201")
  ]);
  setLastUpdate();
}

async function initDashboard() {
  await initialRefresh();
  startAllLoops();
}

initDashboard();
