// -----------------------------------------------------------------------------
// Tableau d'affichage – Hippodrome Paris-Vincennes (refonte complète)
// -----------------------------------------------------------------------------
// Hypothèses :
// - PRIM /stop-monitoring pour RER & bus
// - PRIM /general-message pour bandeau trafic lignes
// - PRIM Navitia /vehicle_journeys/{id} si vehicleJourneyId disponible (optionnel)
// - Open-Meteo, PMU (programme offline), OpenData Paris (Vélib), Sytadin
// - Les éléments HTML existent (ids utilisés ci-dessous)
// -----------------------------------------------------------------------------

// ------------------------------ Constantes -----------------------------------
const PROXY = "https://ratp-proxy.hippodrome-proxy42.workers.dev/?url=";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=48.835&longitude=2.45&current_weather=true";
const RSS_URL = "https://www.francetvinfo.fr/titres.rss";

const STOP_IDS = {
  RER_A: "STIF:StopArea:SP:43135:",
  JOINVILLE_AREA: "STIF:StopArea:SP:70640:",
  HIPPODROME: "STIF:StopArea:SP:463641:",
  BREUIL: "STIF:StopArea:SP:463644:"
};

const LINES = {
  RER_A:   { id: "C01742", navitia: "line:IDFM:C01742", label: "RER A" },
  BUS_77:  { id: "C02251", navitia: "line:IDFM:C02251", label: "Bus 77" },
  BUS_106: { id: "C01135", navitia: "line:IDFM:C01135", label: "Bus 106" },
  BUS_201: { id: "C01219", navitia: "line:IDFM:C01219", label: "Bus 201" }
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

const STATUS_DEFINITIONS = {
  normal:    { label: "Trafic normal",  priority: 6 },
  delay:     { label: "Retard",         priority: 2 },
  cancelled: { label: "Supprimé",       priority: 1 },
  first:     { label: "Premier service",priority: 3 },
  last:      { label: "Dernier service",priority: 3 },
  ended:     { label: "Service terminé",priority: 1 },
  imminent:  { label: "Imminent",       priority: 2 },
  unknown:   { label: "Non disponible", priority: 7 }
};

// Seuil “imminent” : 1 min 30
const IMMINENT_THRESHOLD_MIN = 1.5;

// Pour “service terminé” par défaut si aucune donnée (fenêtre nocturne approx.)
const SERVICE_ENDED_WINDOW = { startHour: 1.5, endHour: 4.5 }; // 01:30 → 04:30

// ------------------------------ États & caches -------------------------------
const lineMetaCache = new Map();
const vehicleJourneyStopsCache = new Map();
let newsItems = [];
let currentNews = 0;
let coursesState = [];
let generalMessages = []; // [{line, severity, title, text}]

// ------------------------------ Utilitaires ----------------------------------
function decodeEntities(str = "") {
  return str
    .replace(/&nbsp;/gi, " ")
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

async function fetchJSON(url, timeout = 12000, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (e) {
      if (attempt === retries) {
        console.error("fetchJSON", url, e.message);
        return null;
      }
      await new Promise(r => setTimeout(r, 400 + 300 * attempt));
    }
  }
  return null;
}

async function fetchText(url, timeout = 12000, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (e) {
      if (attempt === retries) {
        console.error("fetchText", url, e.message);
        return null;
      }
      await new Promise(r => setTimeout(r, 400 + 300 * attempt));
    }
  }
  return null;
}

function minutesFromISO(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}

function formatClockTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function nowHourFloat() {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

function inServiceEndedWindow() {
  const h = nowHourFloat();
  const { startHour, endHour } = SERVICE_ENDED_WINDOW;
  if (startHour < endHour) return h >= startHour && h <= endHour;
  // cas fenêtre chevauchant minuit
  return h >= startHour || h <= endHour;
}

function parseDurationSeconds(value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "object") {
    if (typeof value.value === "number") return value.value;
    if (typeof value.seconds === "number") return value.seconds;
  }
  if (typeof value === "string") {
    const t = value.trim();
    const n = Number(t.replace(",", "."));
    if (!Number.isNaN(n)) return n;
    const m = t.match(/(-)?P(?:T)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
    if (m) {
      const sign = m[1] ? -1 : 1;
      const h = Number(m[2] || 0);
      const min = Number(m[3] || 0);
      const s = Number(m[4] || 0);
      return sign * (h * 3600 + min * 60 + s);
    }
  }
  return null;
}

// --------------------------- Composants UI (DOM) -----------------------------
function makeTimeChip(mainLabel, subLabel = "", options = {}) {
  const span = document.createElement("span");
  span.className = "time-chip";
  if (options?.variant) span.classList.add(`time-chip--${options.variant}`);

  const main = document.createElement("span");
  main.className = "time-chip-main";
  main.textContent = mainLabel ?? "--";
  span.appendChild(main);

  const sub = document.createElement("span");
  sub.className = "time-chip-sub";
  sub.textContent = subLabel || "min";
  span.appendChild(sub);

  if (options?.time) {
    const small = document.createElement("span");
    small.className = "time-chip-small";
    small.textContent = options.time;
    span.appendChild(small);
  }
  if (options?.title) span.title = options.title;

  // Si on affiche un horaire théorique barré :
  if (options?.aimedTime && options?.expectedTime && options.aimedTime !== options.expectedTime) {
    const theory = document.createElement("span");
    theory.className = "time-chip-aimed"; // CSS: text-decoration: line-through;
    theory.textContent = options.aimedTime;
    span.appendChild(theory);
  }
  return span;
}

function makeInfoBadge(text) {
  const span = document.createElement("span");
  span.className = "empty-message";
  span.textContent = text;
  return span;
}

function createStatusChip(tag) {
  const span = document.createElement("span");
  span.className = `status-chip status-${tag.type}`;
  span.textContent = tag.label;
  return span;
}

function trimStatusList(tags = []) {
  if (!tags?.length) return [];
  if (tags.length === 1 && tags[0].type === "normal") return [];
  return tags;
}

function getStationStatusClass(tags = []) {
  if (!tags?.length) return "ok";
  if (tags.some(t => t.type === "unknown")) return "unknown";
  if (tags.some(t => ["delay", "cancelled", "ended"].includes(t.type))) return "alert";
  return "ok";
}

function formatStationSummary(tags = []) {
  if (!tags?.length) return "Trafic normal";
  return tags.map(t => t.label).join(" · ");
}

function createStatusTag(type, label, value) {
  const def = STATUS_DEFINITIONS[type] || STATUS_DEFINITIONS.unknown;
  return { type, label: label || def.label, priority: def.priority, value: value ?? null };
}

// ----------------------------- Parsing PRIM ----------------------------------
function parseStop(data) {
  const visits = data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit;
  if (!Array.isArray(visits)) return [];

  return visits.map(v => {
    const mv = v.MonitoredVehicleJourney || {};
    const call = mv.MonitoredCall || {};
    const lineRef = mv.LineRef?.value || mv.LineRef || "";
    const lineId = (lineRef.match(/C\d{5}/) || [null])[0];

    const destDisplay = cleanText(call.DestinationDisplay?.[0]?.value || "");
    const destName    = cleanText(mv.DestinationName?.[0]?.value || "");
    const destShort   = cleanText(mv.DestinationShortName?.[0]?.value || "");
    const direction   = cleanText(mv.DirectionName?.[0]?.value || "");
    const stopName    = cleanText(call.StopPointName?.[0]?.value || "");
    const stopId      = (call.StopPointRef?.value || call.StopPointRef || "").toString();

    const expectedDep = call.ExpectedDepartureTime || call.ExpectedArrivalTime || null;
    const aimedDep    = call.AimedDepartureTime || call.AimedArrivalTime || null;
    const minutes     = minutesFromISO(expectedDep);

    const departureStatus = (call.DepartureStatus?.value || call.DepartureStatus || "").toString();
    const arrivalStatus   = (call.ArrivalStatus?.value || call.ArrivalStatus || "").toString();
    const progressStatus  = Array.isArray(mv.ProgressStatus)
      ? mv.ProgressStatus.map(x => (x?.value || x || "")).join(" ")
      : (mv.ProgressStatus?.value || mv.ProgressStatus || "");

    const firstLast = (call.Extensions?.FirstOrLastJourney || mv.Extensions?.FirstOrLastJourney || "").toString();
    const notes     = call.Extensions?.CallNote || call.Extensions?.Note || "";

    const delaySeconds =
      parseDurationSeconds(mv.Delay) ||
      parseDurationSeconds(call.DepartureDelay) ||
      parseDurationSeconds(call.ArrivalDelay) ||
      parseDurationSeconds(call.Extensions?.Delay);

    // PRIM → parfois présent :
    const vehicleJourneyId =
      mv.VehicleJourneyRef?.value ||
      mv.FramedVehicleJourneyRef?.DatedVehicleJourneyRef ||
      mv.VehicleRef?.value ||
      null;

    return {
      lineId,
      lineRef,
      display: destDisplay || destShort || destName,
      fullDestination: destName,
      direction,
      stop: stopName,
      stopId,
      minutes: Number.isFinite(minutes) ? [minutes] : [],
      expected: expectedDep,
      aimed: aimedDep,
      departureStatus,
      arrivalStatus,
      progressStatus,
      firstLast,
      notes,
      delayMinutes: delaySeconds != null ? Math.round(delaySeconds / 60) : null,
      vehicleJourneyId
    };
  });
}

// -------------------------- Agrégation par destination -----------------------
function buildDeparturesFromVisits(visits = [], limit = 4) {
  return visits
    .map(v => {
      const m = Array.isArray(v.minutes) ? v.minutes[0] : v.minutes;
      if (!Number.isFinite(m)) return null;
      return {
        minutes: Math.max(0, m),
        expected: v.expected,
        aimed: v.aimed,
        vehicleJourneyId: v.vehicleJourneyId
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, limit);
}

function getVisitStatusTags(visit) {
  const map = new Map();
  const add = tag => {
    const ex = map.get(tag.type);
    if (!ex || (tag.type === "delay" && (tag.value || 0) > (ex.value || 0))) map.set(tag.type, tag);
  };

  const raw = `${visit.departureStatus || ""} ${visit.arrivalStatus || ""} ${visit.progressStatus || ""}`.toLowerCase();
  const note = (visit.notes || "").toLowerCase();
  const fl = (visit.firstLast || "").toLowerCase();

  if (/cancel|supprim|annul/.test(raw) || /supprim|annul/.test(note)) add(createStatusTag("cancelled"));
  if (/notexpected|no service|termin|terminé|fin de service|closed/.test(raw) || /termin/.test(note)) add(createStatusTag("ended"));
  if (fl.includes("first")) add(createStatusTag("first"));
  if (fl.includes("last"))  add(createStatusTag("last"));
  if (typeof visit.delayMinutes === "number" && visit.delayMinutes > 0) {
    add(createStatusTag("delay", `Retard +${visit.delayMinutes} min`, visit.delayMinutes));
  }
  const m = Array.isArray(visit.minutes) ? visit.minutes[0] : visit.minutes;
  if (Number.isFinite(m) && m / 1.0 <= IMMINENT_THRESHOLD_MIN && m >= 0) add(createStatusTag("imminent"));

  if (!visit.minutes?.length) add(createStatusTag("unknown"));
  if (!map.size) add(createStatusTag("normal"));
  return Array.from(map.values());
}

function summariseStatusTags(visits = []) {
  const summary = new Map();
  visits.forEach(v => {
    const tags = getVisitStatusTags(v);
    v.statusTags = tags;
    tags.forEach(t => {
      const cur = summary.get(t.type);
      if (!cur || (t.type === "delay" && (t.value || 0) > (cur.value || 0))) summary.set(t.type, { ...t });
    });
  });
  let tags = Array.from(summary.values()).sort((a, b) => a.priority - b.priority);
  if (tags.length > 1) tags = tags.filter(t => t.type !== "normal");
  return tags;
}

function groupByLineDestination(visits = [], limitDepartures = 4) {
  const map = new Map();
  visits.forEach(v => {
    const key = `${v.lineId || v.lineRef}|${(v.display || "").toLowerCase()}`;
    if (!map.has(key)) {
      map.set(key, {
        lineId: v.lineId,
        lineRef: v.lineRef,
        display: v.display || "Destination à préciser",
        fullDestination: v.fullDestination,
        direction: v.direction,
        visits: []
      });
    }
    map.get(key).visits.push(v);
  });

  return Array.from(map.values()).map(entry => {
    const departures = buildDeparturesFromVisits(entry.visits, limitDepartures);
    return {
      lineId: entry.lineId,
      lineRef: entry.lineRef,
      display: entry.display,
      fullDestination: entry.fullDestination,
      direction: entry.direction,
      minutes: departures.map(d => d.minutes),
      departures,
      statusSummary: summariseStatusTags(entry.visits)
    };
  });
}

// ------------------------- Métadonnées de lignes -----------------------------
function normaliseColor(hex) {
  if (!hex) return null;
  const clean = hex.toString().trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(clean)) return `#${clean}`;
  return null;
}

function fallbackLineMeta(lineId) {
  return { id: lineId, code: lineId || "—", name: "", color: "#2450a4", textColor: "#ffffff" };
}

async function fetchLineMetadata(lineId) {
  if (!lineId) return fallbackLineMeta(lineId);
  if (lineMetaCache.has(lineId)) return lineMetaCache.get(lineId);

  const url = "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/referentiel-des-lignes/records?where=id_line%3D%22" +
    lineId + "%22&limit=1";

  const data = await fetchJSON(url, 10000);
  let meta = fallbackLineMeta(lineId);

  if (data?.results?.length) {
    const e = data.results[0];
    meta = {
      id: lineId,
      code: e.shortname_line || e.name_line || lineId,
      name: e.name_line || "",
      color: normaliseColor(e.colourweb_hexa) || "#0055c8",
      textColor: normaliseColor(e.textcolourweb_hexa) || "#ffffff"
    };
  }
  lineMetaCache.set(lineId, meta);
  return meta;
}

// ----------------------- Vehicle Journey (arrêts desservis) ------------------
async function fetchJourneyStops(vjId) {
  if (!vjId) return [];
  if (vehicleJourneyStopsCache.has(vjId)) return vehicleJourneyStopsCache.get(vjId);
  // PRIM Navitia v2 – vehicle_journeys
  const url = PROXY + encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/vehicle_journeys/${encodeURIComponent(vjId)}?`);
  const data = await fetchJSON(url, 10000);
  const stops =
    data?.vehicle_journeys?.[0]?.stop_times?.map(st => cleanText(st.stop_point?.name || st.stop_point?.label || "")) || [];
  vehicleJourneyStopsCache.set(vjId, stops);
  return stops;
}

// ----------------------------- Rendu RER -------------------------------------
function classifyRerDestinations(visits = []) {
  const parisRegex  = /(paris|la défense|nanterre|poissy|cergy|houilles|sartrouville|etoile|nation|haussmann)/i;
  const boissyRegex = /(boissy|marne|val d'europe|torcy|noisiel|bussy|chessy|noisy|fontenay|bry|champigny)/i;

  const paris = [], boissy = [], other = [];
  visits.forEach(v => {
    const label = `${v.display} ${v.fullDestination} ${v.direction}`.toLowerCase();
    if (parisRegex.test(label)) paris.push(v);
    else if (boissyRegex.test(label)) boissy.push(v);
    else other.push(v);
  });

  return {
    paris: groupByLineDestination(paris, 4),
    boissy: groupByLineDestination(boissy, 4),
    other: groupByLineDestination(other, 4)
  };
}

function createDepartureChip(departure) {
  const minutes = Number.isFinite(departure?.minutes) ? Math.max(0, departure.minutes) : null;
  const expectedLabel = departure?.expected ? formatClockTime(departure.expected) : null;
  const aimedLabel    = departure?.aimed ? formatClockTime(departure.aimed) : null;
  const tooltip = minutes == null ? "Horaire indisponible" : (minutes === 0 ? "Départ imminent" :
    (expectedLabel ? `${expectedLabel} (${minutes} min)` : `${minutes} min`));

  if (minutes == null) {
    return makeTimeChip("--", "", { variant: "unknown", title: tooltip });
  }
  if (minutes === 0) {
    return makeTimeChip("À quai", "", {
      variant: "now",
      title: tooltip,
      time: expectedLabel || ""
    });
  }
  if (minutes / 1.0 <= IMMINENT_THRESHOLD_MIN) {
    return makeTimeChip(String(minutes), "min", {
      variant: "soon",
      title: tooltip,
      time: expectedLabel || "",
      aimedTime: aimedLabel,
      expectedTime: expectedLabel
    });
  }
  if (minutes > 30) {
    return makeTimeChip(expectedLabel || String(minutes), expectedLabel ? `${minutes} min` : "min", {
      variant: "long",
      title: tooltip,
      aimedTime: aimedLabel,
      expectedTime: expectedLabel
    });
  }
  return makeTimeChip(String(minutes), "min", {
    variant: "regular",
    title: tooltip,
    time: expectedLabel || "",
    aimedTime: aimedLabel,
    expectedTime: expectedLabel
  });
}

async function renderRerDirection(container, groups, emptyMessage = "Aucune donnée en temps réel.") {
  if (!container) return;
  container.innerHTML = "";

  if (!groups?.length) {
    const text = inServiceEndedWindow() ? "Service terminé – prochain passage hors plage nocturne" : emptyMessage;
    container.appendChild(makeInfoBadge(text));
    return;
  }

  for (const group of groups.slice(0, 4)) {
    const row = document.createElement("div");
    row.className = "rer-row";

    const dest = document.createElement("div");
    dest.className = "rer-destination";
    dest.textContent = group.display || "Destination à préciser";

    const statuses = trimStatusList(group.statusSummary);
    const statusWrap = document.createElement("div");
    statusWrap.className = "rer-status";
    statuses.forEach(tag => statusWrap.appendChild(createStatusChip(tag)));

    const times = document.createElement("div");
    times.className = "rer-times";
    const departures = Array.isArray(group.departures) ? group.departures : [];

    if (departures.length) {
      departures.forEach(dep => times.appendChild(createDepartureChip(dep)));
    } else if (group.minutes?.length) {
      group.minutes.forEach(min => times.appendChild(createDepartureChip({ minutes: min })));
    } else {
      times.appendChild(makeInfoBadge("--"));
    }

    row.appendChild(dest);
    if (statuses.length) row.appendChild(statusWrap);
    row.appendChild(times);

    // Bandeau “gares desservies” pour le tout prochain départ (si vjId)
    const first = departures[0];
    if (first?.vehicleJourneyId) {
      const stopsDiv = document.createElement("div");
      stopsDiv.className = "rer-stops-marquee"; // CSS: défilement horizontal
      stopsDiv.textContent = "Chargement des arrêts…";
      row.appendChild(stopsDiv);

      fetchJourneyStops(first.vehicleJourneyId).then(stops => {
        if (stops?.length) {
          stopsDiv.textContent = stops.join("  •  ");
        } else {
          stopsDiv.textContent = "";
        }
      }).catch(() => { stopsDiv.textContent = ""; });
    }

    container.appendChild(row);
  }
}

// ----------------------------- Rendu BUS -------------------------------------
async function renderBusStation(container, stationName, visits) {
  if (!container) return;

  const wrap = document.createElement("div");
  wrap.className = "bus-block";

  const title = document.createElement("h3");
  title.textContent = stationName;
  wrap.appendChild(title);

  const summary = document.createElement("div");
  summary.className = "bus-summary";
  wrap.appendChild(summary);

  const linesDiv = document.createElement("div");
  linesDiv.className = "bus-lines";
  wrap.appendChild(linesDiv);

  const grouped = groupByLineDestination(visits, 4);
  if (!grouped.length) {
    summary.textContent = inServiceEndedWindow() ? "Service terminé – prochain passage hors plage nocturne" : "Aucun passage prévu";
    summary.className = "bus-summary unknown";
    container.appendChild(wrap);
    return;
  }

  const lineIds = [...new Set(grouped.map(g => g.lineId).filter(Boolean))];
  await Promise.all(lineIds.map(id => fetchLineMetadata(id)));

  const allTags = grouped.flatMap(g => g.statusSummary);
  const statusClass = getStationStatusClass(allTags);
  summary.textContent = formatStationSummary(allTags);
  summary.className = `bus-summary ${statusClass}`;

  grouped.slice(0, 4).forEach(group => {
    const lineDiv = document.createElement("div");
    lineDiv.className = "bus-line";

    const meta = lineMetaCache.get(group.lineId) || fallbackLineMeta(group.lineId);
    const pill = document.createElement("span");
    pill.className = "line-pill";
    pill.textContent = meta.code || meta.id || "—";
    pill.style.setProperty("--line-color", meta.color);
    pill.style.setProperty("--line-text", meta.textColor);
    lineDiv.appendChild(pill);

    const destDiv = document.createElement("div");
    destDiv.className = "bus-destination";
    destDiv.textContent = group.display || "Destination à préciser";
    lineDiv.appendChild(destDiv);

    const timesDiv = document.createElement("div");
    timesDiv.className = "bus-times";
    if (group.departures.length) {
      group.departures.forEach(dep => timesDiv.appendChild(createDepartureChip(dep)));
    } else {
      timesDiv.appendChild(makeInfoBadge("--"));
    }
    lineDiv.appendChild(timesDiv);

    linesDiv.appendChild(lineDiv);
  });

  container.appendChild(wrap);
}

// --------------------------- Messages trafic lignes --------------------------
function severityToOrder(sev = "") {
  const s = sev.toLowerCase();
  if (/(critique|severe|major)/.test(s)) return 0;
  if (/(important|high|moderate|moyen)/.test(s)) return 1;
  if (/(faible|minor|info|information)/.test(s)) return 2;
  return 3;
}

async function fetchGeneralMessages() {
  const lineIds = Object.values(LINES).map(l => l.id);
  const msgs = [];

  // On interroge PRIM /general-message par ligne (fallback silencieux si 403/empty)
  await Promise.all(lineIds.map(async id => {
    const url = PROXY + encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/general-message?LineRef=${encodeURIComponent(id)}`);
    const data = await fetchJSON(url, 10000);
    const deliveries = data?.Siri?.ServiceDelivery?.GeneralMessageDelivery || [];
    deliveries.forEach(del => {
      (del.InfoMessage || []).forEach(msg => {
        const line = id;
        const txt = cleanText(
          msg?.Content?.Message?.[0]?.MessageText?.[0]?.value ||
          msg?.Content?.Message?.MessageText?.value ||
          msg?.Description || ""
        );
        const title = cleanText(
          msg?.Content?.Message?.[0]?.MessageText?.[0]?.lang || msg?.Content?.Message?.lang || ""
        );
        const sev = cleanText(msg?.Content?.Message?.[0]?.MessageType?.[0]?.value || msg?.Priority || "info");
        if (txt) msgs.push({ line, severity: sev, title, text: txt });
      });
    });
  }));

  generalMessages = msgs.sort((a, b) => severityToOrder(a.severity) - severityToOrder(b.severity));
}

