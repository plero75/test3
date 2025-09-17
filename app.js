// Tableau d'affichage – Hippodrome Paris-Vincennes

const PROXY = "https://ratp-proxy.hippodrome-proxy42.workers.dev/?url=";
const WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=48.835&longitude=2.45&current_weather=true";
const RSS_URL = "https://www.francetvinfo.fr/titres.rss";

const STOP_IDS = {
  RER_A: "STIF:StopArea:SP:43135:",
  JOINVILLE_AREA: "STIF:StopArea:SP:70640:",
  HIPPODROME: "STIF:StopArea:SP:463641:",
  BREUIL: "STIF:StopArea:SP:463644:"
};

const LINES = {
  RER_A: { id: "C01742", navitia: "line:IDFM:C01742", label: "RER A" },
  BUS_77: { id: "C02251", navitia: "line:IDFM:C02251", label: "Bus 77" },
  BUS_201: { id: "C01219", navitia: "line:IDFM:C01219", label: "Bus 201" }
};

const VELIB_STATIONS = {
  VINCENNES: "12163",
  BREUIL: "12128"
};

const WEATHER_CODES = {
  0: "Ciel dégagé",
  1: "Principalement clair",
  2: "Partiellement nuageux",
  3: "Couvert",
  45: "Brouillard",
  48: "Brouillard givrant",
  51: "Bruine faible",
  53: "Bruine",
  55: "Bruine forte",
  61: "Pluie faible",
  63: "Pluie modérée",
  65: "Pluie forte",
  80: "Averses faibles",
  81: "Averses modérées",
  82: "Fortes averses",
  95: "Orages",
  96: "Orages grêle",
  99: "Orages grêle"
};

const lineMetaCache = new Map();
let newsItems = [];
let currentNews = 0;

function decodeEntities(str = "") {
  return str
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

function cleanText(str = "") {
  return decodeEntities(str)
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJSON(url, timeout = 12000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error("fetchJSON", url, error.message);
    return null;
  }
}

async function fetchText(url, timeout = 12000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    console.error("fetchText", url, error.message);
    return null;
  }
}

function minutesFromISO(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}

function makeTimeChip(label) {
  const span = document.createElement("span");
  span.className = "time-chip";
  span.textContent = label;
  return span;
}

function makeInfoBadge(text) {
  const span = document.createElement("span");
  span.className = "info-badge";
  span.textContent = text;
  return span;
}

function renderEmpty(container, message) {
  if (!container) return;
  container.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "empty-message";
  empty.textContent = message;
  container.appendChild(empty);
}

function setClock() {
  const el = document.getElementById("clock");
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function setLastUpdate() {
  const el = document.getElementById("lastUpdate");
  if (!el) return;
  const now = new Date();
  el.textContent = `Maj ${now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

function parseStop(data) {
  const visits = data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit;
  if (!Array.isArray(visits)) return [];

  return visits.map(visit => {
    const mv = visit.MonitoredVehicleJourney || {};
    const call = mv.MonitoredCall || {};
    const lineRef = mv.LineRef?.value || "";
    const lineId = lineRef.match(/C\d{5}/)?.[0] || null;
    const destDisplay = cleanText(call.DestinationDisplay?.[0]?.value || "");
    const destName = cleanText(mv.DestinationName?.[0]?.value || "");
    const destShort = cleanText(mv.DestinationShortName?.[0]?.value || "");
    const direction = cleanText(mv.DirectionName?.[0]?.value || "");
    const stopName = cleanText(call.StopPointName?.[0]?.value || "");
    const minutes = minutesFromISO(call.ExpectedDepartureTime);

    return {
      lineId,
      lineRef,
      display: destDisplay || destShort || destName,
      fullDestination: destName,
      direction,
      stop: stopName,
      minutes: minutes != null ? [minutes] : [],
      expected: call.ExpectedDepartureTime
    };
  });
}

function groupByLineDestination(visits = []) {
  const map = new Map();

  visits.forEach(v => {
    const key = `${v.lineId || v.lineRef}|${v.display}`;
    if (!map.has(key)) {
      map.set(key, {
        lineId: v.lineId,
        lineRef: v.lineRef,
        display: v.display || "Destination à préciser",
        fullDestination: v.fullDestination,
        direction: v.direction,
        stops: new Set(),
        minutes: []
      });
    }
    const entry = map.get(key);
    entry.minutes.push(...v.minutes);
    if (v.stop) entry.stops.add(v.stop);
    if (!entry.fullDestination && v.fullDestination) entry.fullDestination = v.fullDestination;
    if (!entry.direction && v.direction) entry.direction = v.direction;
  });

  return Array.from(map.values()).map(entry => ({
    ...entry,
    minutes: entry.minutes.filter(m => typeof m === "number").sort((a, b) => a - b).slice(0, 3),
    stopLabel: Array.from(entry.stops)[0] || ""
  }));
}

function normaliseColor(hex) {
  if (!hex) return null;
  const clean = hex.toString().trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `#${clean}`;
  }
  return null;
}

