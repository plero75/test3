export function decodeEntities(str = "") {
  return str
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").trim();
}

export function cleanText(str = "") {
  return decodeEntities(str)
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function minutesFromISO(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
} 



const PROXY = "https://ratp-proxy.hippodrome-proxy42.workers.dev/?url=";
const API_BASE = "https://prim.iledefrance-mobilites.fr/marketplace";
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

let newsItems = [];
let currentNews = 0;
let tickerIndex = 0;
let tickerData = { timeWeather: "", saint: "", horoscope: "", traffic: "" };
let signIdx = 0;

async function fetchJSON(url, timeout=12000) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeout);
    const r = await fetch(url, { signal: c.signal, cache: "no-store" });
    clearTimeout(t);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch(e) {
    console.error("fetchJSON error", url, e);
    return null;
  }
}

async function fetchText(url, timeout=12000) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeout);
    const r = await fetch(url, { signal: c.signal, cache: "no-store" });
    clearTimeout(t);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch(e) {
    console.error("fetchText error", url, e);
    return "";
  }
}

function minutesFromISO(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}

function cleanText(str) {
  if (!str) return "";
  const txt = new DOMParser().parseFromString(str, "text/html");
  return txt.documentElement.textContent.trim();
}

function parseStop(data) {
  const visits = data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit;
  if (!Array.isArray(visits)) return [];
  return visits.map(v => {
    const mv = v.MonitoredVehicleJourney || {};
    const call = mv.MonitoredCall || {};
    const lineRef = mv.LineRef?.value || mv.LineRef || "";
    const lineId = (lineRef.match(/C\d{5}/) || [null])[0];
    const destDisplay = cleanText(call.DestinationDisplay?.[0]?.value || "");
    const expected = call.ExpectedDepartureTime || call.ExpectedArrivalTime || null;
    const status = call.DepartureStatus || call.ArrivalStatus || "onTime";
    return { lineId, dest: destDisplay, minutes: minutesFromISO(expected), status };
  });
}

function formatTimeBox(v) {
  if (v.minutes === 0) return `<div class="time-box time-imminent">🚉 À quai</div>`;
  if (v.minutes !== null && v.minutes <= 1) return `<div class="time-box time-imminent">🟢 Imminent</div>`;
  if (v.status === "cancelled") return `<div class="time-box time-cancelled">❌ Supprimé</div>`;
  if (v.status === "last") return `<div class="time-box time-last">🔴 Dernier passage</div>`;
  if (v.status === "delayed") return `<div class="time-box time-delay">⏳ Retardé</div>`;
  const label = Number.isFinite(v.minutes) ? `${v.minutes} min` : "—";
  return `<div class="time-box">${label}</div>`;
}

async function renderRer() {
  const cont = document.getElementById("rer-departures");
  const statusEl = document.getElementById("rer-status");
  if (!cont || !statusEl) return;
  cont.innerHTML = "Chargement…";

  const data = await fetchJSON(`${PROXY}${API_BASE}/stop-monitoring?MonitoringRef=${STOP_IDS.RER_A}&LineRef=${LINES_SIRI.RER_A}`);
  const visits = parseStop(data).slice(0, 6);

  cont.innerHTML = "";
  if (!visits.length) {
    cont.textContent = "Aucun passage";
    return;
  }

  visits.forEach(v => {
    const row = document.createElement("div");
    row.className = "departure-row";

    const infoDiv = document.createElement("div");
    infoDiv.className = "info";
    infoDiv.textContent = v.dest || "—";
    row.appendChild(infoDiv);

    const timesHTML = formatTimeBox(v);
    const timesDiv = document.createElement("div");
    timesDiv.className = "times";
    timesDiv.innerHTML = timesHTML;
    row.appendChild(timesDiv);

    const statusHTML = renderStatus(v.status, v.minutes);
    const statusDiv = document.createElement("div");
    statusDiv.className = "status";
    statusDiv.innerHTML = statusHTML;
    row.appendChild(statusDiv);

    cont.appendChild(row);
  });

  const messages = await fetchJSON(`${PROXY}${API_BASE}/general-message?LineRef=${LINES_SIRI.RER_A}`);
  if (messages?.Siri?.ServiceDelivery?.GeneralMessageDelivery?.[0]?.InfoMessage?.length > 0) {
    statusEl.textContent = messages.Siri.ServiceDelivery.GeneralMessageDelivery[0].InfoMessage[0].Content.Message[0].MessageText[0].value;
    statusEl.classList.add("alert");
  } else {
    statusEl.textContent = "✅ Trafic normal sur la ligne";
    statusEl.classList.remove("alert");
  }
}

