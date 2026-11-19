# Pay Tracker

A personal flight log and pay calculator for airline pilots. It runs in the browser and keeps everything on your own device.

## Features
- **Flight log:** each sector's planned block from the roster, and a fixed block from a list you load as a PDF in Setup, with the paid figure tinted; deadhead sectors; diversions on actual block; domestic layover nights
- **Pay:** fixed pay you enter from your own pay letter, a tiered flying allowance, SOD, estimated TDS, employee PF and professional tax, with a new vs old tax regime comparison
- **International layovers:** per diem in USD by country
- **Year:** month-by-month block hours, gross, TDS and take-home for the financial year
- **Duty:** each duty day checked against flight time, FDP, landing and rest limits, with rolling totals and weekly rest
- **Works offline** once opened (`sw.js` service worker), and can be added to the home screen

## Roster sync
Flights, deadheads and hotel layovers can be pulled in from a crew calendar (.ics) pasted from the clipboard, or from a monthly roster PDF. The calendar link lives only on your phone, never in this repository.

## Your data
Everything you enter, including your fixed pay, is saved in the browser on your own device. Nothing is sent anywhere and nothing is stored in this repository. Use **Setup → Download backup** now and then, and **Restore from file** to move to a new phone.

## Files
- `index.html`: the whole app (styles, default tables and logic in one file)
- `sw.js`: service worker for offline use
- `manifest.json`, `icon-*.png`, `apple-touch-icon.png`: home-screen install
- `pdfjs/`: [pdf.js](https://mozilla.github.io/pdf.js/) (Apache 2.0), used to read PDFs on the device

The default figures in the code are placeholders for personal use and are not taken from, or endorsed by, any employer. Check them against your own documents in Setup.
