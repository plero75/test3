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

// StopAreas / Stops IDFM
const STOP_IDS = {
  RER_A: "STIF:StopArea:SP:43135:",      // Joinville RER
  BUS_77: "STIF:StopArea:SP:463641:",    // Hippodrome (77)
  BUS_201: "STIF:StopArea:SP:463644:",   // École du Breuil (201 ou autre selon PRIM)
  JOINVILLE_AREA: "STIF:StopArea:SP:70640:" // Joinville (toutes lignes)
};

async function fetchText(url){ const r = await fetch(url); if(!r.ok) throw new Error('Fetch '+url); return await r.text(); }
async function fetchJSON(url){ const r = await fetch(url); if(!r.ok) throw new Error('Fetch '+url); return await r.json(); }

app.get('/api/nextDepartures', async (req, res) => {
  try {
    const [rer, bus77, bus201, joinvilleArea] = await Promise.all([
      fetchJSON(`${PROXY}https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.RER_A}`),
      fetchJSON(`${PROXY}https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.BUS_77}`),
      fetchJSON(`${PROXY}https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.BUS_201}`),
      fetchJSON(`${PROXY}https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=${STOP_IDS.JOINVILLE_AREA}`)
    ]);

    const rerData   = regroupRER(rer);
    const bus77Data = parseStop(bus77);
    const bus201Data= parseStop(bus201);
    const joinvData = parseStop(joinvilleArea);

    res.json({
      RER_A: rerData,
      BUS: {
        joinville: joinvData,                                            
        hippodrome: bus77Data.concat(bus201Data).filter(x => ['77','201'].includes(x.line)),
        breuil: bus77Data.filter(x => x.line === '77')
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/infos', async (req, res) => {
  try {
    const [meteo, velib, rssXML, baro] = await Promise.all([
      fetchJSON(WEATHER_URL),
      fetchJSON(VELIB_URL),
      new Parser().parseURL(RSS_URL),
      fetchText(SYTADIN_URL)
    ]);

    const trafic = parseSytadinBaro(baro);

    // Actualités avec titre + description/summary
    const actus = (rssXML?.items||[]).slice(0, 10).map(item => ({
      title: item.title || '',
      description: item.contentSnippet || item.summary || item.content || '',
      link: item.link || ''
    }));

    res.json({
      meteo: { 
        temp: meteo?.current_weather?.temperature, 
        desc: "Conditions actuelles", 
        extra: `Vent ${meteo?.current_weather?.windspeed || 0} km/h` 
      },
      velib: parseVelib(velib),
      trafic,
      actus,
      alerte: null
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

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

function parseVelib(data){
  const out = {};
  (data?.data?.stations||[]).forEach(st => {
    if(st.station_id==='12163' || st.station_id==='12128'){
      out[st.station_id] = { name: st.stationCode, bikes: st.num_bikes_available, docks: st.num_docks_available };
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
    return { km: null, note: '' };
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Serveur unifié en écoute sur http://localhost:'+PORT));
