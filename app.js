// app.js - Version avec messages d'erreur personnalisés par section
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

const $ = (sel, root = document) => root.querySelector(sel);

let currentNews = 0;
let newsItems = [];
let currentInfoPanel = 0;

// ✅ Fonction d'affichage d'erreur personnalisée
 // ✅ Nouvelle fonction avec lien Bonjour RATP
function renderError(el, message, type = "warning") {
  el.innerHTML = "";
  const errorDiv = document.createElement('div');
  errorDiv.className = `error-message error-${type}`;
  
  const styles = {
    warning: 'color: #ff6b35; background: #fff3f0; border: 1px solid #ffccc7; border-radius: 4px; font-weight: 500; text-align: center; padding: 15px; margin: 5px;',
    error: 'color: #dc3545; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; font-weight: 600; text-align: center; padding: 15px; margin: 5px;',
    info: 'color: #0056b3; background: #d1ecf1; border: 1px solid #bee5eb; border-radius: 4px; font-weight: 500; text-align: center; padding: 15px; margin: 5px;'
  };
  
  errorDiv.style.cssText = styles[type] || styles.warning;
  
  // ✅ Ajouter lien Bonjour RATP pour RER A
  if (message.includes('RER A')) {
    errorDiv.innerHTML = `
      <div style="margin-bottom: 10px;">${message}</div>
      <a href="https://www.bonjour-ratp.fr/gares/joinville-le-pont/" target="_blank" 
         style="color: #0066cc; text-decoration: underline; font-size: 0.9em;">
        📱 Horaires temps réel Bonjour RATP
      </a>
    `;
  } else {
    errorDiv.textContent = message;
  }
  
  el.appendChild(errorDiv);
}


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

// Renderers
function renderRER(el, rows) {
  el.innerHTML = "";
  if (!rows || rows.length === 0) {
    return; // L'erreur sera gérée dans refresh()
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
    return; // L'erreur sera gérée dans refresh()
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
    return; // L'erreur sera gérée dans refresh()
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
    return; // L'erreur sera gérée dans refresh()
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
    renderError(el, "📰 Actualités temporairement indisponibles", "info");
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

// ✅ Main refresh avec messages d'erreur personnalisés par section
async function refresh() {
  console.log("🔄 Refresh");
  
  try {
    // ✅ RER A - Messages personnalisés
    console.log("🚇 Chargement RER A...");
    const rer = await fetchJSON(PROXY + encodeURIComponent("https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=" + STOP_IDS.RER_A));
    const rerData = regroupRER(rer);
    
// ✅ Nouveau code avec gestion perturbations
if (rerData && (rerData.directionParis?.length > 0 || rerData.directionBoissy?.length > 0)) {
  renderRER($("#rer-paris"), rerData.directionParis);
  renderRER($("#rer-boissy"), rerData.directionBoissy);
} else {
  renderError($("#rer-paris"), "🚧 RER A perturbé : Travaux Joinville-Nogent (+1h30)", "warning");
  renderError($("#rer-boissy"), "🚧 RER A perturbé : Horaires modifiés cette semaine", "warning");
}


    // ✅ Bus Joinville - Message personnalisé
    console.log("🚌 Chargement Bus Joinville...");
    const jv = await fetchJSON(PROXY + encodeURIComponent("https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=" + STOP_IDS.JOINVILLE_AREA));
    const jvData = parseStop(jv);
    
if (jvData && jvData.length > 0) {
  renderBus($("#bus-joinville-list"), jvData, "joinville");
} else {
  renderError($("#bus-joinville-list"), "🚌 Bus Joinville : Horaires modifiés (travaux RER A)", "warning");
}


    // ✅ Bus Hippodrome - Message personnalisé
    console.log("🏇 Chargement Bus Hippodrome...");
    const hp = await fetchJSON(PROXY + encodeURIComponent("https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=" + STOP_IDS.HIPPODROME));
    const hpData = parseStop(hp);
    
    if (hpData && hpData.length > 0) {
      renderBus($("#bus-hippodrome-list"), hpData, "hippodrome");
    } else {
      renderError($("#bus-hippodrome-list"), "🏇 Bus Hippodrome : service interrompu", "warning");
    }

    // ✅ Bus École du Breuil - Message personnalisé
    console.log("🌳 Chargement Bus École du Breuil...");
    const br = await fetchJSON(PROXY + encodeURIComponent("https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=" + STOP_IDS.BREUIL));
    const brData = parseStop(br);
    
    if (brData && brData.length > 0) {
      renderBus($("#bus-breuil-list"), brData, "breuil");
    } else {
      renderError($("#bus-breuil-list"), "🌳 Bus École du Breuil : données indisponibles", "warning");
    }

    // ✅ Météo - Message personnalisé
    console.log("🌤️ Chargement Météo...");
    const meteo = await fetchJSON(WEATHER_URL);
    
    if (meteo?.current_weather) {
      $("#meteo-temp").textContent = Math.round(meteo.current_weather.temperature);
      $("#meteo-desc").textContent = "Conditions actuelles";
      $("#meteo-extra").textContent = "Vent " + meteo.current_weather.windspeed + " km/h";
    } else {
      $("#meteo-temp").textContent = "--";
      $("#meteo-desc").textContent = "Météo indisponible";
      $("#meteo-extra").textContent = "Service temporairement interrompu";
    }

    // ✅ Vélib - Message personnalisé
    console.log("🚲 Chargement Vélib...");
    const velibData = await fetchJSON(PROXY + encodeURIComponent(VELIB_URL), 20000);
    const velibStations = parseVelibDetailed(velibData);
    
    if (velibStations && Object.keys(velibStations).length > 0) {
      renderVelib($("#velib-list"), velibStations);
    } else {
      renderError($("#velib-list"), "🚲 Stations Vélib temporairement indisponibles", "info");
    }

    // ✅ Courses Vincennes - Message personnalisé
    console.log("🏇 Chargement Courses...");
    const courses = await getVincennes();
    
    if (courses && courses.length > 0) {
      renderCourses($("#courses-list"), courses);
    } else {
      renderError($("#courses-list"), "🏇 Aucune course programmée aujourd'hui", "info");
    }

    // ✅ Actualités - Gestion dans loadNews()
    console.log("📰 Chargement Actualités...");
    await loadNews();
    
  } catch (error) {
    console.error("Erreur critique refresh:", error);
    
    // ✅ Messages d'erreur critiques par section
    renderError($("#rer-paris"), "🚇 Erreur serveur RER A", "error");
    renderError($("#rer-boissy"), "🚇 Erreur serveur RER A", "error");
    renderError($("#bus-joinville-list"), "🚌 Erreur serveur Bus Joinville", "error");
    renderError($("#bus-hippodrome-list"), "🏇 Erreur serveur Bus Hippodrome", "error");
    renderError($("#bus-breuil-list"), "🌳 Erreur serveur Bus École du Breuil", "error");
    renderError($("#velib-list"), "🚲 Erreur serveur Vélib", "error");
    renderError($("#courses-list"), "🏇 Erreur serveur Courses", "error");
    renderError($("#news-content"), "📰 Erreur serveur Actualités", "error");
    
    $("#meteo-temp").textContent = "--";
    $("#meteo-desc").textContent = "Erreur météo";
    $("#meteo-extra").textContent = "Connexion interrompue";
  }
  
  setLastUpdate();
}

// Intervals et initialisation
setInterval(nextNews, 20000);
setInterval(toggleInfoPanel, 15000);
setInterval(refresh, 30000);
refresh();
