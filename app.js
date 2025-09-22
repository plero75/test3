
// Limiter le nombre d'éléments affichés en mode portrait
function isPortraitMode() {
  return window.matchMedia("(orientation: portrait)").matches;
}

// Modifier les fonctions de rendu existantes
function renderRerDirection(container, groups, emptyMessage = "Aucune donnée en temps réel.") {
  if (!container) return;
  container.innerHTML = "";

  if (!groups?.length) {
    container.appendChild(makeInfoBadge(emptyMessage));
    return;
  }

  // Limiter à 3 éléments en portrait
  const maxItems = isPortraitMode() ? 3 : 4;
  groups.slice(0, maxItems).forEach(group => {
    // ... reste du code existant
  });
}

// Pareil pour les courses
function renderCourses(courses) {
  const container = document.getElementById("courses-list");
  if (!container) return;
  container.innerHTML = "";

  coursesState = Array.isArray(courses) ? [...courses] : [];
  
  // Limiter à 3 courses en portrait
  const maxCourses = isPortraitMode() ? 3 : 6;
  const displayCourses = coursesState.slice(0, maxCourses);
  
  // ... reste du code
}
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
  BUS_106: { id: "C01135", navitia: "line:IDFM:C01135", label: "Bus 106" },
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

const SYTADIN_URL = "https://opendata.sytadin.fr/velc/SYTR.json";

const WEATHER_CLASS_MAP = [
  { codes: [0, 1], className: "weather-sun" },
  { codes: [2, 3], className: "weather-cloud" },
  { codes: [45, 48], className: "weather-fog" },
  { codes: [51, 53, 55], className: "weather-rain" },
  { codes: [61, 63, 65, 80, 81, 82], className: "weather-rain" },
  { codes: [95, 96, 99], className: "weather-storm" }
];

const STATUS_DEFINITIONS = {
  normal: { label: "Affichage", priority: 5 },
  delay: { label: "Retard", priority: 2 },
  cancelled: { label: "Suppression", priority: 1 },
  first: { label: "Premier service", priority: 3 },
  last: { label: "Dernier service", priority: 3 },
  ended: { label: "Service terminé", priority: 1 },
  unknown: { label: "Non disponible", priority: 6 }
};

const SYTADIN_STATUS_LOOKUP = {
  0: { text: "Fluide", className: "fluid", severity: 1 },
  1: { text: "Dense", className: "dense", severity: 2 },
  2: { text: "Ralentissements", className: "dense", severity: 2 },
  3: { text: "Bouchons", className: "jam", severity: 3 },
  4: { text: "Congestion", className: "jam", severity: 3 }
};

const SYTADIN_KEYWORDS = [
  /a4/i,
  /a86/i,
  /p[ée]riph/i,
  /porte de bercy/i,
  /joinville/i,
  /vincennes/i,
  /charenton/i,
  /maisons-alfort/i
];

const lineMetaCache = new Map();
let newsItems = [];
let currentNews = 0;
let coursesState = [];

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

function makeTimeChip(mainLabel, subLabel = "", options = {}) {
  const span = document.createElement("span");
  span.className = "time-chip";
  if (options?.variant) {
    span.classList.add(`time-chip--${options.variant}`);
  }

  const main = document.createElement("span");
  main.className = "time-chip-main";
  main.textContent = mainLabel ?? "--";
  span.appendChild(main);

  const subs = Array.isArray(subLabel)
    ? subLabel.filter(Boolean)
    : subLabel
    ? [subLabel]
    : [];

  subs.forEach(text => {
    const sub = document.createElement("span");
    sub.className = "time-chip-sub";
    sub.textContent = text;
    span.appendChild(sub);
  });

  if (options?.title) {
    span.title = options.title;
  }

  if (options?.dataset) {
    Object.entries(options.dataset).forEach(([key, value]) => {
      if (value != null) {
        span.dataset[key] = value;
      }
    });
  }

  return span;
}

