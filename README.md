# Discord Moderation Bot

Ein leistungsstarker Discord-Bot für Servermoderation und -verwaltung, entwickelt mit discord.js.

## Hauptfunktionen:

- Automatische Moderation: Erkennung und Filterung von unangemessenen Wörtern
- Spam-Schutz: Automatische Erkennung und Bestrafung von Spam-Verhalten
- Raid-Schutz: Erhöhung des Verifizierungslevels bei verdächtigen Beitritten
- Moderationsbefehle: Warnen, Kicken und Bannen von Benutzern
- Konfigurierbare Einstellungen: Anpassbare Schwellenwerte und Aktionen
- Moderationsprotokollierung: Detaillierte Logs aller Moderationsaktionen
- Befehlskühlung: Verhindert Spam durch Begrenzung der Befehlsausführung

Dieser Bot bietet umfassende Werkzeuge zur Aufrechterhaltung einer sicheren und angenehmen Community-Umgebung auf Ihrem Discord-Server.

## Installation

1. Klonen Sie dieses Repository
2. Führen Sie `npm install` aus, um die erforderlichen Abhängigkeiten zu installieren
3. Erstellen Sie eine `.env`-Datei und fügen Sie Ihren Bot-Token hinzu: `BOT_TOKEN=IhrBotTokenHier`
4. Passen Sie die `config.json`-Datei an Ihre Bedürfnisse an
5. Starten Sie den Bot mit `node bot.js`

## Verwendung

- Verwenden Sie den Befehlsprefix (Standard: `.`) gefolgt von einem Befehl
- Beispiele:
  - `.warn @Benutzer` - Verwarnt einen Benutzer
  - `.kick @Benutzer` - Kickt einen Benutzer
  - `.ban @Benutzer` - Bannt einen Benutzer

## Konfiguration

Die meisten Einstellungen können in der `config.json`-Datei angepasst werden. Verwenden Sie den `.updateconfig`-Befehl, um Einstellungen zur Laufzeit zu ändern.

## Beitragen

Beiträge sind willkommen! Bitte erstellen Sie ein Issue oder einen Pull Request für Verbesserungen oder neue Funktionen.

## Lizenz

[MIT](https://choosealicense.com/licenses/mit/)
