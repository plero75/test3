# Dashboard Hippodrome LIVE - Version Séparée

## 🚀 Mode LIVE avec APIs temps réel

### Layout 3 Colonnes

```
┌─────────────────────┬─────────┐
│       RER A         │ Météo/  │
│    (2 colonnes)     │ Trafic  │
├───────┬───────┬─────┴─────────┤
│ Bus   │ Bus   │ Bus           │
│Joinv. │Hippo. │ Breuil        │
├───────┼───────┴───────────────┤
│ Vélib │    Courses            │
│       │    Vincennes          │
├───────┴───────────────────────┤
│      Actualités (20s)         │
└───────────────────────────────┘
```

## 🚌 Blocs Bus Séparés

### **1. Joinville-le-Pont** (vert foncé)
- **StopArea**: `STIF:StopArea:SP:70640:`
- **Toutes les lignes** de bus passant par Joinville
- Couleur: `#2E8B57` (vert foncé)

### **2. Hippodrome de Vincennes** (bleu)  
- **StopArea**: `STIF:StopArea:SP:463641:`
- **Lignes 77 et 201** uniquement
- Couleur: `#4682B4` (bleu)

### **3. École du Breuil** (doré)
- **StopArea**: `STIF:StopArea:SP:463644:`
- **Ligne 77** uniquement  
- Couleur: `#DAA520` (doré)

## 🚲 Vélib Amélioré

### Stations surveillées avec noms complets :
- **12163**: Hippodrome de Vincennes
- **12128**: École Vétérinaire Maisons-Alfort

### Affichage amélioré :
```
🚲 Hippodrome de Vincennes     #12163
🚲 8 vélos  📍 4 places

🚲 École Vétérinaire...        #12128  
🚲 12 vélos  📍 8 places
```

## 🏇 Courses Vincennes

- **6 prochaines courses** sur 2 colonnes
- **API PMU temps réel** (recherche 7 jours)
- **Code hippodrome**: 'VIN'

## 🔧 APIs Utilisées

- **IDFM/PRIM** : Transport temps réel
- **PMU TurfInfo** : Courses hippiques  
- **Open-Meteo** : Météo Vincennes
- **Vélib Metropole** : Stations vélos
- **Sytadin** : Trafic routier IDF
- **France Info RSS** : Actualités

## Installation & Démarrage

```bash
npm install
npm start
# ➜ http://localhost:3000
```

## Déploiement Production

### Vercel (recommandé)
1. Push sur GitHub
2. Connecter repo à Vercel  
3. Deploy automatique

### Heroku
```bash
heroku create dashboard-hippodrome
git push heroku main
```

---

**Mode LIVE complet** avec données temps réel  
**Interface optimisée** pour affichage public
