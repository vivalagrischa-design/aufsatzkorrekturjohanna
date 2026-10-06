## Lokaler Mac Ablauf ab Version 1.4

Die aktuelle Oberfläche liest Dokumente zuerst lokal und beurteilt anschliessend
nur den geprüften Text. Der Aufsatz wird nicht nochmals vollständig ausgegeben.
Fotos liest Apple Vision ohne automatische Sprachkorrektur; Handschrift und
Satzzeichen müssen vor der Beurteilung mit den Originalen verglichen werden.

Nach der bisherigen Installation (Node, Ollama, Poppler, npm ci):

```bash
mkdir -p bin
xcrun swiftc -O mac-ocr.swift -o bin/mac-ocr -framework Vision -framework ImageIO
ollama pull qwen3:4b-instruct
bash Start.command
```

Optional in `.env`: `OLLAMA_TEXT_MODEL=qwen3:4b-instruct`. Dieses Textmodell ist
vom früheren `OLLAMA_MODEL` für die Bildkorrektur getrennt. `Start.command` hält
den Mac während der geöffneten App vor automatischem Leerlauf-Ruhezustand wach.

Word-Raster mit einer Kriterium- und Punktespalte werden automatisch eingelesen.
Rasterformat nach Prüfung: `Maximalpunkte | Kriterium` je Zeile; ohne Punkte
`- | Kriterium`. Summenzeilen weglassen. Das Raster bleibt für den nächsten
Aufsatz im Browser erhalten. Keine dauerhafte Speicherung der Schülertexte.

Jedes Kriterium wird beurteilt. Visuelle Kriterien bleiben ohne Beobachtungen
der Lehrperson offen. Es gibt ausgewählte sprachliche Korrekturen, keine
vollständige Fehlerliste, kein Neuschreiben und keine automatische Note in diesem
Modus. KI-Ausgaben mit fremden Kriterien, unzulässigen Punkten oder nicht im
Original vorhandenen Zitaten werden verworfen. Inhaltliche Richtigkeit bleibt
prüfpflichtig. Das kleinere Modell kann schwächer beurteilen als ChatGPT.

Die reale OCR-Qualität, Korrekturqualität und Geschwindigkeit auf einem Mac M1
sind noch nicht validiert. Tests nutzen simulierte Modellantworten. Vor dem
Einsatz für eine Klasse mehrere bekannte Aufsätze vergleichen. Diese Bildlesung
benötigt macOS; auf anderen Servern Text manuell einfügen oder OCR ergänzen.

---

# Aufsatzatelier – Deutschkorrektur für Schulen

Zwei Uploadfelder: Bewertungskriterien und Schüleraufsatz. Die App erstellt anhand der hochgeladenen Bewertungskriterien einen Korrekturvorschlag mit Textbelegen, begründeten Sprachkorrekturen, Stärken, Lernschritten und vollständig sprachlich korrigiertem Aufsatz. Unterstützte Uploads sind PDF, Word, Excel, TXT und Bilder. Neben den beiden Word-Berichten kann bei einer hochgeladenen XLSX-Datei eine Beurteilungs-Tabelle als zusätzliches Tabellenblatt in derselben Excel-Arbeitsmappe heruntergeladen werden; vorhandene Tabellenblätter bleiben erhalten.

**Standard: echte lokale KI ohne API-Schlüssel.** Lehrpersonen brauchen nur die Webadresse und gegebenenfalls das Schulpasswort. Der Betreiber stellt einmalig die App mit einem eigenen Ollama-KI-Server bereit. Es gibt keine vorgetäuschten Korrekturen.

## Was GitHub kann – und was zusätzlich nötig ist

GitHub speichert den vollständigen Code. GitHub Pages zeigt die Oberfläche, betreibt aber keinen KI-Server. Für echte Korrekturen muss ein Schulrechner oder Server mit dem KI-Modell laufen. Ohne externen API-Dienst entfallen API-Schlüssel; Rechnerleistung und Betrieb bleiben nötig.

Dies ist eine installierbare erste Version für eine Schule mit gemeinsamem Zugangspasswort. Sie enthält keine persönlichen Benutzerkonten, Mandantenverwaltung, Abrechnung oder Warteschlange für einen grossen parallelen Schulbetrieb. Vor dem Einsatz muss die Korrekturqualität mit eigenen Beispielaufsätzen geprüft werden. Kleine lokale Modelle können bei Deutschkorrektur und Handschrift Fehler machen.

## Schnellstart auf einem Mac oder Linux-Rechner

Voraussetzungen: Node.js 22 oder neuer, Ollama und Poppler. Poppler wird zum Lesen und Rendern von PDFs verwendet.

Auf einem Mac mit Homebrew:

```sh
brew install node ollama poppler
ollama serve
```