function makeInfoBadge(text) {
  const span = document.createElement("span");
  span.className = "info-badge";
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

function mergeStatusTags(...groups) {
  const seen = new Set();
  const merged = [];

  groups.forEach(group => {
    (group || []).forEach(tag => {
      if (!tag || !tag.type) return;
      if (seen.has(tag.type)) return;
      seen.add(tag.type);
      merged.push(tag);
    });
  });

  return merged;
}

function getStationStatusClass(tags = []) {
  if (!tags?.length) return "ok";
  if (tags.some(tag => tag.type === "unknown")) return "unknown";
  if (tags.some(tag => ["delay", "cancelled", "ended"].includes(tag.type))) return "alert";
  return "ok";
}

function formatStationSummary(tags = []) {
  if (!tags?.length) return "Trafic normal";
  return tags.map(tag => tag.label).join(" · ");
}

function getWeatherClass(code) {
  const numeric = Number(code);
  const entry = WEATHER_CLASS_MAP.find(item => item.codes.includes(numeric));
  return entry ? entry.className : "weather-unknown";
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
  const now = new Date();
  const label = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const el = document.getElementById("clock");
  if (el) {
    el.textContent = label;
  }
  document.querySelectorAll(".board-clock").forEach(node => {
    node.textContent = label;
  });
}

function setLastUpdate() {
  const el = document.getElementById("lastUpdate");
  if (!el) return;
  const now = new Date();
  el.textContent = `Maj ${now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

function parseDurationSeconds(value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "object") {
    if (typeof value.value === "number") return value.value;
    if (typeof value.seconds === "number") return value.seconds;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const numeric = Number(trimmed.replace(",", "."));
    if (!Number.isNaN(numeric)) return numeric;
    const isoMatch = trimmed.match(/(-)?P(T)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
    if (isoMatch) {
      const sign = isoMatch[1] ? -1 : 1;
      const hours = Number(isoMatch[3] || 0);
      const minutes = Number(isoMatch[4] || 0);
      const seconds = Number(isoMatch[5] || 0);
      return sign * ((hours * 3600) + (minutes * 60) + seconds);
    }
  }
  return null;
}

function createStatusTag(type, label, value) {
  const def = STATUS_DEFINITIONS[type] || STATUS_DEFINITIONS.unknown;
  return {
    type,
    label: label || def.label,
    priority: def.priority,
    value: value ?? null
  };
}

function getVisitStatusTags(visit) {
  const map = new Map();
  const register = tag => {
    const existing = map.get(tag.type);
    if (!existing || (tag.type === "delay" && (tag.value || 0) > (existing.value || 0))) {
      map.set(tag.type, tag);
    }
  };

  const rawStatus = `${visit.departureStatus || ""} ${visit.arrivalStatus || ""} ${visit.progressStatus || ""}`
    .toLowerCase();
  const noteStatus = (visit.notes || "").toLowerCase();
  const firstLast = (visit.firstLast || "").toLowerCase();

  if (/cancel|supprim|annul/.test(rawStatus) || /supprim|annul/.test(noteStatus)) {
    register(createStatusTag("cancelled"));
  }

  if (/notexpected|no service|termin|terminé|fin de service|closed/.test(rawStatus) || /termin/.test(noteStatus)) {
    register(createStatusTag("ended"));
  }

  if (firstLast.includes("first")) {
    register(createStatusTag("first"));
  }

  if (firstLast.includes("last")) {
    register(createStatusTag("last"));
  }

  if (typeof visit.delayMinutes === "number" && visit.delayMinutes > 0) {
    register(createStatusTag("delay", `Retard +${visit.delayMinutes} min`, visit.delayMinutes));
  }

  if (!visit.minutes?.length) {
    register(createStatusTag("unknown"));
  }

  if (!map.size) {
    register(createStatusTag("normal"));
  }

  return Array.from(map.values());
}

function summariseStatusTags(visits = []) {
  const summary = new Map();
  visits.forEach(visit => {
    const tags = getVisitStatusTags(visit);
    visit.statusTags = tags;
    tags.forEach(tag => {
      const current = summary.get(tag.type);
      if (!current || (tag.type === "delay" && (tag.value || 0) > (current.value || 0))) {
        summary.set(tag.type, { ...tag });
      }
    });
  });

  let tags = Array.from(summary.values());
  tags.sort((a, b) => a.priority - b.priority);
  if (tags.length > 1) {
    tags = tags.filter(tag => tag.type !== "normal");
  }
  return tags;
}

function formatClockTime(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function formatDepartureLabel(minutes, iso) {
  if (minutes == null) return "--";
  if (minutes === 0) return "À quai";
  const safeMinutes = Math.max(0, minutes);
  const timeLabel = formatClockTime(iso);
  if (safeMinutes > 30 && timeLabel) {
    return `${timeLabel} (${safeMinutes} min)`;
  }
  return `${safeMinutes} min`;
}

function buildDeparturesFromVisits(visits = []) {
  return visits
    .map(v => {
      const rawMinutes = Array.isArray(v.minutes) ? v.minutes[0] : v.minutes;
      if (typeof rawMinutes !== "number") return null;
      return {
        minutes: Math.max(0, rawMinutes),
        expected: v.expected,
        aimed: v.aimed
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, 3);
}

function createDepartureChip(departure) {
  const hasMinutes = Number.isFinite(departure?.minutes);
  const minutes = hasMinutes ? Math.max(0, departure.minutes) : null;
  const iso = departure?.expected || departure?.aimed || null;
  const timeLabel = iso ? formatClockTime(iso) : null;
  const tooltip = hasMinutes ? formatDepartureLabel(minutes, iso) : null;
  const dataset = timeLabel ? { time: timeLabel } : undefined;

  if (minutes == null) {
    return makeTimeChip("--", "", {
      variant: "unknown",
      title: tooltip || "Horaire indisponible",
      dataset
    });
  }

  if (minutes === 0) {
    return makeTimeChip("À quai", timeLabel || "", {
      variant: "now",
      title: tooltip || "Départ imminent",
      dataset
    });
  }

  if (minutes > 30) {
    if (timeLabel) {
      return makeTimeChip(timeLabel, `${minutes} min`, {
        variant: "long",
        title: tooltip || undefined,
        dataset
      });
    }

    return makeTimeChip(String(minutes), "min", {
      variant: "long",
      title: tooltip || undefined
    });
  }

  const variant = minutes <= 5 ? "soon" : "regular";
  const subParts = ["min"];
  if (timeLabel) {
    subParts.push(timeLabel);
  }

  return makeTimeChip(String(minutes), subParts.join(" · "), {
    variant,
    title: tooltip || undefined,
    dataset
  });
}

function createMinutesChip(minutes) {
  if (!Number.isFinite(minutes)) {
    return makeTimeChip("--", "", { variant: "unknown", title: "Horaire indisponible" });
  }

  const safeMinutes = Math.max(0, minutes);
  const approxIso = new Date(Date.now() + safeMinutes * 60000).toISOString();
  return createDepartureChip({ minutes: safeMinutes, expected: approxIso });
}

function stopPriority(name = "") {
  const value = name.toLowerCase();
  if (value.includes("hippodrome")) return 0;
  if (value.includes("joinville")) return 1;
  if (value.includes("pyramide") || value.includes("breuil")) return 2;
  if (value.includes("polangis")) return 3;
  return 10;
}

function groupVisitsByStop(visits = []) {
  const stops = new Map();

  const filteredVisits = (visits || []).filter(visit => {
    const id = visit.lineId || "";
    const ref = visit.lineRef || "";
    return id !== LINES.RER_A.id && !ref.includes(LINES.RER_A.id);
  });

  filteredVisits.forEach(visit => {
    const stopName = visit.stop || "Arrêt";
    const key = `${visit.stopId || ""}|${stopName.toLowerCase()}`;
    if (!stops.has(key)) {
      stops.set(key, {
        id: visit.stopId || null,
        name: stopName,
        visits: [],
        lines: new Map()
      });
    }

    const stopEntry = stops.get(key);
    stopEntry.visits.push(visit);

    const lineKey = visit.lineId || visit.lineRef || visit.display || stopName;
    if (!stopEntry.lines.has(lineKey)) {
      stopEntry.lines.set(lineKey, {
        lineId: visit.lineId,
        lineRef: visit.lineRef,
        visits: [],
        destinations: new Map()
      });
    }

    const lineEntry = stopEntry.lines.get(lineKey);
    lineEntry.visits.push(visit);

    const destKey = (visit.display || visit.fullDestination || visit.direction || "").toLowerCase();
    if (!lineEntry.destinations.has(destKey)) {
      lineEntry.destinations.set(destKey, {
        display: visit.display || visit.fullDestination || "Destination à préciser",
        fullDestination: visit.fullDestination,
        direction: visit.direction,
        visits: []
      });
    }

    lineEntry.destinations.get(destKey).visits.push(visit);
  });

  return Array.from(stops.values()).map(stopEntry => {
    const lines = Array.from(stopEntry.lines.values())
      .map(lineEntry => {
        const destinations = Array.from(lineEntry.destinations.values())
          .map(destEntry => ({
            display: destEntry.display,
            fullDestination: destEntry.fullDestination,
            direction: destEntry.direction,
            departures: buildDeparturesFromVisits(destEntry.visits),
            statusSummary: summariseStatusTags(destEntry.visits)
          }))
          .filter(dest => dest.departures.length || dest.statusSummary.length)
          .sort((a, b) => (a.display || "").localeCompare(b.display || "", "fr", { numeric: true }));

        return {
          lineId: lineEntry.lineId,
          lineRef: lineEntry.lineRef,
          statusSummary: summariseStatusTags(lineEntry.visits),
          destinations
        };
      })
      .filter(line => line.destinations.length);

    return {
      id: stopEntry.id,
      name: stopEntry.name,
      statusSummary: summariseStatusTags(stopEntry.visits),
      lines
    };
  });
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
    const stopId = (call.StopPointRef?.value || call.StopPointRef || "").toString();
    const minutes = minutesFromISO(call.ExpectedDepartureTime);
    const departureStatus = (call.DepartureStatus?.value || call.DepartureStatus || "").toString();
    const arrivalStatus = (call.ArrivalStatus?.value || call.ArrivalStatus || "").toString();
    const progressStatus = Array.isArray(mv.ProgressStatus)
      ? mv.ProgressStatus.map(item => (item?.value || item || "")).join(" ")
      : (mv.ProgressStatus?.value || mv.ProgressStatus || "");
    const firstLast = (call.Extensions?.FirstOrLastJourney || mv.Extensions?.FirstOrLastJourney || "").toString();
    const notes = call.Extensions?.CallNote || call.Extensions?.Note || "";
    const delaySeconds =
      parseDurationSeconds(mv.Delay) ||
      parseDurationSeconds(call.DepartureDelay) ||
      parseDurationSeconds(call.ArrivalDelay) ||
      parseDurationSeconds(call.Extensions?.Delay);

    return {
      lineId,
      lineRef,
      display: destDisplay || destShort || destName,
      fullDestination: destName,
      direction,
      stop: stopName,
      stopId,
      minutes: minutes != null ? [minutes] : [],
      expected: call.ExpectedDepartureTime,
      aimed: call.AimedDepartureTime || call.AimedArrivalTime,
      departureStatus,
      arrivalStatus,
      progressStatus,
      firstLast,
      notes,
      delayMinutes: delaySeconds != null ? Math.round(delaySeconds / 60) : null
    };
  });
}

function groupByLineDestination(visits = []) {
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
        visits: [],
        stops: new Map()
      });
    }
    const entry = map.get(key);
    entry.visits.push(v);
    if (!entry.fullDestination && v.fullDestination) entry.fullDestination = v.fullDestination;
    if (!entry.direction && v.direction) entry.direction = v.direction;
    if (v.stop) {
      if (!entry.stops.has(v.stop)) {
        entry.stops.set(v.stop, { id: v.stopId || null, visits: [] });
      }
      entry.stops.get(v.stop).visits.push(v);
    }
  });

  return Array.from(map.values()).map(entry => {
    const departures = buildDeparturesFromVisits(entry.visits);

    const stops = Array.from(entry.stops.entries()).map(([name, stopData]) => {
      const stopDepartures = buildDeparturesFromVisits(stopData.visits);
      return {
        name,
        id: stopData.id,
        departures: stopDepartures,
        minutes: stopDepartures.map(dep => dep.minutes),
        statuses: summariseStatusTags(stopData.visits)
      };
    });

    return {
      lineId: entry.lineId,
      lineRef: entry.lineRef,
      display: entry.display,
      fullDestination: entry.fullDestination,
      direction: entry.direction,
      minutes: departures.map(dep => dep.minutes),
      departures,
      statusSummary: summariseStatusTags(entry.visits),
      stops
    };
  });
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

function renderRerDirection(container, groups, emptyMessage = "Aucune donnée en temps réel.") {
  if (!container) return;
  container.innerHTML = "";

  if (!groups?.length) {
    container.appendChild(makeInfoBadge(emptyMessage));
    return;
  }

  groups.slice(0, 4).forEach(group => {
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
      departures.forEach(dep => {
        times.appendChild(createDepartureChip(dep));
      });
    } else if (group.minutes?.length) {
      group.minutes.forEach(min => {
        times.appendChild(createMinutesChip(min));
      });
    } else {
      times.appendChild(makeInfoBadge("--"));
    }

    row.appendChild(dest);
    if (statuses.length) {
      row.appendChild(statusWrap);
    }
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

function renderRerBlock(visits, trafficItem) {
  const parisEl = document.getElementById("rer-paris");
  const boissyEl = document.getElementById("rer-boissy");
  const otherEl = document.getElementById("rer-other");

  const rerVisits = (visits || []).filter(v => v.lineId === LINES.RER_A.id);
  let { paris, boissy, other } = classifyRerDestinations(rerVisits);

  if (!paris.length && other.length) {
    paris = other;
    other = [];
  }

  if (!boissy.length && other.length) {
    boissy = other;
    other = [];
  }

  renderRerDirection(parisEl, paris);
  renderRerDirection(boissyEl, boissy);
  renderRerDirection(otherEl, other, "Aucune autre destination pour le moment.");

  updateLineAlert(document.getElementById("traffic-rer-line"), trafficItem);
  updateStationStatus("rer-station-info", "Joinville-le-Pont", trafficItem);
}

function normaliseKey(str = "") {
  if (!str) return "";
  let value = str.toString();
  if (typeof value.normalize === "function") {
    value = value.normalize("NFD");
  }
  value = value.replace(/[\u0300-\u036f]/g, "");
  return value.toLowerCase();
}

function findStationTrafficMatch(stationName, trafficMap = {}) {
  const key = normaliseKey(stationName);
  if (!key) return null;
  for (const item of Object.values(trafficMap)) {
    if (!item) continue;
    const messages = Array.isArray(item.messages) ? item.messages : [];
    const match = messages.find(message => normaliseKey(message).includes(key));
    if (match) {
      return { item, message: match };
    }
  }
  return null;
}

function deriveStationSummary(stop, statuses, trafficMap) {
  let text = formatStationSummary(statuses);
  let className = getStationStatusClass(statuses);
  const stationMatch = findStationTrafficMatch(stop.name, trafficMap);
  if (stationMatch) {
    const { item, message } = stationMatch;
    text = message;
    className = item.status === "alert" ? "alert" : item.status === "unknown" ? "unknown" : "ok";
  } else {
    const items = Object.values(trafficMap || {});
    const alertItem = items.find(entry => entry?.status === "alert");
    const unknownItem = items.find(entry => entry?.status === "unknown");
    if ((!statuses.length || className === "ok") && alertItem) {
      text = alertItem.message || `Perturbations sur ${alertItem.label || "la ligne"}.`;
      className = "alert";
    } else if (!statuses.length && unknownItem) {
      text =
        unknownItem.message || `Information trafic indisponible sur ${unknownItem.label || "la ligne"}.`;
      className = "unknown";
    }
  }
  if (!text) {
    text = "Trafic normal";
    className = "ok";
  }
  return { text, className };
}

function formatAlertList(items) {
  const list = Array.from(items || []);
  if (!list.length) return "";
  const max = 3;
  const display = list.slice(0, max).join(" · ");
  return list.length > max ? `${display}…` : display;
}

function collectStationAlerts(stop) {
  if (!stop) return [];

  const ended = new Set();
  const delays = new Set();
  const unknown = new Set();

  (stop.lines || []).forEach(line => {
    const metaId = line.lineId || line.lineRef;
    const meta =
      (line.lineId && lineMetaCache.get(line.lineId)) || fallbackLineMeta(metaId);
    const lineLabel = meta?.code || meta?.id || metaId || "Ligne";

    (line.destinations || []).forEach(dest => {
      const destination = dest.display || dest.fullDestination || "Destination";
      const label = `${lineLabel} → ${destination}`;
      const statuses = trimStatusList(dest.statusSummary);

      statuses.forEach(tag => {
        if (tag.type === "cancelled" || tag.type === "ended") {
          ended.add(label);
        } else if (tag.type === "delay") {
          delays.add(label);
        } else if (tag.type === "unknown") {
          unknown.add(label);
        }
      });
    });
  });

  const messages = [];
  const endedText = formatAlertList(ended);
  if (endedText) {
    messages.push(`Non desservis : ${endedText}`);
  }
  const delaysText = formatAlertList(delays);
  if (delaysText) {
    messages.push(`Retards : ${delaysText}`);
  }
  const unknownText = formatAlertList(unknown);
  if (unknownText) {
    messages.push(`Temps réel partiel : ${unknownText}`);
  }

  return messages;
}

function buildBusSummary(processedStops, trafficMap) {
  if (!processedStops.length) {
    return { text: "Données bus indisponibles pour le moment.", className: "unknown" };
  }

  const items = Object.values(trafficMap || {});
  const alertItem = items.find(entry => entry?.status === "alert");
  if (alertItem) {
    return {
      text: alertItem.message || `Perturbations sur ${alertItem.label || "la ligne"}.`,
      className: "alert"
    };
  }

  const hasSevere = processedStops.some(({ statuses }) =>
    statuses.some(tag => ["delay", "cancelled", "ended"].includes(tag.type))
  );
  if (hasSevere) {
    return { text: "Perturbations sur certaines stations.", className: "alert" };
  }

  const unknownItem = items.find(entry => entry?.status === "unknown");
  const hasUnknown = processedStops.some(({ statuses }) => statuses.some(tag => tag.type === "unknown"));
  if (unknownItem || hasUnknown) {
    return {
      text: unknownItem?.message || "Temps réel partiel sur certaines stations.",
      className: "unknown"
    };
  }

  const count = processedStops.length;
  return {
    text: `${count} station${count > 1 ? "s" : ""} suivie${count > 1 ? "s" : ""}`,
    className: "ok"
  };
}

function renderBusTrafficHeader(container, trafficMap = {}) {
  if (!container) return;
  container.innerHTML = "";
  const lines = [LINES.BUS_77, LINES.BUS_106, LINES.BUS_201];
  lines.forEach(line => {
    const row = document.createElement("div");
    row.className = "bus-traffic-row";
    const meta = lineMetaCache.get(line.id) || fallbackLineMeta(line.id);

    const badge = document.createElement("span");
    badge.className = "line-pill";
    badge.textContent = meta.code || meta.id || line.label;
    badge.style.setProperty("--line-color", meta.color);
    badge.style.setProperty("--line-text", meta.textColor);

    const trafficItem = trafficMap[line.id];
    const status = trafficItem?.status || "unknown";
    const text = document.createElement("span");
    text.className = `line-alert-text ${status}`;
    let message = trafficItem?.message;
    if (!message) {
      if (status === "alert") {
        message = `Perturbations sur ${trafficItem?.label || meta.code || meta.id || line.label}.`;
      } else if (status === "ok") {
        message = "Trafic normal";
      } else {
        message = "Information trafic indisponible";
      }
    }
    text.textContent = message;

    row.appendChild(badge);
    row.appendChild(text);
    container.appendChild(row);
  });

  if (!container.children.length) {
    container.appendChild(makeInfoBadge("Information trafic indisponible"));
  }
}

async function renderBusBoard(visits, trafficMap = {}) {
  const container = document.getElementById("bus-stations");
  const summaryEl = document.getElementById("bus-summary");
  const trafficEl = document.getElementById("bus-traffic");
  if (!container) return;

  container.innerHTML = "";

  const stops = groupVisitsByStop(visits || []).filter(stop => stop.lines.length);

  const busTrafficIds = [LINES.BUS_77.id, LINES.BUS_106.id, LINES.BUS_201.id];
  const busTrafficMap = busTrafficIds.reduce((acc, id) => {
    acc[id] = trafficMap?.[id] || null;
    return acc;
  }, {});

  const lineGroups = [
    { lineId: LINES.BUS_77.id },
    { lineId: LINES.BUS_106.id },
    { lineId: LINES.BUS_201.id },
    ...stops.flatMap(stop => stop.lines)
  ];
  await ensureLineMetas(lineGroups);

  renderBusTrafficHeader(trafficEl, busTrafficMap);

  if (!stops.length) {
    if (summaryEl) {
      summaryEl.textContent = "Données bus indisponibles pour le moment.";
      summaryEl.className = "block-sub bus-summary unknown";
    }
    container.appendChild(makeInfoBadge("Aucun passage en temps réel pour l'instant."));
    return;
  }

  const processedStops = stops
    .slice()
    .sort((a, b) => {
      const priority = stopPriority(a.name) - stopPriority(b.name);
      if (priority !== 0) return priority;
      return (a.name || "").localeCompare(b.name || "", "fr", { numeric: true });
    })
    .map(stop => ({ stop, statuses: trimStatusList(stop.statusSummary) }));

  if (summaryEl) {
    const summaryInfo = buildBusSummary(processedStops, busTrafficMap);
    summaryEl.textContent = summaryInfo.text;
    summaryEl.className = `block-sub bus-summary ${summaryInfo.className}`;
  }

  const currentClock = document.getElementById("clock")?.textContent || "--:--";
  const lastUpdateText = document.getElementById("lastUpdate")?.textContent || "";

  processedStops.forEach(({ stop, statuses }) => {
    const card = document.createElement("article");
    card.className = "bus-station-card";
    card.setAttribute("role", "listitem");
    card.setAttribute("aria-label", `Station ${stop.name || "bus"}`);

    const header = document.createElement("div");
    header.className = "bus-board-header";

    const heading = document.createElement("div");
    heading.className = "bus-board-heading";

    const title = document.createElement("h3");
    title.className = "bus-board-title";
    title.textContent = stop.name || "Station";
    heading.appendChild(title);

    const stationSummary = deriveStationSummary(stop, statuses, busTrafficMap);
    const summary = document.createElement("p");
    summary.className = `bus-board-summary ${stationSummary.className}`;
    summary.textContent = stationSummary.text;
    heading.appendChild(summary);

    if (statuses.length) {
      const statusWrap = document.createElement("div");
      statusWrap.className = "status-group bus-board-status";
      statuses.forEach(tag => statusWrap.appendChild(createStatusChip(tag)));
      heading.appendChild(statusWrap);
    }

    header.appendChild(heading);

    const clockWrap = document.createElement("div");
    clockWrap.className = "bus-board-clock";

    const clockLabel = document.createElement("span");
    clockLabel.className = "bus-board-clock-label";
    clockLabel.textContent = "Temps d’attente en minutes";
    clockWrap.appendChild(clockLabel);

    const clockValue = document.createElement("span");
    clockValue.className = "bus-board-clock-value board-clock";
    clockValue.textContent = currentClock;
    clockWrap.appendChild(clockValue);

    header.appendChild(clockWrap);

    card.appendChild(header);

    const table = document.createElement("div");
    table.className = "bus-board-table";

    const sortedLines = stop.lines
      .slice()
      .sort((a, b) => {
        const idA = a.lineId || a.lineRef;
        const idB = b.lineId || b.lineRef;
        const metaA =
          (a.lineId && lineMetaCache.get(a.lineId)) || fallbackLineMeta(idA);
        const metaB =
          (b.lineId && lineMetaCache.get(b.lineId)) || fallbackLineMeta(idB);
        return (metaA.code || idA || "").localeCompare(metaB.code || idB || "", "fr", {
          numeric: true
        });
      });

    if (!sortedLines.length) {
      const empty = document.createElement("div");
      empty.className = "bus-board-empty";
      empty.appendChild(makeInfoBadge("Pas de passage suivi pour le moment."));
      table.appendChild(empty);
    }

    sortedLines.forEach(line => {
      const metaId = line.lineId || line.lineRef;
      const meta =
        (line.lineId && lineMetaCache.get(line.lineId)) || fallbackLineMeta(metaId);
      const lineStatuses = trimStatusList(line.statusSummary);
      const destinations = Array.isArray(line.destinations) ? line.destinations : [];

      destinations.forEach((dest, destIndex) => {
        const row = document.createElement("div");
        row.className = "bus-board-row";

        const lineCell = document.createElement("div");
        lineCell.className = "bus-board-line";
        const badge = document.createElement("span");
        badge.className = "line-pill";
        badge.textContent = meta.code || meta.id || line.lineRef || "—";
        badge.style.setProperty("--line-color", meta.color);
        badge.style.setProperty("--line-text", meta.textColor);
        lineCell.appendChild(badge);
        row.appendChild(lineCell);

        const destCell = document.createElement("div");
        destCell.className = "bus-board-destination";

        const destName = document.createElement("div");
        destName.className = "destination-name";
        destName.textContent = dest.display || dest.fullDestination || "Destination à préciser";
        destCell.appendChild(destName);

        if (dest.fullDestination && dest.fullDestination !== dest.display) {
          const alt = document.createElement("div");
          alt.className = "destination-alt";
          alt.textContent = dest.fullDestination;
          destCell.appendChild(alt);
        } else if (dest.direction) {
          const dir = document.createElement("div");
          dir.className = "destination-alt";
          dir.textContent = dest.direction;
          destCell.appendChild(dir);
        }

        const destStatuses = mergeStatusTags(
          destIndex === 0 ? lineStatuses : [],
          trimStatusList(dest.statusSummary)
        );
        if (destStatuses.length) {
          const statusWrap = document.createElement("div");
          statusWrap.className = "status-group destination-status";
          destStatuses.forEach(tag => statusWrap.appendChild(createStatusChip(tag)));
          destCell.appendChild(statusWrap);
        }

        row.appendChild(destCell);

        const times = document.createElement("div");
        times.className = "bus-board-times";
        if (dest.departures.length) {
          dest.departures.forEach(dep => times.appendChild(createDepartureChip(dep)));
        } else {
          times.appendChild(makeInfoBadge("--"));
        }
        row.appendChild(times);

        table.appendChild(row);
      });

      const trafficKey =
        line.lineId ||
        (line.lineRef && line.lineRef.match(/C\d{5}/)?.[0]) ||
        line.lineRef;
      const trafficItem = busTrafficMap[trafficKey];
      const trafficStatus = trafficItem?.status || "unknown";
      const trafficMessage =
        trafficItem?.message ||
        (trafficStatus === "alert"
          ? `Perturbations sur ${trafficItem?.label || meta.code || meta.id}.`
          : trafficStatus === "ok"
          ? "Trafic normal"
          : "Information trafic indisponible");

      const trafficRow = document.createElement("div");
      trafficRow.className = `bus-board-line-traffic ${trafficStatus}`;

      const label = document.createElement("span");
      label.className = "traffic-label";
      label.textContent = `Ligne ${meta.code || meta.id || trafficKey}`;
      trafficRow.appendChild(label);

      const text = document.createElement("span");
      text.className = "traffic-text";
      text.textContent = trafficMessage;
      trafficRow.appendChild(text);

      table.appendChild(trafficRow);
    });

    card.appendChild(table);

    const footer = document.createElement("div");
    footer.className = "bus-board-footer";

    const footerMessages = collectStationAlerts(stop);
    if (footerMessages.length) {
      footerMessages.forEach(text => {
        const p = document.createElement("p");
        p.className = "bus-board-footer-message";
        p.textContent = text;
        footer.appendChild(p);
      });
    } else {
      const p = document.createElement("p");
      p.className = "bus-board-footer-message";
      p.textContent = "Tous les services annoncés.";
      footer.appendChild(p);
    }

    if (lastUpdateText) {
      const update = document.createElement("p");
      update.className = "bus-board-footer-update";
      update.textContent = lastUpdateText;
      footer.appendChild(update);
    }

    card.appendChild(footer);
    container.appendChild(card);
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
  const cleanedMessages = Array.isArray(messages)
    ? messages.map(m => cleanText(m)).filter(Boolean)
    : [];

  if (messages === null) {
    status = "unknown";
    message = "Information trafic indisponible";
  } else if (cleanedMessages.length) {
    status = "alert";
    message = cleanedMessages[0];
  }

  return {
    id: line.id,
    code: meta.code,
    label: formatLineLabel(meta, line.label),
    color: meta.color,
    textColor: meta.textColor,
    status,
    message,
    messages: cleanedMessages
  };
}

function updateLineAlert(container, item) {
  if (!container) return;
  container.innerHTML = "";
  if (!item) {
    container.appendChild(makeInfoBadge("Information trafic indisponible"));
    return;
  }

  const badge = document.createElement("span");
  badge.className = "line-pill";
  badge.textContent = item.code || item.label;
  badge.style.setProperty("--line-color", item.color);
  badge.style.setProperty("--line-text", item.textColor);

  const text = document.createElement("span");
  text.className = `line-alert-text ${item.status}`;
  text.textContent = item.message;

  container.appendChild(badge);
  container.appendChild(text);
}

function updateStationStatus(elementId, stationName, trafficItem) {
  const el = document.getElementById(elementId);
  if (!el) return;

  let statusClass = "ok";
  let text = `Station ${stationName} · trafic normal`;

  if (!trafficItem) {
    statusClass = "unknown";
    text = `Station ${stationName} · information indisponible`;
  } else {
    statusClass = trafficItem.status || "ok";
    const stationMessage = trafficItem.messages?.find(msg =>
      msg?.toLowerCase().includes(stationName.toLowerCase())
    );

    if (stationMessage) {
      text = stationMessage;
    } else if (trafficItem.status === "alert") {
      text = trafficItem.message;
    } else if (trafficItem.status === "unknown") {
      text = `Station ${stationName} · information indisponible`;
    }
  }

  el.textContent = text;
  el.className = `block-sub station-status ${statusClass}`;
}

function formatCourseDate(date) {
  return date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

function formatCountdown(timestamp) {
  if (!timestamp) return "--";
  const diff = timestamp - Date.now();
  if (diff <= 60000) return "Imminent";

  const totalSeconds = Math.max(0, Math.floor(diff / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days} j ${hours.toString().padStart(2, "0")} h`;
  }
  if (hours > 0) {
    return `${hours} h ${minutes.toString().padStart(2, "0")} min`;
  }
  return `${Math.max(minutes, 1)} min`;
}