function fallbackLineMeta(lineId) {
  return {
    id: lineId,
    code: lineId || "—",
    name: "",
    color: "#2450a4",
    textColor: "#ffffff"
  };
}

async function fetchLineMetadata(lineId) {
  if (!lineId) return fallbackLineMeta(lineId);
  if (lineMetaCache.has(lineId)) return lineMetaCache.get(lineId);

  const url =
    "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/referentiel-des-lignes/records?where=id_line%3D%22" +
    lineId +
    "%22&limit=1";

  const data = await fetchJSON(url, 10000);
  let meta = fallbackLineMeta(lineId);

  if (data?.results?.length) {
    const entry = data.results[0];
    meta = {
      id: lineId,
      code: entry.shortname_line || entry.name_line || lineId,
      name: entry.name_line || "",
      color: normaliseColor(entry.colourweb_hexa) || "#0055c8",
      textColor: normaliseColor(entry.textcolourweb_hexa) || "#ffffff"
    };
  }

  lineMetaCache.set(lineId, meta);
  return meta;
}

async function ensureLineMetas(groups) {
  const ids = [...new Set(groups.map(g => g.lineId).filter(Boolean))];
  const missing = ids.filter(id => !lineMetaCache.has(id));
  if (!missing.length) return;
  await Promise.all(missing.map(id => fetchLineMetadata(id)));
}

function renderRerDirection(container, groups) {
  if (!container) return;
  container.innerHTML = "";

  if (!groups?.length) {
    container.appendChild(makeInfoBadge("Aucune donnée en temps réel."));
    return;
  }

  groups.slice(0, 3).forEach(group => {
    const row = document.createElement("div");
    row.className = "rer-row";

    const dest = document.createElement("div");
    dest.className = "rer-destination";
    dest.textContent = group.display || "Destination à préciser";

    const times = document.createElement("div");
    times.className = "rer-times";
    if (group.minutes.length) {
      group.minutes.forEach(min => {
        const label = min === 0 ? "À quai" : `${min}`;
        times.appendChild(makeTimeChip(label));
      });
    } else {
      times.appendChild(makeInfoBadge("--"));
    }

    row.appendChild(dest);
    row.appendChild(times);
    container.appendChild(row);
  });
}

