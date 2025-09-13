 

```javascript
// ✅ Fonctions spécialisées avec intervalles adaptés

// 📰 Fonction Actualités (15 minutes)
async function news() {
  console.log("📰 Chargement Actualités...");
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

// 🌤️ Fonction Météo (30 minutes)  
async function meteo() {
  console.log("🌤️ Chargement Météo...");
  const weather = await fetchJSON(WEATHER_URL);
  
  if (weather?.current_weather) {
    $("#meteo-temp").textContent = Math.round(weather.current_weather.temperature);
    $("#meteo-desc").textContent = "Conditions actuelles";
    $("#meteo-extra").textContent = "Vent " + weather.current_weather.windspeed + " km/h";
  } else {
    $("#meteo-temp").textContent = "--";
    $("#meteo-desc").textContent = "Météo indisponible";
    $("#meteo-extra").textContent = "Service temporairement interrompu";
  }
}

// 🚲 Fonction Vélib (10 minutes)
async function velib() {
  console.log("🚲 Chargement Vélib...");
  const velibData = await fetchJSON(PROXY + encodeURIComponent(VELIB_URL), 20000);
  const velibStations = parseVelibDetailed(velibData);
  
  if (velibStations && Object.keys(velibStations).length > 0) {
    renderVelib($("#velib-list"), velibStations);
  } else {
    renderError($("#velib-list"), "🚲 Service Vélib temporairement indisponible", "info");
  }
}

// 🚇 Fonction Transport (1 minute)
async function transport() {
  console.log("🚇 Chargement Transport...");
  
  const [rer, jv, hp, br] = await Promise.all([
    fetchJSON(PROXY + encodeURIComponent("https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=" + STOP_IDS.RER_A)),
    fetchJSON(PROXY + encodeURIComponent("https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=" + STOP_IDS.JOINVILLE_AREA)),
    fetchJSON(PROXY + encodeURIComponent("https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=" + STOP_IDS.HIPPODROME)),
    fetchJSON(PROXY + encodeURIComponent("https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=" + STOP_IDS.BREUIL))
  ]);
  
  // RER A avec gestion perturbations
  const rerData = regroupRER(rer);
  if (rerData && (rerData.directionParis?.length > 0 || rerData.directionBoissy?.length > 0)) {
    renderRER($("#rer-paris"), rerData.directionParis);
    renderRER($("#rer-boissy"), rerData.directionBoissy);
  } else {
    renderError($("#rer-paris"), "🚧 RER A perturbé : Travaux Joinville-Nogent (+1h30)", "warning");
    renderError($("#rer-boissy"), "🚧 RER A perturbé : Horaires modifiés cette semaine", "warning");
  }
  
  // Bus
  const jvData = parseStop(jv);
  if (jvData && jvData.length > 0) {
    renderBus($("#bus-joinville-list"), jvData, "joinville");
  } else {
    renderError($("#bus-joinville-list"), "🚌 Bus Joinville : Horaires modifiés (travaux RER A)", "warning");
  }
  
  const hpData = parseStop(hp);
  if (hpData && hpData.length > 0) {
    renderBus($("#bus-hippodrome-list"), hpData, "hippodrome");
  } else {
    renderError($("#bus-hippodrome-list"), "🏇 Bus Hippodrome : service interrompu", "warning");
  }
  
  const brData = parseStop(br);
  if (brData && brData.length > 0) {
    renderBus($("#bus-breuil-list"), brData, "breuil");
  } else {
    renderError($("#bus-breuil-list"), "🌳 Bus École du Breuil : données indisponibles", "warning");
  }
}

// 🏇 Fonction Courses (5 minutes)
async function courses() {
  console.log("🏇 Chargement Courses...");
  const vincennesCourses = await getVincennes();
  
  if (vincennesCourses && vincennesCourses.length > 0) {
    renderCourses($("#courses-list"), vincennesCourses);
  } else {
    renderError($("#courses-list"), "🏇 Aucune course programmée aujourd'hui", "info");
  }
}

// ✅ Fonctions de démarrage des intervalles
function startWeatherLoop() {
  meteo();
  setInterval(meteo, 30 * 60 * 1000); // 30 minutes
}

function startNewsLoop() {
  news();
  setInterval(news, 15 * 60 * 1000); // 15 minutes
}

function startVelibLoop() {
  velib();
  setInterval(velib, 10 * 60 * 1000); // 10 minutes
}

function startTransportLoop() {
  transport();
  setInterval(transport, 60 * 1000); // 1 minute
}

function startCoursesLoop() {
  courses();
  setInterval(courses, 5 * 60 * 1000); // 5 minutes
}

// ✅ Fonction refresh simplifiée (pour le bouton de rafraîchissement manuel)
async function refresh() {
  console.log("🔄 Refresh manuel complet");
  await Promise.all([
    transport(),
    meteo(),
    velib(),
    courses(),
    news()
  ]);
  setLastUpdate();
}

// ✅ Initialisation de tous les intervalles
function startAllLoops() {
  startTransportLoop();    // 1 min
  startCoursesLoop();      // 5 min  
  startVelibLoop();        // 10 min
  startNewsLoop();         // 15 min
  startWeatherLoop();      // 30 min
  
  // Interface loops (existants)
  setInterval(nextNews, 20000);
  setInterval(toggleInfoPanel, 15000);
  
  // Clock
  setInterval(setClock, 1000);
  setClock();
  
  setLastUpdate();
}

// ✅ Démarrage au chargement
startAllLoops(); 
}
