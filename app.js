// Tableau d'affichage – Hippodrome Paris-Vincennes

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

const STATUS_DEFINITIONS = {
  normal: { label: "Affichage", priority: 5 },
  delay: { label: "Retard", priority: 2 },
  cancelled: { label: "Suppression", priority: 1 },
  first: { label: "Premier service", priority: 3 },
  last: { label: "Dernier service", priority: 3 },
  ended: { label: "Service terminé", priority: 1 },
  unknown: { label: "Non disponible", priority: 6 }
};

const lineMetaCache = new Map();
let newsItems = [];
let currentNews = 0;
let coursesState = [];

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

  if (options?.title) {
    span.title = options.title;
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
  if (tags.some(tag => tag.type === "unknown")) return "unknown";
  if (tags.some(tag => ["delay", "cancelled", "ended"].includes(tag.type))) return "alert";
  return "ok";
}

function formatStationSummary(tags = []) {
  if (!tags?.length) return "Trafic normal";
  return tags.map(tag => tag.label).join(" · ");
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

  if (minutes == null) {
    return makeTimeChip("--", "", {
      variant: "unknown",
      title: tooltip || "Horaire indisponible"
    });
  }

  if (minutes === 0) {
    return makeTimeChip("À quai", "", {
      variant: "now",
      title: tooltip || "Départ imminent",
      time: timeLabel || ""
    });
  }

  if (minutes > 30) {
    if (timeLabel) {
      return makeTimeChip(timeLabel, `${minutes} min`, {
        variant: "long",
        title: tooltip || undefined
      });
    }

    return makeTimeChip(String(minutes), "min", {
      variant: "long",
      title: tooltip || undefined
    });
  }

  const variant = minutes <= 5 ? "soon" : "regular";

  return makeTimeChip(String(minutes), "min", {
    variant,
    title: tooltip || undefined,
    time: timeLabel || ""
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

function renderDirectionList(container, groups, emptyMessage = "Aucune donnée en temps réel.") {
  if (!container) return;
  container.innerHTML = "";

  if (!groups?.length) {
    container.appendChild(makeInfoBadge(emptyMessage));
    return;
  }

  groups.slice(0, 3).forEach(group => {
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

async function renderBusStation(container, stationName, visits, trafficMap = {}) {
  if (!container) return;

  const stationDiv = document.createElement("div");
  stationDiv.className = "bus-block";

  const title = document.createElement("h3");
  title.textContent = stationName;
  stationDiv.appendChild(title);

  const summary = document.createElement("div");
  summary.className = "bus-summary";
  stationDiv.appendChild(summary);

  const linesDiv = document.createElement("div");
  linesDiv.className = "bus-lines";
  stationDiv.appendChild(linesDiv);

  // Grouper par ligne/destination
  const groupedVisits = groupByLineDestination(visits);
  
  if (!groupedVisits.length) {
    summary.textContent = "Aucun passage prévu";
    summary.className = "bus-summary unknown";
    container.appendChild(stationDiv);
    return;
  }

  // Récupérer métadonnées des lignes
  const lineIds = [...new Set(groupedVisits.map(g => g.lineId).filter(Boolean))];
  await Promise.all(lineIds.map(id => fetchLineMetadata(id)));

  // Calculer statut global de la station
  const allTags = groupedVisits.flatMap(g => g.statusSummary);
  const statusClass = getStationStatusClass(allTags);
  summary.textContent = formatStationSummary(allTags);
  summary.className = `bus-summary ${statusClass}`;

  // Afficher chaque ligne/destination
  groupedVisits.slice(0, 3).forEach(group => {
    const lineDiv = document.createElement("div");
    lineDiv.className = "bus-line";

    // Pill de la ligne
    const meta = lineMetaCache.get(group.lineId) || fallbackLineMeta(group.lineId);
    const pill = document.createElement("span");
    pill.className = "line-pill";
    pill.textContent = meta.code || meta.id || "—";
    pill.style.setProperty("--line-color", meta.color);
    pill.style.setProperty("--line-text", meta.textColor);
    lineDiv.appendChild(pill);

    // Destination
    const destDiv = document.createElement("div");
    destDiv.className = "bus-destination";
    destDiv.textContent = group.display || "Destination à préciser";
    lineDiv.appendChild(destDiv);

    // Horaires
    const timesDiv = document.createElement("div");
    timesDiv.className = "bus-times";
    if (group.departures.length) {
      group.departures.forEach(dep => {
        timesDiv.appendChild(createDepartureChip(dep));
      });
    } else {
      timesDiv.appendChild(makeInfoBadge("--"));
    }
    lineDiv.appendChild(timesDiv);

    linesDiv.appendChild(lineDiv);
  });

  container.appendChild(stationDiv);
}

function setClock() {
  const now = new Date();
  const label = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const el = document.getElementById("clock");
  if (el) {
    el.textContent = label;
  }
}

function setLastUpdate() {
  const el = document.getElementById("lastUpdate");
  if (!el) return;
  const now = new Date();
  el.textContent = `Maj ${now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

async function refreshTransport() {
  try {
    const [
      rerRaw,
      joinvilleRaw,
      hippodromeRaw,
      breuilRaw
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
      )
    ]);

    const rerVisits = parseStop(rerRaw);
    const joinvilleVisits = parseStop(joinvilleRaw);
    const hippodromeVisits = parseStop(hippodromeRaw);
    const breuilVisits = parseStop(breuilRaw);

    // Rendu RER
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
      renderDirectionList(parisList, paris);
      
      const boissyCol = document.createElement("div");
      boissyCol.className = "rer-column";
      const boissyTitle = document.createElement("h3");
      boissyTitle.textContent = "Vers Boissy / Marne-la-Vallée";
      boissyCol.appendChild(boissyTitle);
      const boissyList = document.createElement("div");
      boissyList.className = "rer-list";
      boissyCol.appendChild(boissyList);
      renderDirectionList(boissyList, boissy);
      
      rerContainer.appendChild(parisCol);
      rerContainer.appendChild(boissyCol);
    }

    // Rendu Bus
    const busContainer = document.getElementById("bus-blocks");
    if (busContainer) {
      busContainer.innerHTML = "";
      
      await renderBusStation(busContainer, "Hippodrome de Vincennes", hippodromeVisits);
      await renderBusStation(busContainer, "Joinville-le-Pont RER", joinvilleVisits);
      await renderBusStation(busContainer, "École du Breuil", breuilVisits);
    }

    setLastUpdate();
  } catch (error) {
    console.error("refreshTransport", error);
  }
}

async function refreshWeather() {
  const data = await fetchJSON(WEATHER_URL, 10000);
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

async function refreshVelib() {
  for (const [key, stationId] of Object.entries(VELIB_STATIONS)) {
    try {
      const url = `https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/velib-disponibilite-en-temps-reel/exports/json?lang=fr&qv1=(${stationId})&timezone=Europe%2FParis`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const station = Array.isArray(data) ? data[0] : null;
      
      const container = document.getElementById(`velib-${key.toLowerCase()}`);
      if (container && station) {
        container.textContent = `🚲 ${station.mechanical || 0} méca  🔌 ${station.ebike || 0} élec  🅿️ ${station.numdocksavailable || 0} bornes`;
      }
    } catch (error) {
      console.error("Vélib'", stationId, error.message);
    }
  }
}

async function refreshNews() {
  const xml = await fetchText(PROXY + encodeURIComponent(RSS_URL), 15000);
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
    } catch (error) {
      console.error("RSS parse", error);
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

async function getVincennesCourses() {
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
    div.textContent = `${course.heure} • ${course.nom}`;
    container.appendChild(div);
  });
}

async function refreshRoad() {
  try {
    const data = await fetchJSON(PROXY + encodeURIComponent("https://opendata.sytadin.fr/velc/SYTR.json"), 15000);
    const container = document.getElementById("road-list");
    if (!container) return;
    
    if (!data) {
      container.textContent = "Information trafic Sytadin indisponible.";
      return;
    }

    const entries = Array.isArray(data) ? data : (data.records || []).map(r => r.fields || r);
    const filtered = entries
      .filter(e => e.libelle && /vincennes|joinville|breuil|a4|a86|périph/i.test(e.libelle))
      .slice(0, 3);

    container.innerHTML = "";
    filtered.forEach(entry => {
      const div = document.createElement("div");
      const status = entry.commentaire || entry.indice_traffic || "—";
      div.textContent = `${entry.libelle} • ${status}`;
      container.appendChild(div);
    });

    if (!filtered.length) {
      container.textContent = "Aucune information trafic pertinente.";
    }
  } catch (error) {
    console.error("Sytadin", error);
    const container = document.getElementById("road-list");
    if (container) container.textContent = "Erreur lors du chargement du trafic.";
  }
}

function startLoops() {
  setInterval(refreshTransport, 60 * 1000);
  setInterval(refreshWeather, 30 * 60 * 1000);
  setInterval(refreshCourses, 5 * 60 * 1000);
  setInterval(refreshNews, 15 * 60 * 1000);
  setInterval(refreshVelib, 3 * 60 * 1000);
  setInterval(refreshRoad, 5 * 60 * 1000);
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
    refreshVelib(),
    refreshRoad()
  ]);

  startLoops();
}

init();
