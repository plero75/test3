// Tableau bus Joinville-le-Pont – rendu inspiré des écrans IDFM

const PROXY = "https://ratp-proxy.hippodrome-proxy42.workers.dev/?url=";

const STOP_IDS = {
  JOINVILLE_AREA: "STIF:StopArea:SP:70640:",
  HIPPODROME: "STIF:StopArea:SP:463641:",
  BREUIL: "STIF:StopArea:SP:463644:"
};

const LINES = {
  BUS_77: "line:IDFM:C02251"
};

const FOCUS_LINE_ID = "C02251";

const lineMetaCache = new Map();

function decodeEntities(str = "") {
  return str
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
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

function minutesFromISO(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
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

function compareLineCodes(a = "", b = "") {
  const parse = value => {
    const match = value.match(/^([A-Za-z]*)(\d+)?/);
    if (!match) {
      return { prefix: value, number: Number.POSITIVE_INFINITY, raw: value };
    }
    return {
      prefix: match[1] || "",
      number: match[2] ? parseInt(match[2], 10) : Number.POSITIVE_INFINITY,
      raw: value
    };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa.prefix === pb.prefix) {
    if (pa.number === pb.number) {
      return pa.raw.localeCompare(pb.raw, "fr", { sensitivity: "base" });
    }
    return pa.number - pb.number;
  }
  return pa.prefix.localeCompare(pb.prefix, "fr", { sensitivity: "base" });
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
    color: "#4454b7",
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

async function renderJoinvilleBoard(visits) {
  const container = document.getElementById("board-list");
  if (!container) return;
  container.innerHTML = "";

  const groups = groupByLineDestination(visits);
  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "board-empty";
    empty.textContent = "Aucune donnée temps réel disponible pour le moment";
    container.appendChild(empty);
    return;
  }

  await ensureLineMetas(groups);

  const ordered = groups
    .map(group => ({
      ...group,
      meta: lineMetaCache.get(group.lineId) || fallbackLineMeta(group.lineId)
    }))
    .sort((a, b) => {
      const codeCompare = compareLineCodes(a.meta.code, b.meta.code);
      if (codeCompare !== 0) return codeCompare;
      return (a.display || "").localeCompare(b.display || "", "fr", { sensitivity: "base" });
    })
    .slice(0, 14);

  ordered.forEach(group => {
    const row = document.createElement("article");
    row.className = "board-row";

    const left = document.createElement("div");
    left.className = "row-left";

    const badge = document.createElement("span");
    badge.className = "line-pill";
    badge.textContent = group.meta.code || group.lineId || "—";
    badge.style.setProperty("--line-color", group.meta.color);
    badge.style.setProperty("--line-text", group.meta.textColor);

    const info = document.createElement("div");
    info.className = "row-info";

    const title = document.createElement("div");
    title.className = "row-destination";
    title.textContent = group.display || "Destination à préciser";

    info.appendChild(title);

    const detailsText = group.stopLabel || group.fullDestination || group.direction;
    if (detailsText) {
      const subtitle = document.createElement("div");
      subtitle.className = "row-details";
      subtitle.textContent = detailsText;
      info.appendChild(subtitle);
    }

    left.appendChild(badge);
    left.appendChild(info);

    const times = document.createElement("div");
    times.className = "row-times";

    if (group.minutes.length) {
      group.minutes.forEach(min => {
        const label = min === 0 ? "À quai" : `${min}`;
        times.appendChild(makeTimeChip(label));
      });
    } else {
      times.appendChild(makeInfoBadge("Information indisponible"));
    }

    row.appendChild(left);
    row.appendChild(times);
    container.appendChild(row);
  });
}

function filterLine(visits, lineId) {
  if (!Array.isArray(visits)) return [];
  return visits.filter(v => !lineId || v.lineId === lineId);
}

function renderFocusTimes(container, visits) {
  if (!container) return;
  container.innerHTML = "";

  if (!visits?.length) {
    container.appendChild(makeInfoBadge("Information indisponible"));
    return;
  }

  const minutes = visits
    .flatMap(v => v.minutes)
    .filter(m => typeof m === "number")
    .sort((a, b) => a - b)
    .slice(0, 3);

  if (!minutes.length) {
    container.appendChild(makeInfoBadge("Information indisponible"));
    return;
  }

  minutes.forEach(min => {
    const label = min === 0 ? "À quai" : `${min}`;
    container.appendChild(makeTimeChip(label));
  });
}

function renderTrafficPanel(container, messages, lineCode) {
  if (!container) return;
  container.innerHTML = "";

  if (messages === null) {
    const item = document.createElement("div");
    item.className = "traffic-item";
    item.textContent = "Trafic indisponible pour le moment";
    container.appendChild(item);
    return;
  }

  if (!messages.length) {
    const item = document.createElement("div");
    item.className = "traffic-item";
    item.textContent = `Trafic normal sur la ligne ${lineCode}`;
    container.appendChild(item);
    return;
  }

  messages.forEach(msg => {
    const item = document.createElement("div");
    item.className = "traffic-item";
    item.textContent = cleanText(msg);
    container.appendChild(item);
  });
}

function renderFocusSection(meta, focusData, trafficMessages) {
  const badge = document.getElementById("focus-line-badge");
  if (badge) {
    badge.textContent = meta.code;
    badge.style.setProperty("--line-color", meta.color);
    badge.style.setProperty("--line-text", meta.textColor);
  }

  const title = document.getElementById("focus-title");
  if (title) title.textContent = `Ligne ${meta.code}`;

  const directionLabel = focusData.direction || focusData.hip?.[0]?.display || focusData.joinville?.[0]?.display || focusData.breuil?.[0]?.display;
  const direction = document.getElementById("focus-line-direction");
  if (direction) {
    direction.textContent = directionLabel ? `Direction ${directionLabel}` : "Direction non renseignée";
  }

  renderFocusTimes(document.getElementById("focus-hippodrome"), focusData.hip);
  renderFocusTimes(document.getElementById("focus-breuil"), focusData.breuil);
  renderTrafficPanel(document.getElementById("focus-traffic"), trafficMessages, meta.code);
}

function updateTicker(messages, lineCode) {
  const ticker = document.getElementById("ticker-text");
  if (!ticker) return;

  if (messages === null) {
    ticker.textContent = "Info trafic indisponible pour le moment.";
  } else if (messages.length) {
    ticker.textContent = cleanText(messages[0]);
  } else {
    ticker.textContent = `Trafic normal sur la ligne ${lineCode}.`;
  }
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
  el.textContent = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
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

async function refreshAll() {
  try {
    const [joinvilleRaw, hippodromeRaw, breuilRaw, trafficMessages] = await Promise.all([
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
      fetchTraffic(LINES.BUS_77)
    ]);

    const joinvilleVisits = parseStop(joinvilleRaw);
    await renderJoinvilleBoard(joinvilleVisits);

    const hipVisits = filterLine(parseStop(hippodromeRaw), FOCUS_LINE_ID);
    const breuilVisits = filterLine(parseStop(breuilRaw), FOCUS_LINE_ID);
    const joinvilleFocus = filterLine(joinvilleVisits, FOCUS_LINE_ID);

    const direction =
      joinvilleFocus[0]?.display || hipVisits[0]?.display || breuilVisits[0]?.display || joinvilleVisits[0]?.display || "";

    const meta77 = await fetchLineMetadata(FOCUS_LINE_ID);

    renderFocusSection(
      meta77,
      { hip: hipVisits, breuil: breuilVisits, joinville: joinvilleFocus, direction },
      trafficMessages
    );
    updateTicker(trafficMessages, meta77.code);
    setLastUpdate();
  } catch (error) {
    console.error("Erreur lors de la mise à jour des données", error);
  }
}

function startLoops() {
  setClock();
  setLastUpdate();
  setInterval(setClock, 1000);
  setInterval(refreshAll, 60 * 1000);
}

async function init() {
  await refreshAll();
  startLoops();
}

init();
