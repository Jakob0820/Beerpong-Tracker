# 🍺 Bierpong Tracker

Punkte-Tracker für ein Bierpong-Turnier mit 2er-Teams: jeder gegen jeden, optional mit Gruppen und K.O.-Runde. Läuft lokal im WLAN:
Ein Laptop ist der Server und zeigt die Statistik auf dem Fernseher, die Treffer werden per Handy eingetragen.

## Starten

```bash
npm install
npm start          # baut das Frontend und startet den Server auf Port 3000
```

Beim Start gibt der Server die Adressen aus:

- `/tv`: Ansicht für den Fernseher (Leaderboard, Gruppen, K.O.-Baum, Top-Spieler, wechselt alle 15 s)
- `/admin`: Teams anlegen, Gruppen auslosen, Turnier steuern, QR-Codes drucken (PIN: `1234`)
- `/t/1`, `/t/2`, …: Eingabe für den jeweiligen Tisch, Ziel der QR-Codes

Optionen per Umgebungsvariable: `PORT`, `ADMIN_PIN`, `PUBLIC_URL` (Adresse in den QR-Codes), `DB_PATH`.

## Ablauf

1. In `/admin` Teams anlegen, Tische und Regeln einstellen
2. Turnier starten (bei mehr als 1 Gruppe vorher auslosen). Sobald alle Tische fertig sind, starten automatisch die nächsten Spiele (so viele, wie es Tische gibt) an zufällig gewählten Tischen.
3. QR-Codes drucken und an die Tische legen
4. Nach dem letzten Spiel in `/admin` das Turnier beenden (Tabellenerster gewinnt) oder eine K.O.-Runde starten

## Treffer

- **Treffer**: 1 Becher
- **Bounce**: 2 Becher (einstellbar)
- **Bombe**: Beide Spieler treffen denselben Becher. Man wählt, wie viele Becher insgesamt weggehen und wer als Zweites getroffen hat. Die Becher werden hälftig gutgeschrieben, bei ungerader Zahl bekommt der zweite Treffende einen mehr.
- **Letzter Becher und Redemption**: Trifft ein Team seinen letzten Becher, fragt die Tisch-Ansicht, ob der Gegner eine Redemption bekommt. Wenn ja, wirft der Gegner weiter, bis ein Wurf danebengeht (dann gewinnt das Team, das zuerst fertig war). Trifft er dabei ebenfalls alle Becher, folgt ein **Sudden Death**: Jedes Team hat noch einen Becher, der nächste Treffer gewinnt (Endstand z. B. 11:10).

## Daten

Alles liegt in `data/tournament.db` (SQLite). Die Datei als Backup kopieren, solange der Server nicht schreibt.

## Entwicklung

```bash
npm run dev        # Server (3000) + Vite mit Hot Reload (5173)
npm run check      # Typprüfung
```