Falls Ollama bereits als App läuft, `ollama serve` nicht nochmals starten. In einem weiteren Terminal:

```sh
ollama pull qwen3-vl:8b
```

Der Modelldownload ist mehrere GB gross. Wähle ein Text-und-Bild-Modell mit Unterstützung für strukturierte Ausgaben. Die Vorlage verwendet `qwen3-vl:8b`; die tatsächliche Geschwindigkeit hängt von RAM, GPU und Aufsatzlänge ab. CPU-Betrieb ist möglich, kann aber langsam sein. Für mehrere gleichzeitige Nutzer sollte die Schul-IT einen geeigneten GPU-Server und Lasttests vorsehen.

Im entpackten Projektordner:

```sh
npm ci
cp .env.example .env
```

In `.env`:

```dotenv
AI_PROVIDER=ollama
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3-vl:8b
APP_PASSWORD=ein_langes_schulpasswort
PORT=3000
ALLOWED_ORIGIN=
```

Starten:

```sh
npm start
```

`http://localhost:3000` öffnen. Unter **Schulzugang** das Schulpasswort eingeben; die App prüft es direkt am Server, bevor sie es als gültig meldet. Dann Bewertungskriterien und Aufsatz hochladen und die Korrektur erstellen. Kein API-Schlüssel erforderlich.

Für Zugriff im Schulnetz die Adresse dieses Rechners verwenden, zum Beispiel `http://192.168.1.20:3000`. Für dauerhaften oder externen Betrieb einen HTTPS-Zugang über die Schul-IT einrichten. Der Node-Server startet auf allen Netzwerkinterfaces; Firewall und Zugang sollen vom Betreiber passend eingerichtet werden.

## Alternative: Docker auf einem Schulserver

Docker und Docker Compose installieren. `.env` mit mindestens `APP_PASSWORD` anlegen:

```dotenv
APP_PASSWORD=ein_langes_schulpasswort
```

Dann im Projektordner:

```sh
docker compose up -d --build
docker compose exec ollama ollama pull qwen3-vl:8b
```

Danach ist die App auf Port 3000 erreichbar. Poppler ist bereits im App-Container enthalten. Das Modell bleibt im Docker-Volume gespeichert. Für einen NVIDIA-GPU-Server die kommentierte `gpus: all`-Zeile in `compose.yaml` aktivieren und das NVIDIA Container Toolkit einrichten. Ohne diese Anpassung verwendet das Compose-Beispiel die CPU.

Ollama erhält absichtlich keinen nach aussen freigegebenen Port. Die App spricht intern mit Ollama. Für einen öffentlichen Einsatz HTTPS vorgeschaltet bereitstellen. Das Schulpasswort ist im produktiven Modus Pflicht.

## Code und Oberfläche auf GitHub

1. Ein neues Repository erstellen, zum Beispiel `aufsatzkorrektur`.
2. Den Inhalt des entpackten Projektordners hochladen, mit `public`, `.github`, `package.json`, `package-lock.json`, `server.js` und allen übrigen Quelldateien direkt im Repository.
3. `.env` und `node_modules` niemals hochladen. Die leere `.env.example` ist zur Veröffentlichung gedacht.
4. **Settings → Pages → Source → GitHub Actions** wählen.
5. Der enthaltene Workflow veröffentlicht den Ordner `public` bei Push auf `main`. Bei einem anderen Hauptbranch die Workflowdatei anpassen. Falls nötig unter **Actions** den Workflow manuell starten.
6. Die Oberfläche ist unter `https://DEIN-NAME.github.io/aufsatzkorrektur/` sichtbar.

Auch der versteckte Ordner `.github` muss hochgeladen werden. Das ZIP enthält ihn. Alternativ alles mit Git hochladen.

Für echte Korrekturen von GitHub Pages aus trägt **der Betreiber** in `public/config.js` die HTTPS-Adresse des eigenen KI-Servers ein:

```js
window.AUFSATZ_CONFIG = { serverUrl: 'https://korrektur.deine-schule.ch' };
```

Auf dem Server zusätzlich:

```dotenv
ALLOWED_ORIGIN=https://DEIN-NAME.github.io
```

Ohne Repository-Pfad und abschliessenden Slash. Lehrpersonen tragen diese technischen Daten nicht ein. Bei gemeinsamer Bereitstellung von App und Server bleibt `serverUrl` leer.

## Unterstützte Dateien und Ergebnis

