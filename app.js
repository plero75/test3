// Import fonctions utils ici si en module, sinon copiez utils.js dans votre projet ...

const PROXY = "https://ratp-proxy.hippodrome-proxy42.workers.dev/?url=";
const API_BASE = "https://prim.iledefrance-mobilites.fr/marketplace";

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

// Fonction fetch JSON avec timeout & error
async function fetchJSON(url, timeout=12000){
  try{
    const c=new AbortController();
    const t=setTimeout(()=>c.abort(), timeout);
    const r=await fetch(url, { signal: c.signal, cache: 'no-store' });
    clearTimeout(t);
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }catch(e){
    console.error('fetchJSON', url, e.message);
    return null;
  }
}

// Analyse des données StopMonitoring en format simplifié
function parseStop(data){
  const visits=data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit;
  if(!Array.isArray(visits)) return [];
  return visits.map(v=>{
    const mv=v.MonitoredVehicleJourney||{};
    const call=mv.MonitoredCall||{};
    const lineRef=mv.LineRef?.value||mv.LineRef||'';
    const lineId=(lineRef.match(/C\d{5}/)||[null])[0];
    const destDisplay=call.DestinationDisplay?.[0]?.value||'';
    const expected=call.ExpectedDepartureTime||call.ExpectedArrivalTime||null;
    const status= call.DepartureStatus || call.ArrivalStatus || 'onTime';
    return {
      lineId,
      dest: destDisplay,
      minutes: minutesFromISO(expected),
      status
    };
  });
}

function minutesFromISO(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}

function formatTimeBox(v){
  if (v.minutes === 0) return `<div class="time-box time-imminent">🚉 À quai</div>`;
  if (v.minutes !== null && v.minutes <= 1) return `<div class="time-box time-imminent">🟢 Imminent</div>`;
  if (v.status === "cancelled") return `<div class="time-box time-cancelled">❌ Supprimé</div>`;
  if (v.status === "last") return `<div class="time-box time-last">🔴 Dernier passage</div>`;
  if (v.status === "delayed") return `<div class="time-box time-delay">⏳ Retardé</div>`;
  const label = Number.isFinite(v.minutes) ? `${v.minutes} min` : "—";
  return `<div class="time-box">${label}</div>`;
}

function renderStatus(status, minutes){
  const normalized = (status || "").toLowerCase();
  switch(normalized){
    case "cancelled": return `<span class="time-cancelled">❌ Supprimé</span>`;
    case "delayed": return `<span class="time-delay">⏳ Retardé</span>`;
    case "last": return `<span class="time-last">🔴 Dernier passage</span>`;
    case "notstopping": return `<span class="time-cancelled">🚫 Non desservi</span>`;
    case "noservice": return `<span class="time-cancelled">⚠️ Service terminé</span>`;
  }
  if (minutes === 0) return `<span class="time-imminent">🚉 À quai</span>`;
  return `<span class="time-estimated">🟢 OK</span>`;
}

// Fonction affichage dynamique RER A
async function renderRer(){
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

  // Gérez ici récupération messages info trafic
  const messages = await fetchJSON(`${PROXY}${API_BASE}/general-message?LineRef=${LINES_SIRI.RER_A}`);
  if (messages?.Siri?.ServiceDelivery?.GeneralMessageDelivery?.[0]?.InfoMessage?.length > 0) {
    statusEl.textContent = messages.Siri.ServiceDelivery.GeneralMessageDelivery[0].InfoMessage[0].Content.Message[0].MessageText[0].value;
    statusEl.classList.add("alert");
  } else {
    statusEl.textContent = "✅ Trafic normal sur la ligne";
    statusEl.classList.remove("alert");
  }
}

// Fonction appelée pour rafraîchir Bus par arrêt
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

  // Grouper par ligne
  const byLine = {};
  visits.forEach(v => {
    if (!byLine[v.lineId]) byLine[v.lineId] = [];
    byLine[v.lineId].push(v);
  });

  Object.entries(byLine).forEach(([lineId, trips]) => {
    const card = document.createElement("div");
    card.className = "bus-card";

    const header = document.createElement("div");
    header.className = "bus-card-header";
    header.innerHTML = `<span class="line-pill">${lineId.replace("C0","")}</span> <span class="bus-card-dest">${trips[0].dest || "—"}</span>`;
    card.appendChild(header);

    const timesEl = document.createElement("div");
    timesEl.className = "times";
    trips.slice(0, 4).forEach(t => {
      timesEl.insertAdjacentHTML("beforeend", formatTimeBox(t));
    });
    card.appendChild(timesEl);

    cont.appendChild(card);
  });
}

async function refreshVelib() {
  // Fetch Vélib data and update corresponding info...
  // Note: Update the 2 stations Vincennes and École du Breuil here similarly.
}

// Etc. Complétez les autres fonctions de votre script sur ce modèle...

// Init et boucles d'actualisation
async function init() {
  updateDateTime();
  setInterval(updateDateTime, 60000);

  await Promise.all([
    renderRer(),
    renderBusForStop(STOP_IDS.HIPPODROME, "bus77-departures"),
    renderBusForStop(STOP_IDS.BREUIL, "bus201-departures"),
    renderBusForStop(STOP_IDS.JOINVILLE, "joinville-all-departures"),
    refreshVelib(),
    refreshWeather()
  ]);

  setInterval(renderRer, 30000);
  setInterval(() => renderBusForStop(STOP_IDS.HIPPODROME, "bus77-departures"), 30000);
  setInterval(() => renderBusForStop(STOP_IDS.BREUIL, "bus201-departures"), 30000);
  setInterval(() => renderBusForStop(STOP_IDS.JOINVILLE, "joinville-all-departures"), 30000);
  setInterval(refreshVelib, 120000);
  setInterval(refreshWeather, 900000);
}

// Fonction date/heure header
function updateDateTime() {
  const dateEl = document.getElementById("date");
  const timeEl = document.getElementById("time");
  const now = new Date();
  if (dateEl) dateEl.textContent = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}`;
  if (timeEl) timeEl.textContent = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Appel init au chargement la page
document.addEventListener("DOMContentLoaded", init);