async function renderBusForStop(stopId, bodyId) {
  const cont = document.getElementById(bodyId);
  if (!cont) return;

  cont.innerHTML = "Chargement…";

  const data = await fetchJSON(`${PROXY}${API_BASE}/stop-monitoring?MonitoringRef=${stopId}`);
  const visits = parseStop(data);

  cont.innerHTML = "";

  if (!visits.length) {
    cont.innerHTML = `<div class="traffic-sub alert">🚧 Aucun passage prévu</div>`;
    return;
  }

  const byLine = {};
  visits.forEach(v => {
    if (!byLine[v.lineId]) byLine[v.lineId] = [];
    byLine[v.lineId].push(v);
  });

  Object.entries(byLine).forEach(([lineId, rows]) => {
    const card = document.createElement("div");
    card.className = "bus-card";

    const header = document.createElement("div");
    header.className = "bus-card-header";
    header.innerHTML = `<span class="line-pill">${lineId.replace("C0", "")}</span> <span class="bus-card-dest">${rows[0].dest || "—"}</span>`;
    card.appendChild(header);

    const timesEl = document.createElement("div");
    timesEl.className = "times";
    rows.slice(0, 4).forEach(row => {
      timesEl.insertAdjacentHTML("beforeend", formatTimeBox(row));
    });
    card.appendChild(timesEl);

    cont.appendChild(card);
  });
}

async function refreshVelib() {
  await Promise.all(Object.entries(VELIB_STATIONS).map(async ([key, id]) => {
    const el = document.getElementById(`velib${key.toLowerCase()}`);
    if (!el) return;
    try {
      const url = `https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/velib-disponibilite-en-temps-reel/records?where=stationcode%3D${id}&limit=1`;
      const data = await fetchJSON(url);
      const st = data?.results?.[0];
      if (!st) {
        el.textContent = "Indispo";
        return;
      }
      const mech = st.mechanical_bikes || 0;
      const elec = st.ebike_bikes || 0;
      const docks = st.numdocksavailable || 0;
      el.textContent = `🚲${mech} 🔌${elec} 🅿️${docks}`;
    } catch (e) {
      console.error("refreshVelib", key, e);
      el.textContent = "Indispo";
    }
  }));
}

async function refreshWeather() {
  const data = await fetchJSON(WEATHER_URL);
  const tempEl = document.getElementById("weather-temp");
  const emojiEl = document.getElementById("weather-emoji");
  const descEl = document.getElementById("weather-desc");

  if (!data?.current_weather) {
    if (descEl) descEl.textContent = "Météo indisponible";
    tickerData.timeWeather = "Météo indisponible";
    return;
  }

  const { temperature, weathercode } = data.current_weather;
  const icons = {
    0: "☀️",
    1: "🌤️",
    2: "⛅",
    3: "☁️",
    45: "🌫️",
    48: "🌫️",
    51: "🌦️",
    53: "🌦️",
    55: "🌧️",
    56: "🌧️",
    57: "🌧️",
    61: "🌦️",
    63: "🌧️",
    65: "🌧️",
    66: "🌧️",
    67: "🌧️",
    71: "🌨️",
    73: "🌨️",
    75: "❄️",
    77: "❄️",
    80: "🌦️",
    81: "🌧️",
    82: "🌧️",
    85: "🌨️",
    86: "❄️",
    95: "⛈️",
    96: "⛈️",
    99: "⛈️"
  };
  const info = icons[weathercode] || "☁️";
  const tempStr = `${Math.round(temperature)}°C`;
  if (tempEl) tempEl.textContent = tempStr;
  if (emojiEl) emojiEl.textContent = info;
  if (descEl) descEl.textContent = `Météo actuelle`;
  tickerData.timeWeather = `${tempStr} • Météo actuelle`;
}

async function refreshNews() {
  const xml = await fetchText(`${PROXY}${encodeURIComponent(RSS_URL)}`);
  let items = [];
  if (xml) {
    try {
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      items = [...doc.querySelectorAll("item")].slice(0, 5).map(node => ({
        title: cleanText(node.querySelector("title")?.textContent || ""),
        desc: cleanText(node.querySelector("description")?.textContent || "")
      }));
    } catch (e) {
      console.error("refreshNews", e);
    }
  }
  newsItems = items;
  renderNews();
}

function renderNews() {
  const cont = document.getElementById("news-carousel");
  if (!cont) return;
  cont.innerHTML = "";
  if (!newsItems.length) {
    cont.textContent = "Aucune actualité";
    return;
  }
  newsItems.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "news-card" + (idx === currentNews ? " active" : "");
    card.innerHTML = `<div>${item.title}</div><div>${item.desc}</div>`;
    cont.appendChild(card);
  });
}

function nextNews() {
  if (!newsItems.length) return;
  currentNews = (currentNews + 1) % newsItems.length;
  renderNews();
}

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