function updateCourseHeader() {
  const dateEl = document.getElementById("courses-date");
  const countdownEl = document.getElementById("courses-countdown");
  if (!dateEl || !countdownEl) return;

  if (!coursesState.length) {
    dateEl.textContent = "Aucune course planifiée";
    countdownEl.textContent = "--";
    return;
  }

  const first = coursesState[0];
  const start = new Date(first.ts);
  dateEl.textContent = `Courses du ${formatCourseDate(start)}`;
  countdownEl.textContent = formatCountdown(first.ts);
}

function updateCourseCountdown() {
  if (!coursesState.length) return;
  updateCourseHeader();
  document.querySelectorAll(".course-countdown").forEach(el => {
    const ts = Number(el.dataset.countdown);
    if (Number.isNaN(ts)) return;
    el.textContent = formatCountdown(ts);
  });
}

function renderCourses(courses) {
  const container = document.getElementById("courses-list");
  if (!container) return;
  container.innerHTML = "";

  coursesState = Array.isArray(courses) ? [...courses] : [];
  updateCourseHeader();

  if (!coursesState.length) {
    container.appendChild(makeInfoBadge("Pas de prochaine course identifiée."));
    return;
  }

  coursesState.forEach(course => {
    const row = document.createElement("div");
    row.className = "course-row";

    const time = document.createElement("div");
    time.className = "course-time";
    const start = new Date(course.ts);
    const dateLabel = start.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
    const hourLabel = start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    time.textContent = `${dateLabel} · ${hourLabel}`;

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

    const countdown = document.createElement("div");
    countdown.className = "course-countdown";
    countdown.dataset.countdown = course.ts;
    countdown.textContent = formatCountdown(course.ts);

    const prize = document.createElement("div");
    prize.className = "course-prize";
    const prizeValue = typeof course.dotation === "number" ? (course.dotation / 1000).toFixed(0) : "—";
    prize.textContent = `${prizeValue} k€`;

    row.appendChild(time);
    row.appendChild(info);
    row.appendChild(countdown);
    row.appendChild(prize);
    container.appendChild(row);
  });
}

