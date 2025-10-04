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

const VELIB_STATIONS = { VINCENNES: "12163", BREUIL: "12128" };

let newsItems = [];
let currentNews = 0;
let tickerIndex = 0;
let tickerData = { timeWeather: "", saint: "", traffic: "" };

function decodeEntities(str = "") {
  return str.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#039;/gi, "'").replace(/&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">" ).trim();
}
function cleanText(str = "") {
  return decodeEntities(str).replace(/<[^>]*>/g, " ").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
}
async function fetchJSON(url, timeout = 12000) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeout);
    const r = await fetch(url, { signal: c.signal, cache: "no-store" });
    clearTimeout(t);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    console.error("fetchJSON", url, e.message);
    return null;
  }
}
async function fetchText(url, timeout = 12000) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeout);
    const r = await fetch(url, { signal: c.signal, cache: "no-store" });
    clearTimeout(t);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch (e) {
    console.error("fetchText", url, e.message);
    return "";
  }
}
function minutesFromISO(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}
function setClock() {
  const elClock = document.getElementById("clock");
  const elDate = document.getElementById("date");
  if (!elClock || !elDate) return;
  const d = new Date();
  elClock.textContent = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  elDate.textContent = d.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}
function setLastUpdate() {
  const el = document.getElementById("lastUpdate");
  if (el) el.textContent = `Maj ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

function hhmm(iso) {
  if (!iso) return "—:—";
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function parseStop(data) {
  const visits = data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit;
  if (!Array.isArray(visits)) return [];
  return visits.map(v => {
    const mv = v.MonitoredVehicleJourney || {};
    const call = mv.MonitoredCall || {};
    const lineRef = mv.LineRef?.value || mv.LineRef || "";
    const destDisplay = cleanText(call.DestinationDisplay?.[0]?.value || call.DestinationDisplay?.value || "");
    const expected = call.ExpectedDepartureTime || call.ExpectedArrivalTime || null;
    const aimed = call.AimedDepartureTime || call.AimedArrivalTime || null;
    const statusRaw = (call.DepartureStatus || call.ArrivalStatus || "onTime").toLowerCase();
    const cancelled = statusRaw === "cancelled";
    const minutes = minutesFromISO(expected);
    const delay = (expected && aimed) ? Math.max(0, Math.round((new Date(expected) - new Date(aimed)) / 60000)) : 0;
    return { lineRef, dest: destDisplay, minutes, expected, aimed, delay, cancelled };
  });
}

function describeWeather(code) {
  const WEATHER_CODES = {
    0: "Grand soleil",
    1: "Ciel dégagé",
    2: "Éclaircies",
    3: "Ciel couvert",
    45: "Brouillard",
    48: "Brouillard givrant",
    51: "Bruine légère",
    61: "Pluie faible",
    63: "Pluie",
    65: "Pluie forte",
    80: "Averses",
    81: "Averses",
    82: "Forte averse",
    95: "Orages"
  };
  return WEATHER_CODES[code] || "Météo";
}

async function refreshWeather() {
  const data = await fetchJSON(WEATHER_URL);
  const tempEl = document.getElementById("weather-temp");
  const descEl = document.getElementById("weather-desc");
  if (!data?.current_weather) {
    if (descEl) descEl.textContent = "Météo indisponible";
    tickerData.timeWeather = "Météo indisponible";
    return;
  }
  const { temperature, weathercode } = data.current_weather;
  const info = describeWeather(weathercode);
  if (tempEl) tempEl.textContent = `${Math.round(temperature)}°C`;
  if (descEl) descEl.textContent = info;
  tickerData.timeWeather = `${Math.round(temperature)}°C • ${info}`;
}

async function refreshSaint() {
  try {
    const data = await fetchJSON("https://nominis.cef.fr/json/nominis.php");
    const name = data?.response?.prenoms;
    const saintEl = document.getElementById("saint");
    if (saintEl) saintEl.textContent = name ? `Fête : ${name}` : "Fête du jour";
  } catch {
    const saintEl = document.getElementById("saint");
    if (saintEl) saintEl.textContent = "Fête du jour indisponible";
  }
}

function updateTicker() {
  const slot = document.getElementById("ticker-slot");
  if (!slot) return;
  const clock = `${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  const entries = [`${clock} • ${tickerData.timeWeather}`];
  if (tickerData.saint) entries.push(tickerData.saint);
  if (tickerData.traffic) entries.push(tickerData.traffic);
  const pool = entries.filter(Boolean);
  if (!pool.length) {
    slot.textContent = "Chargement…";
    return;
  }
  slot.textContent = pool[tickerIndex % pool.length];
  tickerIndex++;
}

async function refreshNews() {
  const xml = await fetchText(PROXY + encodeURIComponent(RSS_URL));
  let items = [];
  if (xml) {
    try {
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      items = [...doc.querySelectorAll("item")]
        .slice(0, 5)
        .map(node => ({
          title: cleanText(node.querySelector("title")?.textContent || ""),
          desc: cleanText(node.querySelector("description")?.textContent || "")
        }));
    } catch (e) {
      console.error("refreshNews", e);
    }
  }
  newsItems = items;
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

function startLoops() {
  setInterval(setClock, 1000);
  setInterval(refreshWeather, 1800000);
  setInterval(refreshSaint, 3600000);
  setInterval(refreshNews, 900000);
  setInterval(updateTicker, 10000);
}

document.addEventListener("DOMContentLoaded", async () => {
  setClock();
  await Promise.allSettled([
    refreshWeather(),
    refreshSaint(),
    refreshNews()
  ]);
  updateTicker();
  setLastUpdate();
  startLoops();
});