async function fetchHoroscope(signEn) {
  try {
    const url = `https://horoscope-app-api.vercel.app/api/v1/get-horoscope/daily?sign=${signEn}&day=today`;
    const data = await fetchJSON(`${PROXY}${encodeURIComponent(url)}`);
    return data?.data?.horoscope_data || "Horoscope indisponible.";
  } catch {
    return "Horoscope indisponible.";
  }
}

async function refreshHoroscopeCycle() {
  const { fr, en } = SIGNS[signIdx];
  const text = await fetchHoroscope(en);
  tickerData.horoscope = `🔮 ${fr} : ${text}`;
  signIdx = (signIdx + 1) % SIGNS.length;
}

async function refreshSaint() {
  try {
    const data = await fetchJSON("https://nominis.cef.fr/json/nominis.php");
    const name = data?.response?.prenoms;
    tickerData.saint = name ? `🎂 Ste ${name}` : "🎂 Fête du jour";
  } catch {
    tickerData.saint = "🎂 Fête du jour indisponible";
  }
}

function updateTicker() {
  const slot = document.getElementById("ticker");
  if (!slot) return;
  const clock = `${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  const entries = [`${clock} • ${tickerData.timeWeather}`];
  if (tickerData.saint) entries.push(tickerData.saint);
  if (tickerData.horoscope) entries.push(tickerData.horoscope);
  if (tickerData.traffic) entries.push(tickerData.traffic);
  const pool = entries.filter(Boolean);
  if (!pool.length) {
    slot.textContent = "Chargement…";
    return;
  }
  slot.textContent = pool[tickerIndex % pool.length];
  tickerIndex++;
}

async function refreshTransitTraffic() {
  const banner = document.getElementById("traffic-banner");
  const rerInfo = document.getElementById("rer-traffic");
  const events = document.getElementById("events-list");

  if (events) events.innerHTML = "Chargement…";

  try {
    const data = await fetchJSON("https://api-ratp.pierre-grimaud.fr/v4/traffic", 10000);
    const result = data?.result;
    if (!result) throw new Error("no result");

    const impacted = [];

    const rerA = result.rers?.find(r => r.line === "A");
    if (rerInfo) {
      if (rerA) {
        rerInfo.style.display = "block";
        rerInfo.textContent = summarizeTrafficItem(rerA);
        rerInfo.className = `traffic-sub ${rerA.slug === "normal" ? "ok" : "alert"}`;
        if (rerA.slug !== "normal") impacted.push({ label: "RER A", detail: summarizeTrafficItem(rerA) });
      } else {
        rerInfo.style.display = "none";
      }
    }

    const linesToWatch = ["77", "201"];
    const busItems = linesToWatch.map(code => result.buses?.find(b => b.line === code)).filter(Boolean);

    if (events) {
      events.innerHTML = "";
      if (!busItems.length) {
        const div = document.createElement("div");
        div.className = "traffic-sub ok";
        div.textContent = "Aucune information bus.";
        events.appendChild(div);
      } else {
        let appended = false;
        busItems.forEach(item => {
          const div = document.createElement("div");
          const alert = item.slug !== "normal";
          div.className = `traffic-sub ${alert ? "alert" : "ok"}`;
          div.innerHTML = `<strong>Bus ${item.line}</strong> — ${summarizeTrafficItem(item)}`;
          events.appendChild(div);
          appended = true;
          if (alert) impacted.push({ label: `Bus ${item.line}`, detail: summarizeTrafficItem(item) });
        });
        if (!appended) {
          const div = document.createElement("div");
          div.className = "traffic-sub ok";
          div.textContent = "Trafic normal sur les bus suivis.";
          events.appendChild(div);
        }
      }
    }

    if (banner) {
      if (impacted.length) {
        const list = impacted.map(i => i.label).join(", ");
        const detail = impacted[0].detail;
        banner.textContent = `⚠️ ${list} : ${detail}`;
        banner.className = "traffic-banner alert";
        tickerData.traffic = `⚠️ ${list} perturbé`;
      } else {
        banner.textContent = "🟢 Trafic normal sur les lignes suivies.";
        banner.className = "traffic-banner ok";
        tickerData.traffic = "🟢 Trafic normal";
      }
    }
  } catch (e) {
    console.error("refreshTransitTraffic", e);
    if (banner) {
      banner.textContent = "⚠️ Trafic indisponible";
      banner.className = "traffic-banner alert";
    }
    if (rerInfo) rerInfo.style.display = "none";
    if (events) {
      events.innerHTML = '<div class="traffic-sub alert">Données trafic indisponibles</div>';
    }
    tickerData.traffic = "⚠️ Trafic indisponible";
  }
}

function summarizeTrafficItem(item) {
  const title = cleanText(item?.title || "");
  const message = cleanText(item?.message || "");
  if (!message || message === title) return title;
  return `${title} – ${message}`.trim();
}

// Utilitaires de distance kilométrique
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function refreshRoadTraffic() {
  const cont = document.getElementById("road-list");
  if (!cont) return;
  cont.textContent = "Chargement…";
  try {
    const url = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/comptages-routiers-permanents/records?limit=60&order_by=-t_1h";
    const data = await fetchJSON(url, 12000);
    const results = data?.results || [];
    const center = { lat: 48.825, lon: 2.45 };
    const seen = new Set();
    const rows = [];
    for (const rec of results) {
      const libelle = (rec.libelle || "").replace(/_/g, " ").trim();
      if (!libelle || seen.has(libelle)) continue;
      const point = rec.geo_point_2d;
      if (point) {
        const d = distanceKm(center.lat, center.lon, point.lat, point.lon);
        if (d > 5) continue;
      }
      seen.add(libelle);
      rows.push({
        libelle,
        status: rec.etat_trafic || "Indisponible",
        updated: rec.t_1h ? new Date(rec.t_1h) : null
      });
      if (rows.length >= 4) break;
    }
    cont.innerHTML = "";
    if (!rows.length) {
      cont.innerHTML = '<div class="traffic-sub ok">Pas de capteur routier proche.</div>';
      return;
    }
    rows.forEach(item => {
      const row = document.createElement("div");
      row.className = "road";
      const status = item.status.toLowerCase();
      const emoji = status.includes("fluide") ? "🟢" : status.includes("dense") ? "🟠" : status.includes("sature") ? "🔴" : "ℹ️";
      const time = item.updated ? item.updated.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "--:--";
      row.innerHTML = `<span>${emoji}</span><div><div class="road-name">${item.libelle}</div><div class="road-meta">${item.status} · ${time}</div></div>`;
      cont.appendChild(row);
    });
  } catch (e) {
    console.error("refreshRoadTraffic", e);
    cont.innerHTML = '<div class="traffic-sub alert">Données routières indisponibles</div>';
  }
}

async function refreshCourses() {
  const cont = document.getElementById("courses-list");
  if (!cont) return;
  cont.textContent = "Chargement…";
  try {
    const html = await fetchText(`https://r.jina.ai/https://www.letrot.com/stats/Evenement/GetEvenements?hippodrome=VINCENNES&startDate=${new Date().toISOString().slice(0,10)}&endDate=${new Date(Date.now()+90*86400000).toISOString().slice(0,10)}`);
    const entries = [...html.matchAll(/(\d{1,2} \w+ \d{4}).*?Réunion\s*(\d+)/gis)]
      .map(m => ({ date: m[1], reunion: m[2] }));
    cont.innerHTML = "";
    if(!entries.length) {
      throw new Error("Aucune course trouvée");
    }
    entries.slice(0, 4).forEach(({ date, reunion }) => {
      const elem = document.createElement("div");
      elem.className = "traffic-sub ok";
      elem.textContent = `${date} — Réunion ${reunion}`;
      cont.appendChild(elem);
    });
  } catch (e) {
    console.warn("refreshCourses", e);
    cont.innerHTML = '<div class="traffic-sub alert">Programme indisponible. Consultez <a href="https://www.letrot.com/stats/Evenement" target="_blank" rel="noopener">letrot.com</a>.</div>';
  }
}

