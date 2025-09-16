// app.js - Dashboard Hippodrome Paris-Vincennes
const PROXY = "https://ratp-proxy.hippodrome-proxy42.workers.dev/?url=";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=48.835&longitude=2.45&current_weather=true";
const VELIB_URL = "https://velib-metropole-opendata.smoove.pro/opendata/Velib_Metropole/station_status.json";
const RSS_URL = "https://www.francetvinfo.fr/titres.rss";

// Arrêts
const STOP_IDS = {
  JOINVILLE: "STIF:StopArea:SP:70640:", // RER A
  HIPPODROME: "STIF:StopArea:SP:463641:", // Bus 77
  BREUIL: "STIF:StopArea:SP:463644:" // Bus 201
};

// Lignes
const LINE_IDS = {
  RER_A: "STIF:Line::C01742:",
  BUS_77: "STIF:Line::C02251:",
  BUS_201: "STIF:Line::C02251:"
};

const $ = (sel, root = document) => root.querySelector(sel);

// ========= Helpers =========
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

function minutesFromISO(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}

function makeChip(text) {
  const span = document.createElement("span");
  span.className = "chip";
  span.textContent = text;
  return span;
}

function renderError(el, message, type = "warning") {
  el.innerHTML = `<div class="error-message">${message}</div>`;
}

// ========= Transports =========
function parseStop(data) {
  const visits = data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit || [];
  return visits.map(v => {
    const mv = v.MonitoredVehicleJourney || {};
    const call = mv.MonitoredCall || {};
    const dest = mv.DestinationName?.[0]?.value || "";
    const stop = call.StopPointName?.[0]?.value || "";
    const line = (mv.LineRef?.value || "").replace("STIF:Line::", "");
    const mins = minutesFromISO(call.ExpectedDepartureTime);
    return {
      line, dest, stop,
      minutes: mins != null ? [mins] : [],
      vjId: mv.VehicleJourneyRef
    };
  });
}

function groupByDest(arr) {
  const map = {};
  arr.forEach(x => {
    const k = x.dest || "—";
    map[k] = map[k] || { destination: k, minutes: [], vjId: x.vjId };
    if (x.minutes?.length) map[k].minutes.push(x.minutes[0]);
  });
  return Object.values(map)
    .map(r => ({ ...r, minutes: r.minutes.sort((a, b) => a - b).slice(0, 4) }))
    .sort((a, b) => (a.minutes[0] || 999) - (b.minutes[0] || 999));
}

function regroupRER(data) {
  const rows = parseStop(data);
  if (!rows) return null;
  return {
    directionParis: groupByDest(rows.filter(r => /paris|la défense/i.test(r.dest))),
    directionBoissy: groupByDest(rows.filter(r => /boissy|marne/i.test(r.dest)))
  };
}

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
    row.innerHTML = `<div class="badge">${b.line}</div>
      <div class="dest">${b.dest}<div class="sub">${b.stop}</div></div>
      <div class="bus-times"></div>`;
    b.minutes.forEach(m => row.querySelector(".bus-times").appendChild(makeChip(m)));
    el.append(row);
  });
}

// 🚏 Liste des arrêts desservis
async function renderStopsFromVJ(containerId, vjId) {
  const url = PROXY + encodeURIComponent(
    `https://prim.iledefrance-mobilites.fr/marketplace/vehicle_journeys/${vjId}`
  );
  const vj = await fetchJSON(url);
  const stops = vj?.vehicle_journeys?.[0]?.stop_times?.map(s => s.stop_point.name) || [];
  if (stops.length) {
    document.getElementById(containerId).innerHTML +=
      `<div class="stops">🚏 ${stops.join(" → ")}</div>`;
  }
}

// ⚠️ Alertes trafic
async function renderAlerts(lineRef, containerId) {
  const url = PROXY + encodeURIComponent(
    `https://prim.iledefrance-mobilites.fr/marketplace/general-message?LineRef=${lineRef}`
  );
  const data = await fetchJSON(url);
  const messages = data?.Siri?.ServiceDelivery?.GeneralMessageDelivery?.[0]?.InfoMessage || [];
  let html = "";
  messages.forEach(m => {
    const text = m.Content?.Message?.Text || "";
    html += `<div class="alert">⚠️ ${text}</div>`;
  });
  document.getElementById(containerId).innerHTML = html || "✅ Pas d’alerte";
}

// ========= Vélib =========
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
  return out;
}

function renderVelib(el, stations) {
  el.innerHTML = "";
  if (!stations) return;
  Object.entries(stations).forEach(([id, info]) => {
    const st = document.createElement("div");
    st.className = "velib-station";
    st.innerHTML = `<div class="velib-header"><div class="velib-name">${info.name}</div>
      <div class="velib-id">#${id}</div></div>
      <div class="velib-counts">
        <div class="velib-count meca">🚲 <strong>${info.mechanical}</strong> méca</div>
        <div class="velib-count elec">⚡ <strong>${info.electric}</strong> élec</div>
        <div class="velib-count docks">📍 <strong>${info.docks}</strong> places</div>
      </div>`;
    el.append(st);
  });
}

