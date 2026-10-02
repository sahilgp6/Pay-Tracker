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

## Your data
Everything you enter, including your fixed pay, is saved in the browser on your own device. Nothing is sent anywhere and nothing is stored in this repository. Use **Setup → Download backup** now and then, and **Restore from file** to move to a new phone.

## Files
- `index.html`: the whole app (styles, rate tables and logic in one file)
- `sw.js`: service worker for offline use
- `manifest.json`, `icon-*.png`, `apple-touch-icon.png`: home-screen install