function setClock() {
  const el = document.getElementById("time");
  if (el) el.textContent = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function setLastUpdate() {
  const el = document.getElementById("lastUpdate");
  if (el) el.textContent = `Maj ${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`;
}

function startLoops() {
  setInterval(setClock, 1000);
  setInterval(renderRer, 60000);
  setInterval(() => renderBusForStop(STOP_IDS.HIPPODROME, "bus77-departures"), 60000);
  setInterval(() => renderBusForStop(STOP_IDS.BREUIL, "bus201-departures"), 60000);
  setInterval(() => renderBusForStop(STOP_IDS.JOINVILLE, "joinville-all-departures"), 60000);
  setInterval(refreshVelib, 120000);
  setInterval(refreshWeather, 900000);
  setInterval(refreshNews, 900000);
  setInterval(nextNews, 12000);
  setInterval(refreshHoroscopeCycle, 60000);
  setInterval(refreshSaint, 3600000);
  setInterval(refreshTransitTraffic, 120000);
  setInterval(refreshRoadTraffic, 300000);
  setInterval(refreshCourses, 900000);
  setInterval(() => { updateTicker(); setLastUpdate(); }, 10000);
}

async function init() {
  setClock();

  await Promise.allSettled([
    renderRer(),
    renderBusForStop(STOP_IDS.HIPPODROME, "bus77-departures"),
    renderBusForStop(STOP_IDS.BREUIL, "bus201-departures"),
    renderBusForStop(STOP_IDS.JOINVILLE, "joinville-all-departures"),
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
}

document.addEventListener("DOMContentLoaded", init);
