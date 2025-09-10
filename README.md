# Dashboard Leon.gp Unifié – Hippodrome Paris‑Vincennes

## Installation

```bash
npm install
npm run start
# Ouvre http://localhost:3000
```

## Description

Affichage **unifié** temps réel sur une seule page avec rotations internes :

### Layout

```
┌─────────────────┬─────────┐
│     RER A       │ Météo/  │
│   Joinville     │ Trafic  │
├─────────────────┤ (15s)   │
│   Bus Toutes    ├─────────┤
│    Lignes       │ Vélib'  │
├─────────────────┴─────────┤
│    Actualités (20s)       │
└───────────────────────────┘
```

### Rotations

- **Météo ↔ Trafic** : Alternance toutes les 15s  
- **Actualités** : 1 article complet (titre + texte) pendant 20s
- **Données** : Refresh toutes les 30s

### APIs & Configuration

Identiques à la version précédente :
- **PRIM/IDFM** avec proxy CORS
- **StopArea 70640** pour toutes les lignes Joinville
- **Météo + Vélib + Trafic + RSS France Info**

## Avantages

✅ **Tout visible en même temps** - pas de perte d'info  
✅ **Rotations ciblées** - météo/trafic et actualités détaillées  
✅ **Layout optimisé** - transport prioritaire, infos secondaires  
✅ **Lisibilité maximale** - style Leon.gp conservé