function renderGeneralMessages() {
  const banner = document.getElementById("traffic-banner");
  if (!banner) return;
  banner.innerHTML = "";

  if (!generalMessages.length) {
    banner.className = "traffic-banner ok";
    banner.textContent = "Trafic normal sur les lignes suivies.";
    return;
  }

  banner.className = "traffic-banner alert";
  const list = document.createElement("div");
  list.className = "traffic-ticker";
  list.textContent = generalMessages.map(m => `[${m.line}] ${m.text}`).join("  •  ");
  banner.appendChild(list);
}

// ------------------------------ Météo ----------------------------------------
async function refreshWeather() {
  const data = await fetchJSON(WEATHER_URL, 10000, 1);
  const tempEl = document.getElementById("weather-temp");
  const descEl = document.getElementById("weather-desc");

  if (!data?.current_weather) {
    if (descEl) descEl.textContent = "Météo indisponible";
    if (tempEl) tempEl.textContent = "--°";
    return;
  }

  const { temperature, weathercode } = data.current_weather;
  if (tempEl) tempEl.textContent = `${Math.round(temperature)}°`;
  if (descEl) descEl.textContent = WEATHER_CODES[weathercode] || "Conditions actuelles";
}

// ------------------------------ Vélib’ ---------------------------------------
async function refreshVelib() {
  for (const [key, stationId] of Object.entries(VELIB_STATIONS)) {
    try {
      const url = `https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/velib-disponibilite-en-temps-reel/records?where=stationcode%3D${encodeURIComponent(stationId)}&limit=1`;
      const data = await fetchJSON(url, 10000, 1);
      const station = data?.results?.[0] || null;

      const el = document.getElementById(`velib-${key.toLowerCase()}`);
      if (el && station) {
        const mech = station.mechanical_bikes ?? station.mechanical ?? 0;
        const ebike = station.ebike_bikes ?? station.ebike ?? 0;
        const docks = station.numdocksavailable ?? station.num_docks_available ?? 0;
        el.textContent = `🚲 ${mech} méca  🔌 ${ebike} élec  🅿️ ${docks} bornes`;
      }
    } catch (e) {
      console.error("Vélib'", stationId, e.message);
    }
  }
}