// ========= Courses Vincennes =========
async function getVincennes() {
  const arr = [];
  const dt = new Date();
  const pmu = String(dt.getDate()).padStart(2, "0") + String(dt.getMonth() + 1).padStart(2, "0") + dt.getFullYear();
  const url = PROXY + encodeURIComponent(`https://offline.turfinfo.api.pmu.fr/rest/client/7/programme/${pmu}`);
  const data = await fetchJSON(url);
  if (!data) return [];
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
  return arr.sort((a, b) => a.ts - b.ts).slice(0, 6);
}

function renderCourses(el, courses) {
  el.innerHTML = "";
  courses.forEach(c => {
    const row = document.createElement("div");
    row.className = "course-row";
    row.innerHTML = `<div class="course-time">${c.heure}</div>
      <div class="course-info"><div class="course-name">${c.nom}</div>
      <div class="course-details">${c.distance}m • ${c.discipline}</div></div>
      <div class="course-prize">${(c.dotation / 1000).toFixed(0)}k€</div>`;
    el.append(row);
  });
}

// ========= Actualités =========
function renderNews(items) {
  const el = $("#news-content"); 
  el.innerHTML = "";
  items.forEach((n, i) => {
    const d = document.createElement("div");
    d.className = "news-item" + (i === 0 ? " active" : "");
    d.innerHTML = `<div class="news-title">${n.title}</div>
      <div class="news-text">${n.description}</div>
      <div class="news-meta">France Info</div>`;
    el.append(d);
  });
  $("#news-counter").textContent = `1/${items.length}`;
}

// ========= Fonctions principales =========
async function transport() {
  const [rer, jv, hp, br] = await Promise.all([
    fetchJSON(PROXY + encodeURIComponent(`${STOP_MONITORING}?MonitoringRef=${STOP_IDS.JOINVILLE}&LineRef=${LINE_IDS.RER_A}`)),
    fetchJSON(PROXY + encodeURIComponent(`${STOP_MONITORING}?MonitoringRef=${STOP_IDS.JOINVILLE}`)),
    fetchJSON(PROXY + encodeURIComponent(`${STOP_MONITORING}?MonitoringRef=${STOP_IDS.HIPPODROME}`)),
    fetchJSON(PROXY + encodeURIComponent(`${STOP_MONITORING}?MonitoringRef=${STOP_IDS.BREUIL}`))
  ]);

  // RER
  const rerData = regroupRER(rer);
  if (rerData) {
    renderRER($("#rer-paris"), rerData.directionParis);
    renderRER($("#rer-boissy"), rerData.directionBoissy);
    if (rerData.directionParis?.[0]?.vjId) {
      await renderStopsFromVJ("rer-paris", rerData.directionParis[0].vjId);
    }
  }

  // Bus
  renderBus($("#bus-joinville-list"), parseStop(jv), "joinville");
  renderBus($("#bus-hippodrome-list"), parseStop(hp), "hippodrome");
  renderBus($("#bus-breuil-list"), parseStop(br), "breuil");

  // Alertes RER A
  await renderAlerts(LINE_IDS.RER_A, "alertes-rer-a");
}

async function news() {
  const xml = await fetchText(PROXY + encodeURIComponent(RSS_URL));
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const items = Array.from(doc.querySelectorAll("item")).slice(0, 10).map(i => ({
    title: i.querySelector("title")?.textContent || "",
    description: i.querySelector("description")?.textContent || ""
  }));
  renderNews(items);
}

async function meteo() {
  const weather = await fetchJSON(WEATHER_URL);
  if (weather?.current_weather) {
    $("#meteo-temp").textContent = Math.round(weather.current_weather.temperature);
    $("#meteo-extra").textContent = `Vent ${weather.current_weather.windspeed} km/h`;
  }
}

async function velib() {
  const velibData = await fetchJSON(PROXY + encodeURIComponent(VELIB_URL), 20000);
  renderVelib($("#velib-list"), parseVelibDetailed(velibData));
}

async function courses() {
  const vincennesCourses = await getVincennes();
  renderCourses($("#courses-list"), vincennesCourses);
}

// ========= Initialisation =========
async function initDashboard() {
  await Promise.all([transport(), meteo(), velib(), courses(), news()]);
  setInterval(transport, 60000);
  setInterval(meteo, 30 * 60 * 1000);
  setInterval(velib, 10 * 60 * 1000);
  setInterval(courses, 5 * 60 * 1000);
  setInterval(news, 15 * 60 * 1000);
}

initDashboard();
