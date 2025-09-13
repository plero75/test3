// app.js - Version avec messages d'erreur (pas de fallbacks)
const PROXY = "https://ratp-proxy.hippodrome-proxy42.workers.dev/?url=";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=48.835&longitude=2.45&current_weather=true";
const VELIB_URL = "https://velib-metropole-opendata.smoove.pro/opendata/Velib_Metropole/station_status.json";
const RSS_URL = "https://www.francetvinfo.fr/titres.rss";

// ✅ IDs STIF (à tester/ajuster si nécessaire)
const STOP_IDS = {
  RER_A: "STIF:StopArea:SP:43135:",
  JOINVILLE_AREA: "STIF:StopArea:SP:70640:",
  HIPPODROME: "STIF:StopArea:SP:463641:",
  BREUIL: "STIF:StopArea:SP:463644:"
};

const $ = (sel, root = document) => root.querySelector(sel);

let currentNews = 0;
let newsItems = [];
let currentInfoPanel = 0;

// Clock et updates
function setClock() {
  const d = new Date();
  $("#clock").textContent = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
setInterval(setClock, 1000);
setClock();

function setLastUpdate() {
  const d = new Date();
  $("#lastUpdate").textContent = "Maj " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Helpers
function makeChip(text) {
  const span = document.createElement("span");
  span.className = "chip";
  span.textContent = text;
  return span;
}

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

// Transport parsing
function minutesFromISO(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}

function parseStop(data) {
  if (!data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit) {
    return null;
  }
  
  const visits = data.Siri.ServiceDelivery.StopMonitoringDelivery[0].MonitoredStopVisit;
  if (visits.length === 0) {
    return null;
  }
  
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

// ✅ Renderers avec messages d'erreur
function renderRER(el, rows) {
  el.innerHTML = "";
  if (!rows || rows.length === 0) {
    const error = document.createElement("div");
    error.className = "error-message";
    error.style.cssText = "color: #999; font-style: italic; text-align: center; padding: 20px;";
    error.textContent = "Aucun passage prévu";
    el.appendChild(error);
    return;
  }
  
  rows.slice(0, 3).forEach(r => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = '<div class="dir">' + r.destination + '</div><div class="times"></div>';
    r.minutes.slice(0, 3).forEach(m => row.querySelector(".times").appendChild(makeChip(m)));
    el.append(row);
  });
}

function renderBus(el, buses, cls) {
  el.innerHTML = "";
  if (!buses || buses.length === 0) {
    const error = document.createElement("div");
    error.className = "error-message";
    error.style.cssText = "color: #999; font-style: italic; text-align: center; padding: 20px;";
    error.textContent = "Données indisponibles";
    el.appendChild(error);
    return;
  }
  
  buses.slice(0, 4).forEach(b => {
    const row = document.createElement("div");
    row.className = "bus-row " + cls;
    row.innerHTML = '<div class="badge">' + (b.line || "—") + '</div><div class="dest">' + b.dest + '<div class="sub">' + b.stop + '</div></div><div class="bus-times"></div>';
    b.minutes.slice(0, 3).forEach(m => row.querySelector(".bus-times").appendChild(makeChip(m)));
    el.append(row);
  });
}

// Vélib parsing
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
  if (!stations) {
    const error = document.createElement("div");
    error.className = "error-message";
    error.style.cssText = "color: #999; font-style: italic; text-align: center; padding: 20px;";
    error.textContent = "Service temporairement indisponible";
    el.appendChild(error);
    return;
  }
  
  Object.entries(stations).forEach(([id, info]) => {
    const st = document.createElement("div");
    st.className = "velib-station";
    st.innerHTML = '<div class="velib-header"><div class="velib-name">' + info.name + '</div><div class="velib-id">#' + id + '</div></div><div class="velib-counts"><div class="velib-count meca">🚲 <strong>' + info.mechanical + '</strong> méca</div><div class="velib-count elec">⚡ <strong>' + info.electric + '</strong> élec</div><div class="velib-count docks">📍 <strong>' + info.docks + '</strong> places</div></div>';
    el.append(st);
  });
}

// Courses Vincennes
async function getVincennes() {
  const arr = [];
  for (let d = 0; d < 3; d++) {
    if (d > 0) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
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
              discipline: c.discipline.replace("ATTELE", "Attelé").replace("MONTE", "Monté"),
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
  if (!courses || courses.length === 0) {
    const error = document.createElement("div");
    error.className = "error-message";
    error.style.cssText = "color: #999; font-style: italic; text-align: center; padding: 20px;";
    error.textContent = "Aucune course programmée";
    el.appendChild(error);
    return;
  }
  
  courses.slice(0, 6).forEach(c => {
    const row = document.createElement("div");
    row.className = "course-row";
    row.innerHTML = '<div class="course-time">' + c.heure + '</div><div class="course-info"><div class="course-name">' + c.nom + '</div><div class="course-details">' + c.distance + 'm • ' + c.discipline + '</div></div><div class="course-prize">' + (c.dotation / 1000).toFixed(0) + 'k€</div>';
    el.append(row);
  });
}

// News
async function loadNews() {
  let actus = [];
  try {
    const xml = await fetchText(PROXY + encodeURIComponent(RSS_URL));
    if (xml) {
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const items = Array.from(doc.querySelectorAll("item")).slice(0, 10);
      actus = items.map(i => ({
        title: i.querySelector("title")?.textContent || "",
        description: i.querySelector("description")?.textContent || ""
      }));
    }
  } catch (e) {
    console.warn("RSS failed:", e);
  }
  
  renderNews(actus);
}

function renderNews(items) {
  newsItems = items; 
  currentNews = 0;
  const el = $("#news-content"); 
  el.innerHTML = "";
  
  if (!items || items.length === 0) {
    const error = document.createElement("div");
    error.className = "news-item active error-message";
    error.style.cssText = "color: #999; font-style: italic; text-align: center; padding: 20px;";
    error.innerHTML = '<div class="news-title">Actualités indisponibles</div><div class="news-text">Service temporairement interrompu</div>';
    el.appendChild(error);
    $("#news-counter").textContent = "0/0";
    return;
  }
  
  items.forEach((n, i) => {
    const d = document.createElement("div");
    d.className = "news-item" + (i === 0 ? " active" : "");
    d.innerHTML = '<div class="news-title">' + n.title + '</div><div class="news-text">' + n.description + '</div><div class="news-meta">France Info</div>';
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

function toggleInfoPanel() {
  $("#panel-meteo").classList.toggle("active");
  $("#panel-trafic").classList.toggle("active");
  $("#info-title").textContent = currentInfoPanel ? "Météo Locale" : "Trafic IDF";
  currentInfoPanel = currentInfoPanel ? 0 : 1;
}

// ✅ Main refresh avec messages d'erreur
async function refresh() {
  console.log("🔄 Refresh");
  
  try {
    // Transport
    const [rer, jv, hp, br] = await Promise.all([
      fetchJSON(PROXY + encodeURIComponent("https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=" + STOP_IDS.RER_A)),
      fetchJSON(PROXY + encodeURIComponent("https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=" + STOP_IDS.JOINVILLE_AREA)),
      fetchJSON(PROXY + encodeURIComponent("https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=" + STOP_IDS.HIPPODROME)),
      fetchJSON(PROXY + encodeURIComponent("https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=" + STOP_IDS.BREUIL))
    ]);
    
    // RER A
    const rerData = regroupRER(rer);
    renderRER($("#rer-paris"), rerData?.directionParis);
    renderRER($("#rer-boissy"), rerData?.directionBoissy);
    
    // Bus
    renderBus($("#bus-joinville-list"), parseStop(jv), "joinville");
    renderBus($("#bus-hippodrome-list"), parseStop(hp), "hippodrome");
    renderBus($("#bus-breuil-list"), parseStop(br), "breuil");

    // Météo + Vélib
    const [meteo, velibData] = await Promise.all([
      fetchJSON(WEATHER_URL),
      fetchJSON(PROXY + encodeURIComponent(VELIB_URL), 20000)
    ]);
    
    // Météo
    if (meteo?.current_weather) {
      $("#meteo-temp").textContent = Math.round(meteo.current_weather.temperature);
      $("#meteo-desc").textContent = "Conditions actuelles";
      $("#meteo-extra").textContent = "Vent " + meteo.current_weather.windspeed + " km/h";
    } else {
      $("#meteo-temp").textContent = "--";
      $("#meteo-desc").textContent = "Données indisponibles";
      $("#meteo-extra").textContent = "";
    }
    
    // Vélib
    renderVelib($("#velib-list"), parseVelibDetailed(velibData));

    // Courses
    const courses = await getVincennes();
    renderCourses($("#courses-list"), courses);

    // News
    await loadNews();
    
  } catch (error) {
    console.error("Erreur refresh:", error);
  }
  
  setLastUpdate();
}

// Intervals et initialisation
setInterval(nextNews, 20000);
setInterval(toggleInfoPanel, 15000);
setInterval(refresh, 30000);
refresh();