function classifyRerDestinations(visits = []) {
  const parisRegex = /(paris|la défense|nanterre|poissy|cergy|houilles|sartrouville|etoile|nation|haussmann)/i;
  const boissyRegex = /(boissy|marne|val d'europe|torcy|noisiel|bussy|chessy|noisy|fontenay|bry|champigny)/i;

  const paris = [];
  const boissy = [];
  const other = [];

  visits.forEach(v => {
    const label = `${v.display} ${v.fullDestination} ${v.direction}`.toLowerCase();
    if (parisRegex.test(label)) paris.push(v);
    else if (boissyRegex.test(label)) boissy.push(v);
    else other.push(v);
  });

  return {
    paris: groupByLineDestination(paris),
    boissy: groupByLineDestination(boissy),
    other: groupByLineDestination(other)
  };
}

function renderRerBlock(visits) {
  const parisEl = document.getElementById("rer-paris");
  const boissyEl = document.getElementById("rer-boissy");

  const rerVisits = (visits || []).filter(v => v.lineId === LINES.RER_A.id);
  const { paris, boissy, other } = classifyRerDestinations(rerVisits);

  renderRerDirection(parisEl, paris);
  renderRerDirection(boissyEl, boissy);

  if (other.length) {
    if (!paris?.length) {
      renderRerDirection(parisEl, other);
    }
    if (!boissy?.length) {
      renderRerDirection(boissyEl, other);
    }
  }
}

async function renderBusList(container, visits) {
  if (!container) return;
  container.innerHTML = "";

  if (!visits?.length) {
    container.appendChild(makeInfoBadge("Aucune donnée disponible."));
    return;
  }

  const groups = groupByLineDestination(visits).slice(0, 6);
  await ensureLineMetas(groups);

  groups.forEach(group => {
    const row = document.createElement("div");
    row.className = "bus-row";

    const main = document.createElement("div");
    main.className = "bus-main";

    const badge = document.createElement("span");
    badge.className = "line-pill";
    const meta = lineMetaCache.get(group.lineId) || fallbackLineMeta(group.lineId);
    badge.textContent = meta.code || group.lineId || "—";
    badge.style.setProperty("--line-color", meta.color);
    badge.style.setProperty("--line-text", meta.textColor);

    const info = document.createElement("div");
    info.className = "bus-info";

    const dest = document.createElement("div");
    dest.className = "bus-destination";
    dest.textContent = group.display || "Destination à préciser";

    const stop = document.createElement("div");
    stop.className = "bus-stop";
    const stopText = group.stopLabel || group.fullDestination || group.direction || "";
    if (stopText) stop.textContent = stopText;

    info.appendChild(dest);
    if (stopText) info.appendChild(stop);

    main.appendChild(badge);
    main.appendChild(info);

    const times = document.createElement("div");
    times.className = "bus-times";

    if (group.minutes.length) {
      group.minutes.forEach(min => {
        const label = min === 0 ? "À quai" : `${min}`;
        times.appendChild(makeTimeChip(label));
      });
    } else {
      times.appendChild(makeInfoBadge("--"));
    }

    row.appendChild(main);
    row.appendChild(times);
    container.appendChild(row);
  });
}

function formatLineLabel(meta, fallback) {
  if (!meta) return fallback;
  if (meta.name) return meta.name;
  if (meta.code) return `${fallback.split(" ")[0]} ${meta.code}`;
  return fallback;
}

async function buildTrafficItem(line, messages) {
  const meta = await fetchLineMetadata(line.id);
  let status = "ok";
  let message = "Trafic normal";

  if (messages === null) {
    status = "unknown";
    message = "Information trafic indisponible";
  } else if (messages.length) {
    status = "alert";
    message = cleanText(messages[0]);
  }

  return {
    id: line.id,
    code: meta.code,
    label: formatLineLabel(meta, line.label),
    color: meta.color,
    textColor: meta.textColor,
    status,
    message
  };
}

function renderTrafficSummary(items) {
  const container = document.getElementById("traffic-summary");
  if (!container) return;
  container.innerHTML = "";

  const valid = items.filter(Boolean);
  if (!valid.length) {
    container.appendChild(makeInfoBadge("Informations trafic indisponibles."));
    return;
  }

  valid.forEach(item => {
    const card = document.createElement("div");
    card.className = `traffic-item ${item.status}`;

    const header = document.createElement("div");
    header.className = "traffic-header";

    const badge = document.createElement("span");
    badge.className = "line-pill";
    badge.textContent = item.code || item.label;
    badge.style.setProperty("--line-color", item.color);
    badge.style.setProperty("--line-text", item.textColor);

    const title = document.createElement("span");
    title.textContent = item.label;

    header.appendChild(badge);
    header.appendChild(title);

    const message = document.createElement("p");
    message.className = "traffic-message";
    message.textContent = item.message;

    card.appendChild(header);
    card.appendChild(message);
    container.appendChild(card);
  });
}

function renderTrafficChip(container, item) {
  if (!container) return;
  container.innerHTML = "";
  if (!item) return;

  const badge = document.createElement("span");
  badge.className = "line-pill";
  badge.textContent = item.code || item.label;
  badge.style.setProperty("--line-color", item.color);
  badge.style.setProperty("--line-text", item.textColor);

  const text = document.createElement("span");
  text.className = `traffic-chip-text ${item.status}`;
  text.textContent = item.message;

  container.appendChild(badge);
  container.appendChild(text);
}

function renderCourses(courses) {
  const container = document.getElementById("courses-list");
  if (!container) return;
  container.innerHTML = "";

  if (!courses?.length) {
    container.appendChild(makeInfoBadge("Pas de prochaine course identifiée."));
    return;
  }

  courses.forEach(course => {
    const row = document.createElement("div");
    row.className = "course-row";

    const time = document.createElement("div");
    time.className = "course-time";
    time.textContent = course.heure;

    const info = document.createElement("div");
    info.className = "course-info";

    const name = document.createElement("div");
    name.className = "course-name";
    name.textContent = course.nom;

    const details = document.createElement("div");
    details.className = "course-details";
    const detailParts = [];
    if (typeof course.distance === "number") detailParts.push(`${course.distance} m`);
    if (course.discipline) detailParts.push(course.discipline);
    details.textContent = detailParts.join(" • ");

    info.appendChild(name);
    info.appendChild(details);

    const prize = document.createElement("div");
    prize.className = "course-prize";
    const prizeValue = typeof course.dotation === "number" ? (course.dotation / 1000).toFixed(0) : "—";
    prize.textContent = `${prizeValue} k€`;

    row.appendChild(time);
    row.appendChild(info);
    row.appendChild(prize);
    container.appendChild(row);
  });
}

function renderWeather(weather) {
  const tempEl = document.getElementById("meteo-temp");
  const descEl = document.getElementById("meteo-desc");
  const extraEl = document.getElementById("meteo-extra");
  if (!weather?.current_weather) {
    if (descEl) descEl.textContent = "Météo indisponible";
    return;
  }

  const { temperature, windspeed, weathercode } = weather.current_weather;
  if (tempEl) tempEl.textContent = `${Math.round(temperature)}°`;
  if (descEl) descEl.textContent = WEATHER_CODES[weathercode] || "Conditions actuelles";
  if (extraEl) extraEl.textContent = `Vent ${Math.round(windspeed)} km/h`;
}

function updateNewsCounter() {
  const counter = document.getElementById("news-counter");
  if (!counter) return;
  if (!newsItems.length) {
    counter.textContent = "0/0";
  } else {
    counter.textContent = `${currentNews + 1}/${newsItems.length}`;
  }
}

function renderNews(items) {
  const container = document.getElementById("news-content");
  if (!container) return;
  container.innerHTML = "";

  newsItems = items;
  currentNews = 0;

  if (!items?.length) {
    container.appendChild(makeInfoBadge("Actualités indisponibles pour le moment."));
    updateNewsCounter();
    return;
  }

  items.forEach((item, index) => {
    const article = document.createElement("article");
    article.className = "news-item" + (index === 0 ? " active" : "");

    const title = document.createElement("div");
    title.className = "news-title";
    title.textContent = item.title;

    const text = document.createElement("div");
    text.className = "news-text";
    text.textContent = item.description;

    const meta = document.createElement("div");
    meta.className = "news-meta";
    meta.textContent = item.source || "France Info";

    article.appendChild(title);
    article.appendChild(text);
    article.appendChild(meta);
    container.appendChild(article);
  });

  updateNewsCounter();
}

function nextNews() {
  if (!newsItems.length) return;
  const nodes = document.querySelectorAll(".news-item");
  if (!nodes.length) return;
  nodes[currentNews]?.classList.remove("active");
  currentNews = (currentNews + 1) % newsItems.length;
  nodes[currentNews]?.classList.add("active");
  updateNewsCounter();
}

async function fetchTraffic(lineNavitiaId) {
  const url =
    PROXY +
    encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/line_reports/lines/${lineNavitiaId}`);
  const data = await fetchJSON(url, 15000);
  if (!data) return null;

  const messages = [];
  (data.line_reports || []).forEach(report => {
    (report.messages || []).forEach(m => {
      if (m.text) messages.push(m.text);
    });
  });
  return messages;
}

async function getVincennes() {
  const upcoming = [];
  for (let offset = 0; offset < 3; offset += 1) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const pmu = `${String(date.getDate()).padStart(2, "0")}${String(date.getMonth() + 1).padStart(2, "0")}${date.getFullYear()}`;
    const url = PROXY + encodeURIComponent(`https://offline.turfinfo.api.pmu.fr/rest/client/7/programme/${pmu}`);
    const data = await fetchJSON(url, 15000);
    if (!data?.programme?.reunions) continue;

    data.programme.reunions.forEach(reunion => {
      if (reunion.hippodrome?.code !== "VIN") return;
      reunion.courses?.forEach(course => {
        const start = new Date(course.heureDepart);
        if (Number.isNaN(start.getTime()) || start < new Date()) return;
        upcoming.push({
          heure: start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
          nom: course.libelle,
          distance: course.distance,
          discipline: course.discipline,
          dotation: course.montantPrix,
          ts: start.getTime()
        });
      });
    });
  }

  return upcoming.sort((a, b) => a.ts - b.ts).slice(0, 6);
}

