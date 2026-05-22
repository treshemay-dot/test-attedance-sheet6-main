OPTI-WORK SOLUTIONS ATTENDANCE SYSTEM - FINAL TEST PACKAGE

FILES FOR GITHUB PAGES:
- index.html
- style.css
- script.js
- logo.png
- manifest.json
- service-worker.js

FILE FOR GOOGLE APPS SCRIPT ONLY:
- code.gs

IMPORTANT:
Do NOT rely on code.gs from GitHub as your backend. Open Google Apps Script, paste code.gs there, then deploy as Web App.

GOOGLE SHEETS TABS REQUIRED:
- AGENTS
- ATTENDANCE
- HISTORY

Apps Script settings:
Execute as: Me
Who has access: Anyone

Backend test:
Open your Web App URL ending in /exec. It should show:
{"success":true,"message":"Opti-work Solutions attendance backend is running."}

If GitHub still shows old behavior:
1. Hard refresh browser using Ctrl + F5.
2. Clear site data/cache for your domain.
3. Make sure script.js has the latest GOOGLE_SCRIPT_URL.