// ------------------------------ Actus ----------------------------------------
async function refreshNews() {
  const xml = await fetchText(PROXY + encodeURIComponent(RSS_URL), 15000, 1);
  let items = [];
  if (xml) {
    try {
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const nodes = Array.from(doc.querySelectorAll("item")).slice(0, 5);
      items = nodes.map(node => ({
        title: cleanText(node.querySelector("title")?.textContent || ""),
        description: cleanText(node.querySelector("description")?.textContent || ""),
        source: cleanText(node.querySelector("source")?.textContent || "France Info")
      }));
    } catch (e) {
      console.error("RSS parse", e);
    }
  }
  newsItems = items;
  renderNews();
}

function renderNews() {
  const container = document.getElementById("news-content");
  if (!container) return;

  if (!newsItems?.length) {
    container.textContent = "Actualités indisponibles";
    return;
  }
  const item = newsItems[currentNews] || newsItems[0];
  container.innerHTML = `<strong>${item.title}</strong><br><small>${item.description}</small>`;
}

function nextNews() {
  if (!newsItems.length) return;
  currentNews = (currentNews + 1) % newsItems.length;
  renderNews();
}

// ------------------------------ Courses PMU ----------------------------------
async function getVincennesCourses() {
  const upcoming = [];
  for (let offset = 0; offset < 3; offset += 1) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const pmu = `${String(date.getDate()).padStart(2, "0")}${String(date.getMonth() + 1).padStart(2, "0")}${date.getFullYear()}`;
    const url = PROXY + encodeURIComponent(`https://offline.turfinfo.api.pmu.fr/rest/client/7/programme/${pmu}`);
    const data = await fetchJSON(url, 15000, 1);
    if (!data?.programme?.reunions) continue;

    data.programme.reunions.forEach(reunion => {
      if (reunion.hippodrome?.code !== "VIN") return;
      reunion.courses?.forEach(course => {
        const start = new Date(course.heureDepart);
        if (Number.isNaN(start.getTime()) || start < new Date()) return;
        upcoming.push({
          r: reunion.numOfficiel, // R1
          c: course.numOrdre,     // C4
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
  return upcoming.sort((a, b) => a.ts - b.ts).slice(0, 3);
}

async function refreshCourses() {
  const courses = await getVincennesCourses();
  coursesState = courses;

  const container = document.getElementById("courses-list");
  if (!container) return;

  if (!courses.length) {
    container.textContent = "Pas de prochaine course identifiée.";
    return;
  }

  container.innerHTML = "";
  courses.forEach(course => {
    const div = document.createElement("div");
    const ref = course.r && course.c ? `R${course.r}C${course.c}` : "";
    div.textContent = `${course.heure} • ${ref ? ref + " – " : ""}${course.nom}`;
    container.appendChild(div);
  });
}

// ------------------------------ Trafic routier -------------------------------
async function refreshRoad() {
  try {
    const data = await fetchJSON(PROXY + encodeURIComponent("https://opendata.sytadin.fr/velc/SYTR.json"), 15000, 1);
    const container = document.getElementById("road-list");
    if (!container) return;

    if (!data) {
      container.textContent = "Information trafic Sytadin indisponible.";
      return;
    }
    const entries = Array.isArray(data) ? data : (data.records || []).map(r => r.fields || r);
    const KEYWORDS = ["Périph", "A4", "A86", "Vincennes", "Joinville", "Charenton"];
    const filtered = entries
      .filter(e => e.libelle && KEYWORDS.some(k => new RegExp(k, "i").test(e.libelle)))
      .slice(0, 3);

    container.innerHTML = "";
    filtered.forEach(entry => {
      const div = document.createElement("div");
      const status = entry.commentaire || entry.indice_traffic || "—";
      div.textContent = `${entry.libelle} • ${status}`;
      container.appendChild(div);
    });
    if (!filtered.length) container.textContent = "Aucune information trafic pertinente.";
  } catch (e) {
    console.error("Sytadin", e);
    const container = document.getElementById("road-list");
    if (container) container.textContent = "Erreur lors du chargement du trafic.";
  }
}

// ------------------------------ Horloge & MAJ --------------------------------
function setClock() {
  const now = new Date();
  const label = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const el = document.getElementById("clock");
  if (el) el.textContent = label;
}

function setLastUpdate() {
  const el = document.getElementById("lastUpdate");
  if (!el) return;
  const now = new Date();
  el.textContent = `Maj ${now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

// ------------------------------ Transport ------------------------------------
async function refreshTransport() {
  try {
    const [rerRaw, joinvilleRaw, hippodromeRaw, breuilRaw] = await Promise.all([
      fetchJSON(PROXY + encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.RER_A}`), 15000, 1),
      fetchJSON(PROXY + encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.JOINVILLE_AREA}`), 15000, 1),
      fetchJSON(PROXY + encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.HIPPODROME}`), 15000, 1),
      fetchJSON(PROXY + encodeURIComponent(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.BREUIL}`), 15000, 1)
    ]);

    const rerVisits        = parseStop(rerRaw);
    const joinvilleVisits  = parseStop(joinvilleRaw);
    const hippodromeVisits = parseStop(hippodromeRaw);
    const breuilVisits     = parseStop(breuilRaw);

    // RER
    const rerContainer = document.getElementById("rer-body");
    if (rerContainer) {
      rerContainer.innerHTML = "";
      const { paris, boissy } = classifyRerDestinations(rerVisits);

      const parisCol = document.createElement("div");
      parisCol.className = "rer-column";
      const parisTitle = document.createElement("h3");
      parisTitle.textContent = "Vers Paris";
      parisCol.appendChild(parisTitle);
      const parisList = document.createElement("div");
      parisList.className = "rer-list";
      parisCol.appendChild(parisList);
      await renderRerDirection(parisList, paris);

      const boissyCol = document.createElement("div");
      boissyCol.className = "rer-column";
      const boissyTitle = document.createElement("h3");
      boissyTitle.textContent = "Vers Boissy / Marne-la-Vallée";
      boissyCol.appendChild(boissyTitle);
      const boissyList = document.createElement("div");
      boissyList.className = "rer-list";
      boissyCol.appendChild(boissyList);
      await renderRerDirection(boissyList, boissy);

      rerContainer.appendChild(parisCol);
      rerContainer.appendChild(boissyCol);
    }

    // BUS
    const busContainer = document.getElementById("bus-blocks");
    if (busContainer) {
      busContainer.innerHTML = "";
      await renderBusStation(busContainer, "Hippodrome de Vincennes", hippodromeVisits);
      await renderBusStation(busContainer, "Joinville-le-Pont RER",     joinvilleVisits);
      await renderBusStation(busContainer, "École du Breuil",           breuilVisits);
    }

    setLastUpdate();
  } catch (e) {
    console.error("refreshTransport", e);
  }
}

// ------------------------------ Boucles & init -------------------------------
let loopsStarted = false;
function startLoops() {
  if (loopsStarted) return;
  loopsStarted = true;

  setInterval(refreshTransport, 60 * 1000);
  setInterval(refreshWeather, 30 * 60 * 1000);
  setInterval(refreshCourses, 5 * 60 * 1000);
  setInterval(refreshNews, 15 * 60 * 1000);
  setInterval(refreshVelib, 3 * 60 * 1000);
  setInterval(refreshRoad, 5 * 60 * 1000);
  setInterval(nextNews, 20000);
  setInterval(setClock, 1000);
  setInterval(async () => { await fetchGeneralMessages(); renderGeneralMessages(); }, 5 * 60 * 1000);
}

async function init() {
  setClock();

  await Promise.allSettled([
    refreshTransport(),
    refreshWeather(),
    refreshCourses(),
    refreshNews(),
    refreshVelib(),
    refreshRoad(),
    fetchGeneralMessages()
  ]);

  renderGeneralMessages();
  startLoops();
}

init();
