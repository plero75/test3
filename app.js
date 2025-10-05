// === Constantes & endpoints ===
const PROXY = "https://ratp-proxy.hippodrome-proxy42.workers.dev/?url=";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=48.835&longitude=2.45&current_weather=true";
const RSS_URL = "https://www.francetvinfo.fr/titres.rss";

let newsItems = [];
let currentNews = 0;
let tickerIndex = 0;
let tickerData = { timeWeather: "", saint: "", traffic: "" };

// === Utils ===
function decodeEntities(str = "") {
  return str.replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, '"')
            .replace(/&#039;/gi, "'")
            .replace(/&apos;/gi, "'")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .trim();
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

// === Horloge / date ===
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

// === Météo ===
function describeWeather(code) {
  const WEATHER_CODES = {
    0: "Grand soleil",
    1: "Ciel dégagé",
    2: "Éclaircies",
    3: "Ciel couvert",
    45: "Brouillard",
    48: "Brouillard givrant",
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
  if (!data?.current_weather) return;
  const { temperature, weathercode } = data.current_weather;
  const info = describeWeather(weathercode);
  document.getElementById("weather-temp").textContent = `${Math.round(temperature)}°C`;
  document.getElementById("weather-desc").textContent = info;
  tickerData.timeWeather = `${Math.round(temperature)}°C • ${info}`;
}

// === Saint du jour ===
async function refreshSaint() {
  try {
    const data = await fetchJSON("https://nominis.cef.fr/json/nominis.php");
    const name = data?.response?.prenoms;
    document.getElementById("saint").textContent = name ? `Fête : ${name}` : "Fête du jour";
    tickerData.saint = `Fête : ${name}`;
  } catch {
    document.getElementById("saint").textContent = "Fête du jour indisponible";
  }
}

// === News ===
async function refreshNews() {
  const xml = await fetchText(PROXY + encodeURIComponent(RSS_URL));
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
  const cont = document.getElementById("news-carousel");
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

// === Ticker ===
function updateTicker() {
  const slot = document.getElementById("ticker-slot");
  if (!slot) return;
  const clock = `${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  const entries = [`${clock} • ${tickerData.timeWeather}`, tickerData.saint, tickerData.traffic].filter(Boolean);
  slot.textContent = entries[tickerIndex % entries.length] || "Chargement…";
  tickerIndex++;
}

// === Boucles ===
function startLoops() {
  setInterval(setClock, 1000);
  setInterval(refreshWeather, 1800000);
  setInterval(refreshSaint, 3600000);
  setInterval(refreshNews, 900000);
  setInterval(updateTicker, 10000);
  setInterval(setLastUpdate, 10000);
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