- Je ein PDF, DOCX, XLSX, TXT, JPG, PNG oder WebP bis 8 MB pro Uploadfeld.
- Mehrere Seiten als ein PDF; lokale PDF-Verarbeitung maximal 12 Seiten pro Datei.
- PDF-Seiten werden als Text und Bild gelesen, damit auch Scans, Handschrift und Rastertabellen verfügbar sind.
- Word wird als Text gelesen. Excel-Arbeitsmappen werden tabellenblattweise ausgelesen. Eingebettete Scans und Bilder in Word zuerst als PDF exportieren.
- Zusatzangaben wie Aufgabenstellung und Klassenstufe optional. Schweizer Rechtschreibung ist voreingestellt.
- Punkte nur nach expliziter Skala; Note nur nach eindeutigem Notenschlüssel im Raster. Unklare oder unlesbare Angaben werden ausgewiesen.
- Word-Download enthält Gesamtbeurteilung, Kriterien, Korrekturen, Stärken, Lernschritte, Unsicherheiten sowie korrigierten Text und Originaltranskription.
- Die definitive Bewertung liegt bei der Lehrperson. Die App erzeugt Vorschläge und kann fehlerhaft lesen oder bewerten.

## Datenschutz und Betrieb

In der Standardkonfiguration werden die Dokumente ausschliesslich an den vom Betreiber eingerichteten Ollama-Server gesendet. Kein OpenAI-Konto und kein externer API-Schlüssel nötig. Ollama soll lokal oder auf einem kontrollierten Schulserver betrieben werden, nicht über einen Cloud-Modellnamen.

PDFs werden zur Verarbeitung kurz in einem privaten temporären Ordner abgelegt und anschliessend gelöscht. Es gibt keine Aufsatzdatenbank oder dauerhafte Uploadablage. DOCX, XLSX und TXT werden im Arbeitsspeicher verarbeitet. App und KI-Server befinden sich im Verantwortungsbereich des Betreibers; Backups, Betriebssystem und vorgeschaltete Dienste können eigene Aufbewahrungsregeln haben.

Das Schulpasswort bleibt nur im Speicher der geöffneten Browserseite. Es wird nicht lokal gespeichert. Nach Neuladen erneut eingeben. Der technische Server-Link wird in der Betreiberkonfiguration festgelegt. Die Oberfläche lädt keine externen Schriftarten oder Analyseprogramme.

Für echte Schülerdaten die Freigabe der Schule einholen und Namen möglichst entfernen. Das gemeinsame Passwort ist ein einfacher Zugangsschutz für eine erste schulinterne Version. Für einen Dienst über viele Schulen sind individuelle Konten, Rollen, Schultrennung, Auditing und Kapazitätsverwaltung gesondert zu ergänzen. Die einfache Begrenzung von 30 Korrekturanfragen pro Stunde und Verbindungsadresse kann hinter einem Proxy mehrere Nutzer zusammenfassen.

## Optionaler anderer KI-Modus

Der Server enthält zusätzlich eine OpenAI-Integration als Betreiberoption. Die Standardkonfiguration verwendet sie nicht. Bei bewusster Wahl `AI_PROVIDER=openai`, `OPENAI_API_KEY` und `OPENAI_MODEL` auf dem Server setzen. Auch dann braucht keine Lehrperson einen eigenen Schlüssel. Die Daten werden in diesem Modus an OpenAI übermittelt; die Schule muss das zuvor freigeben. API-Nutzung wird separat abgerechnet, ein ChatGPT-Abo ersetzt sie nicht. `store: false` bedeutet keine pauschale Zusage über alle Aufbewahrungsprozesse des Anbieters.

## Tests und Dateien

```sh
npm test
```

Die Tests prüfen beide KI-Anbindungen mit simulierten Dienstantworten, Uploadvalidierung, Passwortschutz, Fehlerbehandlung, Punktegrenzen und den echten DOCX-Export. Ein lokal installiertes Modell und dessen Korrekturqualität müssen nach Einrichtung separat geprüft werden. In der Entwicklungsumgebung wurde kein grosses KI-Modell heruntergeladen.

| Datei / Ordner | Aufgabe |
| --- | --- |
| `public/` | Oberfläche und Betreiberkonfiguration, direkt für GitHub Pages geeignet |
| `server.js` | Webserver, Zugangsschutz und Weiterleitung an die KI |
| `local-ai.js` | Lokale Datei-/PDF-Verarbeitung und Ollama-Anbindung |
| `correction.js` | Korrekturanweisung, Ergebnisformat und Word-Export |
| `.env.example` | Konfigurationsvorlage ohne Schlüssel |
| `Dockerfile`, `compose.yaml` | Eigener Server mit lokaler KI |
| `.github/workflows/pages.yml` | GitHub-Pages-Veröffentlichung |
| `test/` | Tests ohne KI-Gebühren |

Offizielle technische Grundlagen:
- https://docs.ollama.com/api/chat
- https://docs.ollama.com/capabilities/structured-outputs
- https://ollama.com/library/qwen3-vl
- https://developers.openai.com/api/docs/guides/file-inputs (optionaler Modus)
