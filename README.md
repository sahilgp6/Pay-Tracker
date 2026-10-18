# Pay Tracker

Flight log and pay calculator for Air India Express pilots, on the revised pay structure effective 1 October 2026.

Live: https://sahilgp6.github.io/Pay-Tracker/

Made by Sahil Gupta.

## Features
- **Flight log:** sectors with fixed block hours (PAC/SOP/27), deadhead sectors for SOD, diversions and ferry flights on actual block, domestic layover nights
- **Pay:** fixed pay from your compensation letter, tiered flying allowance above 40 hours (0-40, 40-70, 70-80, 80-90, 90+), SOD at 65% of the 0-40 rate, estimated TDS, employee PF and professional tax, with a new vs old tax regime comparison
- **International layovers:** per diem in USD for 215 countries from AIXL/HR/2022/3918, with the 30% / 70% / full-day rule; tax-exempt and kept outside CTC
- **Year:** month-by-month block hours, gross, TDS and take-home for the financial year
- **Ranks:** JFO, FO, Captain (SFO), Commander and Senior Commander rates
- **Works offline** once opened from the live link (`sw.js` service worker), and can be added to the home screen

## Roster sync
Flights, deadheads (including OAT positioning) and hotel layovers can be pulled in from the Crew Access calendar. An iOS Shortcut copies the published calendar (.ics) to the clipboard, and **Paste roster** on the Flight log tab reads it. Re-syncing updates changed duties, removes cancelled ones and keeps any hours you have corrected. Standby and days off are ignored. The calendar link lives only in the Shortcut on your phone, never in this repository.

## Duty (FDTL)
The Duty tab shows one duty day at a time from the pasted roster: report, each sector, transit halts over 1 hour (unpaid, counted as duty) and sign-out, in UTC. Enter actual report, off-blocks and on-blocks times to compare planned with actual; actual times are used for FDTL only, never for pay. Each duty is checked against OM-A Chapter 2: flight time, FDP and landings by the 2.6.1 table (night duty touching 00:00-06:00 IST: 8 h, 10:00, 2 landings), duty period (max FDP + 1 h), and rest before the duty (2.10, including +30 min at domestic stations, Note 3 night rest and rest after standby). Rolling 7, 14, 28, 90 and 365-day flight time and duty totals (2.8) build up from 1 October 2026. The weekly-rest cycle is tracked too: weekly rest of 48 h with 2 local nights, or 60 h after more than 3 night duties in 168 h (2.10.6), never more than 168 h apart, with the 23:14 sign-out rule of the Rostering Policy; consecutive night duties (2.13.1); at most 4 Note 3 duties in 168 h; and more than 3 early-morning reports in a row (Rostering Policy 2.3.4). Standby call-outs are picked up when a duty reports inside a standby (home: nothing counts within 6 h, then the FDP limit drops by half the standby time; airport: the standby counts in full), and you can override that per standby. A duty can be marked as extended under 2.16 (limits, 28-day caps and the extra 2 or 4 h rest) or as cancelled after reporting (rest of twice the time after report, at least 12 h). Each duty card ends with the earliest acceptable departure after it, domestic and international, in UTC: sign-out (on-blocks + 15 min, or 30 min after a flight landing in India from abroad for the breath test), transport each way (45 min at domestic stations, 30 abroad; neither duty nor rest), the minimum rest with any additions (including 30 min at domestic stations), then 1:00 to report, or 1:15 for an international departure from a metro. Each paste is compared with the last one for duties still ahead, and changes with under 12 h notice or on a published day off are flagged.

## Your data
Everything you enter, including your fixed pay, is saved in the browser on your own device. Nothing is sent anywhere and nothing is stored in this repository. Use **Setup → Download backup** now and then, and **Restore from file** to move to a new phone.

## Files
- `index.html`: the whole app (styles, rate tables and logic in one file)
- `sw.js`: service worker for offline use
- `manifest.json`, `icon-*.png`, `apple-touch-icon.png`: home-screen install