function renderWeather(weather) {
  const tempEl = document.getElementById("weather-temp");
  const descEl = document.getElementById("weather-desc");
  const extraEl = document.getElementById("weather-extra");
  const iconEl = document.getElementById("weather-icon");

  if (!weather?.current_weather) {
    if (descEl) descEl.textContent = "Météo indisponible";
    if (tempEl) tempEl.textContent = "--°";
    if (extraEl) extraEl.textContent = "";
    if (iconEl) {
      iconEl.className = "weather-icon weather-unknown";
      iconEl.innerHTML = '<div class="weather-shape"></div>';
    }
    return;
  }

  const { temperature, windspeed, weathercode } = weather.current_weather;
  if (tempEl) tempEl.textContent = `${Math.round(temperature)}°`;
  if (descEl) descEl.textContent = WEATHER_CODES[weathercode] || "Conditions actuelles";
  if (extraEl) extraEl.textContent = `Vent ${Math.round(windspeed)} km/h`;
  if (iconEl) {
    const weatherClass = getWeatherClass(weathercode);
    iconEl.className = `weather-icon ${weatherClass}`;
    iconEl.innerHTML = '<div class="weather-shape"></div>';
  }
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

function normaliseSytadinEntries(data) {
  if (!data) return [];
  let source = [];
  if (Array.isArray(data)) {
    source = data;
  } else if (Array.isArray(data?.axes)) {
    source = data.axes;
  } else if (Array.isArray(data?.records)) {
    source = data.records.map(record => record.fields || record);
  } else if (Array.isArray(data?.features)) {
    source = data.features.map(feature => feature.properties || feature);
  }

  return source
    .map(item => {
      const name = cleanText(
        item.libelle || item.axis || item.name || item.nom || item.route || item.axe || ""
      );
      const direction = cleanText(item.sens || item.direction || item.itineraire || item.dest || "");
      const status = item.indice_trafic ?? item.indice ?? item.indice_congestion ?? item.status ?? item.etat;
      const travel =
        item.temps ?? item.temps_parcours ?? item.travel_time ?? item.duree ?? item.duree_parcours ?? item.tps;
      const length = item.longueur ?? item.longueur_bouchon ?? item.bouchon ?? item.length ?? item.km;
      const note = cleanText(item.message || item.commentaire || item.detail || item.description || "");
      const updated = item.horodatage || item.date_maj || item.last_update || item.datetime || item.date;

      return {
        name,
        direction,
        status,
        travel,
        length,
        note,
        updated,
        raw: item
      };
    })
    .filter(entry => entry.name);
}

function interpretSytadinStatus(entry) {
  if (typeof entry.status === "number" && SYTADIN_STATUS_LOOKUP[entry.status]) {
    return SYTADIN_STATUS_LOOKUP[entry.status];
  }

  const str = (entry.status || "").toString().toLowerCase();
  if (!str) return { text: "Indisponible", className: "unknown", severity: 0 };
  if (str.includes("fluide")) return { text: "Fluide", className: "fluid", severity: 1 };
  if (str.includes("dense") || str.includes("ralenti")) return { text: "Dense", className: "dense", severity: 2 };
  if (str.includes("bouch") || str.includes("congestion") || str.includes("bloqu")) {
    return { text: "Bouchons", className: "jam", severity: 3 };
  }
  return { text: cleanText(entry.status), className: "unknown", severity: 1 };
}

function formatTravelTime(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return `${Math.round(value)} min`;
  const str = value.toString().trim();
  if (!str) return null;
  const numeric = Number(str.replace(",", "."));
  if (!Number.isNaN(numeric)) return `${Math.round(numeric)} min`;
  return cleanText(str);
}

function formatDistance(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const display = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${display} km`;
  }
  const str = value.toString().trim();
  if (!str) return null;
  const numeric = Number(str.replace(",", "."));
  if (!Number.isNaN(numeric)) {
    const display = numeric >= 10 ? Math.round(numeric) : Math.round(numeric * 10) / 10;
    return `${display} km`;
  }
  return cleanText(str);
}

function filterSytadinEntries(entries) {
  if (!entries.length) return [];
  const enriched = entries.map(entry => ({
    ...entry,
    statusInfo: interpretSytadinStatus(entry),
    travelLabel: formatTravelTime(entry.travel),
    lengthLabel: formatDistance(entry.length)
  }));

  const matched = enriched.filter(entry => {
    const label = `${entry.name} ${entry.direction}`.toLowerCase();
    return SYTADIN_KEYWORDS.some(regex => regex.test(label));
  });

  const base = matched.length ? matched : enriched;
  return base.sort((a, b) => (b.statusInfo.severity || 0) - (a.statusInfo.severity || 0)).slice(0, 5);
}

function renderSytadin(data) {
  const list = document.getElementById("sytadin-list");
  const update = document.getElementById("sytadin-update");
  if (!list || !update) return;

  list.innerHTML = "";
  const entries = filterSytadinEntries(normaliseSytadinEntries(data));

  if (!entries.length) {
    list.appendChild(makeInfoBadge("Information trafic Sytadin indisponible."));
    update.textContent = "Mise à jour indisponible";
    return;
  }

  const latest = entries
    .map(entry => {
      if (!entry.updated) return null;
      const time = new Date(entry.updated).getTime();
      return Number.isNaN(time) ? null : time;
    })
    .filter(Boolean)
    .sort((a, b) => b - a)[0];

  update.textContent = latest
    ? `Mise à jour : ${new Date(latest).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
    : "Mise à jour : --:--";

  entries.forEach(entry => {
    const card = document.createElement("article");
    card.className = "road-card";

    const header = document.createElement("div");
    header.className = "road-header";

    const axis = document.createElement("div");
    axis.className = "road-axis";
    axis.textContent = entry.direction ? `${entry.name} · ${entry.direction}` : entry.name;

    const status = document.createElement("span");
    status.className = `road-status ${entry.statusInfo.className}`;
    status.textContent = entry.statusInfo.text;

    header.appendChild(axis);
    header.appendChild(status);
    card.appendChild(header);

    const meta = document.createElement("div");
    meta.className = "road-meta";

    if (entry.travelLabel) {
      const travel = document.createElement("span");
      travel.textContent = `Trajet : ${entry.travelLabel}`;
      meta.appendChild(travel);
    }

    if (entry.lengthLabel) {
      const length = document.createElement("span");
      length.textContent = `Bouchon : ${entry.lengthLabel}`;
      meta.appendChild(length);
    }

    if (meta.childElementCount) {
      card.appendChild(meta);
    }

    if (entry.note) {
      const note = document.createElement("p");
      note.className = "road-note";
      note.textContent = entry.note;
      card.appendChild(note);
    }

    list.appendChild(card);
  });
}

async function refreshSytadin() {
  try {
    const data = await fetchJSON(PROXY + encodeURIComponent(SYTADIN_URL), 15000);
    renderSytadin(data);
  } catch (error) {
    console.error("Sytadin", error);
    renderSytadin(null);
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
      traffic106,
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
      fetchTraffic(LINES.BUS_106.navitia),
      fetchTraffic(LINES.BUS_201.navitia)
    ]);

    const rerVisits = parseStop(rerRaw);
    const joinvilleVisits = parseStop(joinvilleRaw);
    const hippodromeVisits = parseStop(hippodromeRaw);
    const breuilVisits = parseStop(breuilRaw);

    const trafficItems = await Promise.all([
      buildTrafficItem(LINES.RER_A, trafficRer),
      buildTrafficItem(LINES.BUS_77, traffic77),
      buildTrafficItem(LINES.BUS_106, traffic106),
      buildTrafficItem(LINES.BUS_201, traffic201)
    ]);

    const trafficMap = {};
    trafficItems.filter(Boolean).forEach(item => {
      trafficMap[item.id] = item;
    });

    renderRerBlock(rerVisits, trafficMap[LINES.RER_A.id]);
    await renderBusBoard([...joinvilleVisits, ...hippodromeVisits, ...breuilVisits], trafficMap);
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
  setInterval(refreshSytadin, 5 * 60 * 1000);
  setInterval(nextNews, 20000);
  setInterval(updateCourseCountdown, 1000);
  setInterval(setClock, 1000);
}

async function init() {
  setClock();

  await Promise.all([
    refreshTransport(),
    refreshWeather(),
    refreshCourses(),
    refreshNews(),
    updateVelibCards(),
    refreshSytadin()
  ]);

  startLoops();
}

init();