function renderVelibCard(container, station) {
  if (!container) return;
  container.innerHTML = "";

  if (!station) {
    container.appendChild(makeInfoBadge("Données Vélib' indisponibles."));
    return;
  }

  const title = document.createElement("strong");
  title.textContent = `📍 ${station.name}`;

  const mechanical = document.createElement("span");
  mechanical.textContent = `🚲 ${station.mechanical ?? "--"} méca`;

  const electric = document.createElement("span");
  electric.textContent = `🔌 ${station.ebike ?? "--"} élec`;

  const docks = document.createElement("span");
  docks.textContent = `🅿️ ${station.numdocksavailable ?? "--"} bornes`;

  container.appendChild(title);
  container.appendChild(mechanical);
  container.appendChild(electric);
  container.appendChild(docks);
}

async function updateVelibCard(stationId, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.textContent = "Chargement...";

  try {
    const url =
      `https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/velib-disponibilite-en-temps-reel/exports/json?lang=fr&qv1=(${stationId})&timezone=Europe%2FParis`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const station = Array.isArray(data) ? data[0] : null;
    renderVelibCard(container, station);
  } catch (error) {
    console.error("Vélib'", stationId, error.message);
    renderVelibCard(container, null);
  }
}

async function updateVelibCards() {
  await Promise.all([
    updateVelibCard(VELIB_STATIONS.VINCENNES, "velib-vincennes"),
    updateVelibCard(VELIB_STATIONS.BREUIL, "velib-breuil")
  ]);

  const el = document.getElementById("velib-update");
  if (el) {
    el.textContent = `Mise à jour : ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  }
}

async function refreshTransport() {
  try {
    const [
      rerRaw,
      joinvilleRaw,
      hippodromeRaw,
      breuilRaw,
      trafficRer,
      traffic77,
      traffic201
    ] = await Promise.all([
      fetchJSON(
        PROXY +
          encodeURIComponent(
            `https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.RER_A}`
          ),
        15000
      ),
      fetchJSON(
        PROXY +
          encodeURIComponent(
            `https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.JOINVILLE_AREA}`
          ),
        15000
      ),
      fetchJSON(
        PROXY +
          encodeURIComponent(
            `https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.HIPPODROME}`
          ),
        15000
      ),
      fetchJSON(
        PROXY +
          encodeURIComponent(
            `https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.BREUIL}`
          ),
        15000
      ),
      fetchTraffic(LINES.RER_A.navitia),
      fetchTraffic(LINES.BUS_77.navitia),
      fetchTraffic(LINES.BUS_201.navitia)
    ]);

    const rerVisits = parseStop(rerRaw);
    renderRerBlock(rerVisits);

    await Promise.all([
      renderBusList(document.getElementById("bus-joinville-list"), parseStop(joinvilleRaw)),
      renderBusList(document.getElementById("bus-hippodrome-list"), parseStop(hippodromeRaw)),
      renderBusList(document.getElementById("bus-breuil-list"), parseStop(breuilRaw))
    ]);

    const trafficItems = await Promise.all([
      buildTrafficItem(LINES.RER_A, trafficRer),
      buildTrafficItem(LINES.BUS_77, traffic77),
      buildTrafficItem(LINES.BUS_201, traffic201)
    ]);

    renderTrafficSummary(trafficItems);
    renderTrafficChip(document.getElementById("traffic-rer"), trafficItems[0]);
    setLastUpdate();
  } catch (error) {
    console.error("refreshTransport", error);
  }
}

async function refreshWeather() {
  const data = await fetchJSON(WEATHER_URL, 10000);
  renderWeather(data);
}

async function refreshCourses() {
  const courses = await getVincennes();
  renderCourses(courses);
}

async function refreshNews() {
  const xml = await fetchText(PROXY + encodeURIComponent(RSS_URL), 15000);
  let items = [];
  if (xml) {
    try {
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const nodes = Array.from(doc.querySelectorAll("item")).slice(0, 10);
      items = nodes.map(node => ({
        title: cleanText(node.querySelector("title")?.textContent || ""),
        description: cleanText(node.querySelector("description")?.textContent || ""),
        source: cleanText(node.querySelector("source")?.textContent || "France Info")
      }));
    } catch (error) {
      console.error("RSS parse", error);
    }
  }
  renderNews(items);
}

function startLoops() {
  setInterval(refreshTransport, 60 * 1000);
  setInterval(refreshWeather, 30 * 60 * 1000);
  setInterval(refreshCourses, 5 * 60 * 1000);
  setInterval(refreshNews, 15 * 60 * 1000);
  setInterval(updateVelibCards, 3 * 60 * 1000);
  setInterval(nextNews, 20000);
  setInterval(setClock, 1000);
}

async function init() {
  setClock();

  await Promise.all([
    refreshTransport(),
    refreshWeather(),
    refreshCourses(),
    refreshNews(),
    updateVelibCards()
  ]);

  startLoops();
}

init();
