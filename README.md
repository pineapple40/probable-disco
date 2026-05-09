# CCB Daily Log Button

Google Form + Apps Script workflow for fast field reporting and Buildertrend-ready daily logs.

## What this builds

- **Google Form** titled **"CCB Daily Log Button"** with fields:
  - Job *(dropdown sourced from the `Jobs` sheet tab)*
  - Weather
  - Crew Count
  - Subcontractors Onsite
  - Deliveries
  - Safety/Incidents
  - Progress Notes
  - Photos
- **Google Sheet tabs**:
  - `Jobs`
  - `Entries`
  - `Output`
- **Apps Script automation**:
  1. Writes each form submission into `Entries`
  2. Generates a formatted daily log block in `Output`
  3. Includes a **Copy Log Text** workflow
  4. Serves a **mobile-friendly HTML page** with one-tap copy
  5. Includes a button/link to open **Buildertrend Daily Logs**

## Files in this repo

- `apps_script/Code.gs` — core Apps Script logic
- `apps_script/MobileCopy.html` — mobile one-tap copy web UI

## Setup Instructions

## 1) Create the Google Sheet

1. Create a new Google Sheet (name it `CCB Daily Log Button`).
2. Open **Extensions → Apps Script**.
3. Replace default `Code.gs` with `apps_script/Code.gs` from this repo.
4. Add a new HTML file named `MobileCopy` and paste in `apps_script/MobileCopy.html`.
5. Save.

## 2) Configure tabs and seed jobs

1. Back in the spreadsheet, create/confirm tabs:
   - `Jobs`
   - `Entries`
   - `Output`
2. In `Jobs`, keep header in `A1` as `Job Name`.
3. Add each job in column A (starting row 2).

> Tip: The script also auto-creates missing tabs and headers if needed.

## 3) Authorize and generate the Form

1. Reload the spreadsheet.
2. Use new menu: **CCB Daily Log → Create / Sync Form**.
3. Accept authorization prompts.
4. Script will create (or rebuild) a Google Form named **CCB Daily Log Button** and attach trigger logic.

## 4) Deploy mobile copy page (Web App)

1. In Apps Script: **Deploy → New deployment**.
2. Type: **Web app**.
3. Execute as: **Me**.
4. Who has access: choose your org preference (typically anyone in your company).
5. Deploy and copy the web app URL.

Then in the sheet run: **CCB Daily Log → Open Mobile Copy Page**.

## 5) Daily use flow

1. Open form on phone/tablet.
2. Submit daily entry.
3. Script appends the record to `Entries`.
4. Script generates Buildertrend-style log text in `Output`.
5. Open mobile page and tap **Copy Log Text**.
6. Tap **Open Buildertrend Daily Logs** and paste into Buildertrend.

## Output format (Buildertrend-style sections)

Each output block is formatted consistently with daily log sections:

- DAILY LOG (project/date)
- WEATHER
- LABOR / CREW
- DELIVERIES
- SAFETY / INCIDENTS
- WORK COMPLETED / PROGRESS NOTES
- PHOTOS
- Buildertrend Daily Logs link

## Customization notes

- Update Buildertrend URL in `CFG.buildertrendUrl` inside `Code.gs` (if you use a specific direct path).
- If this is a standalone script project, set `CFG.spreadsheetId`.
- If container-bound to the target sheet, leave `spreadsheetId` blank.

