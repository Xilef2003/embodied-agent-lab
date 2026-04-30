# Embodied Agent Lab v0.1

Ein erster Prototyp für einen einfachen körperlichen Agenten:

- 2D-Welt mit Müll, Hindernissen, Menschen/Tieren und Ladestation
- Roboter mit Akku, Müllbehälter, Greifaktion und begrenzter Sicht
- Brain mit Weltmodell, Bedürfnissen, Emotionen, Zielen, Planung und Lernen
- Browser-Canvas zur Visualisierung

## Start in VS Code

```bash
npm start
```

Dann im Browser öffnen:

```txt
http://localhost:5173
```



## Neu in v0.3

v0.2 hatte bereits BFS-Pfadsuche, aber der Agent konnte zu früh von der Ladestation losfahren:

```txt
laden → ein Schritt Richtung Müll → zurück zur Station → laden → ...
```

v0.3 behebt das durch:

- Goal-Commitment für `CHARGE`
- Goal-Commitment für `EMPTY_LOAD`
- Mindest-Akku vor neuer Mission
- Energiebudget für Müllmissionen: Hinweg + Rückweg + Reserve
- Entladen, wenn der Roboter mit Müll an der Basis steht

## Neu in v0.2

v0.1 konnte in manchen Situationen zwischen zwei Feldern pendeln, wenn der Roboter zur Ladestation wollte.  
v0.2 behebt das durch:

- BFS-Pfadsuche statt rein gieriger Bewegung
- Anti-Ping-Pong-Logik gegen direktes Zurücklaufen
- lokale Suchschritte, wenn noch kein vollständiger Pfad bekannt ist
- bessere Begründungen im Aktionslog mit Pfadlänge

## Was der Agent schon kann

Der Agent entscheidet pro Tick selbst:

- Müll sammeln
- bei vollem Behälter zur Basis zurückkehren
- bei niedrigem Akku zur Ladestation fahren
- Hindernisse meiden oder aus Fehlern blockierte Zellen lernen
- unbekannte Weltbereiche erkunden
- einfache innere Zustände berechnen:
  - Energiebedarf
  - Vorsicht
  - Neugier
  - Frustration
  - Zufriedenheit

## Wichtig

Das ist noch kein AGI. Es ist der erste Schritt zu einer kognitiven Architektur:

```txt
Wahrnehmung → Weltmodell → Bedürfnisse → Emotionen → Ziele → Planung → Handlung → Lernen
```

Die nächste Version sollte RelationGraph, AffordanceGraph und ActionSchemas bekommen.
