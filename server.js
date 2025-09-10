import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import Parser from 'rss-parser';

const app = express();
app.use(cors());
app.use(express.static('public'));

// ========= CONFIG =========
const PROXY = "https://ratp-proxy.hippodrome-proxy42.workers.dev/?url=";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=48.835&longitude=2.45&current_weather=true";
const VELIB_URL = "https://velib-metropole-opendata.smoove.pro/opendata/Velib_Metropole/station_status.json";
const RSS_URL = "https://www.francetvinfo.fr/titres.rss";
const SYTADIN_URL = "https://www.sytadin.fr/sys/barometre_cumul.jsp.html";

// StopAreas / Stops IDFM - CORRIGÉS avec les bons IDs
const STOP_IDS = {
  RER_A: "STIF:StopArea:SP:43135:",          // Joinville RER A
  JOINVILLE_AREA: "STIF:StopArea:SP:70640:", // Joinville-le-Pont (toutes lignes bus)
  HIPPODROME: "STIF:StopArea:SP:463641:",    // Hippodrome de Vincennes (bus 77/201)
  BREUIL: "STIF:StopArea:SP:463644:"         // École du Breuil (bus 77)
};

async function fetchText(url){ const r = await fetch(url); if(!r.ok) throw new Error('Fetch '+url); return await r.text(); }
async function fetchJSON(url){ const r = await fetch(url); if(!r.ok) throw new Error('Fetch '+url); return await r.json(); }

