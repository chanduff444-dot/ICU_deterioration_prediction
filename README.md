# AegisICU

AegisICU is a browser-based ICU early warning dashboard with simulated patient telemetry, risk trajectories, SHAP feature drivers, cohort triage, alerts, notes, and patient admission workflows.

## Local development

Open `index.html` through a local web server. For example:

```powershell
python run_web.py
```

## Render deployment

This project is configured as a Render Static Site through [`render.yaml`](./render.yaml). The app has no server-side runtime requirements; all dashboard interactions run in the browser.