app.get('/api/nextDepartures', async (req, res) => {
  try {
    console.log('🚀 Récupération des données transport...');

    const [rer, joinvilleAll, hippodrome, breuil] = await Promise.all([
      fetchJSON(`${PROXY}https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.RER_A}`),
      fetchJSON(`${PROXY}https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.JOINVILLE_AREA}`),
      fetchJSON(`${PROXY}https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.HIPPODROME}`),
      fetchJSON(`${PROXY}https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.BREUIL}`)
    ]);

    console.log('✅ Données récupérées, traitement...');

    const rerData = regroupRER(rer);
    const joinvilleData = parseStop(joinvilleAll);
    const hippodromeData = parseStop(hippodrome);
    const breuilData = parseStop(breuil);

    console.log(`📊 RER: ${rerData.directionParis.length + rerData.directionBoissy.length} trains`);
    console.log(`🚌 Joinville: ${joinvilleData.length} bus, Hippodrome: ${hippodromeData.length} bus, Breuil: ${breuilData.length} bus`);

    res.json({
      RER_A: rerData,
      BUS: {
        joinville: joinvilleData,      // Tous les bus de Joinville-le-Pont
        hippodrome: hippodromeData,    // Bus 77/201 à l'Hippodrome
        breuil: breuilData             // Bus 77 à l'École du Breuil
      }
    });
  } catch (e) {
    console.error('❌ Erreur nextDepartures:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/infos', async (req, res) => {
  try {
    console.log('🌐 Récupération infos (météo, vélib, trafic, news)...');

    const [meteo, velib, rssXML, baro] = await Promise.all([
      fetchJSON(WEATHER_URL),
      fetchJSON(VELIB_URL),
      new Parser().parseURL(RSS_URL),
      fetchText(SYTADIN_URL)
    ]);

    const trafic = parseSytadinBaro(baro);

    const actus = (rssXML?.items||[]).slice(0, 10).map(item => ({
      title: item.title || '',
      description: item.contentSnippet || item.summary || item.content || '',
      link: item.link || ''
    }));

    console.log('✅ Infos récupérées');

    res.json({
      meteo: { 
        temp: meteo?.current_weather?.temperature, 
        desc: "Conditions actuelles", 
        extra: `Vent ${meteo?.current_weather?.windspeed || 0} km/h` 
      },
      velib: parseVelibAmélioré(velib),
      trafic,
      actus,
      alerte: null
    });
  } catch (e) {
    console.error('❌ Erreur infos:', e);
    res.status(500).json({ error: e.message });
  }
});

// ========= ENDPOINT COURSES VINCENNES =========
app.get('/api/vincennes', async (req, res) => {
  try {
    console.log('🏇 Récupération courses Vincennes...');
    const prochaines = await getVincennesCourses();
    console.log(`🎯 ${prochaines.length} courses trouvées`);

    res.json({
      prochaines,
      hippodrome: "Paris-Vincennes",
      derniereMiseAJour: new Date().toISOString()
    });
  } catch (e) {
    console.error('❌ Erreur courses Vincennes:', e);
    res.status(500).json({ error: e.message, prochaines: [] });
  }
});

async function getVincennesCourses() {
  const today = new Date();
  const courses = [];

  // Chercher sur 7 jours
  for (let i = 0; i < 7; i++) {
    const dateCheck = new Date(today);
    dateCheck.setDate(today.getDate() + i);
    const datePMU = formatDatePMU(dateCheck);

    try {
      const url = `https://offline.turfinfo.api.pmu.fr/rest/client/7/programme/${datePMU}`;
      const data = await fetchJSON(url);

      const reunions = data?.programme?.reunions || [];

      for (const reunion of reunions) {
        const hippodrome = reunion.hippodrome || {};
        const codeHippo = hippodrome.code || '';
        const libelleLong = hippodrome.libelleLong || '';

        // Vérifier si c'est Vincennes
        if (codeHippo === 'VIN' || 
            libelleLong.toLowerCase().includes('vincennes') || 
            libelleLong.toLowerCase().includes('paris-vincennes')) {

          const coursesReunion = reunion.courses || [];
          const maintenant = new Date();

          for (const course of coursesReunion) {
            const heureDepart = course.heureDepart;
            let heureCourse = null;
            let heureStr = '--:--';

            // Convertir le timestamp
            if (heureDepart) {
              try {
                heureCourse = new Date(heureDepart);
                heureStr = heureCourse.toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit'
                });
              } catch (e) {
                console.warn('Erreur parsing heure:', heureDepart);
              }
            }

            // Ajouter seulement les courses futures
            if (!heureCourse || heureCourse > maintenant) {
              courses.push({
                date: dateCheck.toISOString().split('T')[0],
                dateLabel: dateCheck.toLocaleDateString('fr-FR', { 
                  weekday: 'long', 
                  day: 'numeric', 
                  month: 'long' 
                }),
                reunion: reunion.numOfficiel || 1,
                course: course.numOrdre || course.numOfficiel || '?',
                heure: heureStr,
                nom: course.libelle || 'Course sans nom',
                distance: course.distance || 'N/A',
                discipline: formatDiscipline(course.discipline),
                dotation: course.montantPrix || 'N/A',
                statut: course.statut || 'PROGRAMMEE',
                heureTimestamp: heureCourse ? heureCourse.getTime() : 0
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn(`Erreur pour la date ${datePMU}:`, e.message);
      continue;
    }
  }

  // Trier par heure et retourner les 8 prochaines
  return courses
    .sort((a, b) => a.heureTimestamp - b.heureTimestamp)
    .slice(0, 8);
}

function formatDatePMU(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}${month}${year}`;
}

function formatDiscipline(discipline) {
  const mapping = {
    'ATTELE': 'Attelé',
    'MONTE': 'Monté',
    'PLAT': 'Plat',
    'OBSTACLES': 'Obstacles'
  };
  return mapping[discipline] || discipline || 'Trot';
}

function minutesFromISO(iso){
  if(!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.round(ms/60000));
}

function parseStop(data){
  const visits = data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit || [];
  return visits.map(v => {
    const mv = v.MonitoredVehicleJourney || {};
    const call = mv.MonitoredCall || {};
    const dest = (mv.DestinationName?.[0]?.value) || '';
    const stop = (call.StopPointName?.[0]?.value) || '';
    const lineRef = (mv.LineRef?.value || '').replace('STIF:Line:','');
    const mins = minutesFromISO(call.ExpectedDepartureTime);
    return { line: lineRef, dest, stop, minutes: (mins!=null?[mins]:[]) };
  });
}

function regroupRER(data){
  const rows = parseStop(data);
  const paris = rows.filter(r => /paris|la défense/i.test(r.dest));
  const boissy = rows.filter(r => /boissy|marne/i.test(r.dest));
  return {
    directionParis: groupByDest(paris),
    directionBoissy: groupByDest(boissy),
    noteParis: '',
    noteBoissy: ''
  };
}

function groupByDest(arr){
  const map = {};
  arr.forEach(x => {
    const key = x.dest || '—';
    map[key] = map[key] || { destination:key, minutes:[] };
    if(x.minutes?.length) map[key].minutes.push(x.minutes[0]);
  });
  const out = Object.values(map).map(r => ({...r, minutes: r.minutes.sort((a,b)=>a-b).slice(0,4)}));
  out.sort((a,b)=>(a.minutes[0]??999)-(b.minutes[0]??999));
  return out;
}

function parseVelibAmélioré(data){
  const out = {};
  const stationMap = {
    '12163': { name: 'Hippodrome de Vincennes', zone: 'Hippodrome' },
    '12128': { name: 'École Vétérinaire Maisons-Alfort', zone: 'École Vétérinaire' }
  };

  (data?.data?.stations||[]).forEach(st => {
    if(stationMap[st.station_id]){
      out[st.station_id] = { 
        name: stationMap[st.station_id].name,
        zone: stationMap[st.station_id].zone,
        bikes: st.num_bikes_available || 0, 
        docks: st.num_docks_available || 0,
        total: st.capacity || (st.num_bikes_available + st.num_docks_available),
        status: st.is_renting === 1 && st.is_returning === 1 ? 'ACTIVE' : 'INACTIVE'
      };
    }
  });
  return out;
}

function parseSytadinBaro(html){
  try{
    const kmMatch = html.replace('\n',' ').match(/cumul de bouchon est de\s*(\d+)\s*km/i);
    const etatMatch = html.match(/État du trafic\s*:\s*([^<]+)/i) || html.match(/Etat du trafic\s*:\s*([^<]+)/i);
    const tendMatch = html.match(/Tendance\s*:\s*([^<]+)/i);
    return {
      km: kmMatch? Number(kmMatch[1]) : null,
      note: `État: ${(etatMatch? etatMatch[1].trim(): '—')} · Tendance: ${(tendMatch? tendMatch[1].trim(): '—')}`
    };
  }catch(e){
    return { km: null, note: 'Données indisponibles' };
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n🎪 ========================================');
  console.log(`🚀 Dashboard Hippodrome LIVE sur http://localhost:${PORT}`);
  console.log('🎪 ========================================');
  console.log('📍 Arrêts surveillés:');
  console.log('   🚆 RER A Joinville-le-Pont');
  console.log('   🚌 Joinville-le-Pont (toutes lignes)');
  console.log('   🚌 Hippodrome de Vincennes (77/201)');
  console.log('   🚌 École du Breuil (77)');
  console.log('   🏇 Courses Vincennes (API PMU)');
  console.log('   🚲 Stations Vélib');
  console.log('   🌤️ Météo + 🚗 Trafic + 📰 Actualités');
  console.log('🎪 ========================================\n');
});
