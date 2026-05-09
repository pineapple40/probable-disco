/**
 * CCB Daily Log Button
 * Google Apps Script backend for:
 *  - Form + Sheet daily log capture
 *  - Buildertrend-style formatted output
 *  - One-tap copy mobile page
 */

const CFG = {
  spreadsheetId: '', // Optional: set for standalone script; leave blank for container-bound script.
  tabs: {
    jobs: 'Jobs',
    entries: 'Entries',
    output: 'Output',
  },
  headers: [
    'Timestamp',
    'Job',
    'Weather',
    'Crew Count',
    'Subcontractors Onsite',
    'Deliveries',
    'Safety/Incidents',
    'Progress Notes',
    'Photos',
  ],
  buildertrendUrl: 'https://buildertrend.net',
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CCB Daily Log')
    .addItem('Create / Sync Form', 'createOrSyncForm')
    .addItem('Generate Latest Output Block', 'generateLatestOutputBlock')
    .addItem('Open Mobile Copy Page', 'openMobileCopyPage')
    .addItem('Copy Log Text', 'copyLatestLogTextToClipboardNotice')
    .addToUi();
}

function getSpreadsheet_() {
  if (CFG.spreadsheetId) return SpreadsheetApp.openById(CFG.spreadsheetId);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function ensureTabStructure_() {
  const ss = getSpreadsheet_();
  const jobs = getOrCreateSheet_(ss, CFG.tabs.jobs);
  const entries = getOrCreateSheet_(ss, CFG.tabs.entries);
  const output = getOrCreateSheet_(ss, CFG.tabs.output);

  if (jobs.getLastRow() === 0) {
    jobs.getRange(1, 1).setValue('Job Name');
    jobs.getRange(2, 1).setValue('Example Job - Maple Ave Remodel');
    jobs.setFrozenRows(1);
  }

  const entryHeader = entries.getRange(1, 1, 1, CFG.headers.length).getValues()[0];
  const hasHeader = entryHeader.every((v, i) => v === CFG.headers[i]);
  if (!hasHeader) {
    entries.clearContents();
    entries.getRange(1, 1, 1, CFG.headers.length).setValues([CFG.headers]);
    entries.setFrozenRows(1);
  }

  if (output.getLastRow() === 0) {
    output.getRange(1, 1, 1, 5).setValues([[
      'Generated At',
      'Entry Timestamp',
      'Job',
      'Buildertrend Daily Log Text',
      'Buildertrend Link',
    ]]);
    output.setFrozenRows(1);
  }
}

function getJobs_() {
  const ss = getSpreadsheet_();
  const sh = getOrCreateSheet_(ss, CFG.tabs.jobs);
  const vals = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 0), 1).getValues()
    .flat()
    .map(v => String(v).trim())
    .filter(Boolean);
  return [...new Set(vals)];
}

function createOrSyncForm() {
  ensureTabStructure_();
  const ss = getSpreadsheet_();
  const props = PropertiesService.getScriptProperties();
  let form;

  const existingId = props.getProperty('CCB_FORM_ID');
  if (existingId) {
    try {
      form = FormApp.openById(existingId);
    } catch (e) {
      form = null;
    }
  }

  if (!form) {
    form = FormApp.create('CCB Daily Log Button');
    props.setProperty('CCB_FORM_ID', form.getId());
  }

  form.setDescription('Daily field log for CCB projects.');
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false);

  const jobs = getJobs_();
  form.getItems().forEach(item => form.deleteItem(item));

  const jobItem = form.addListItem().setTitle('Job').setRequired(true);
  if (jobs.length) {
    jobItem.setChoiceValues(jobs);
  } else {
    jobItem.setChoiceValues(['Add jobs to Jobs tab']);
  }

  form.addTextItem().setTitle('Weather').setRequired(true);
  form.addTextItem().setTitle('Crew Count').setRequired(true);
  form.addParagraphTextItem().setTitle('Subcontractors Onsite');
  form.addParagraphTextItem().setTitle('Deliveries');
  form.addParagraphTextItem().setTitle('Safety/Incidents');
  form.addParagraphTextItem().setTitle('Progress Notes').setRequired(true);
  form.addParagraphTextItem().setTitle('Photos');

  const destId = ss.getId();
  form.setDestination(FormApp.DestinationType.SPREADSHEET, destId);

  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onFormSubmit')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('onFormSubmit')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();

  SpreadsheetApp.getUi().alert(
    'Form synced.\n\nEdit URL:\n' + form.getEditUrl() + '\n\nLive URL:\n' + form.getPublishedUrl()
  );
}

function onFormSubmit(e) {
  ensureTabStructure_();
  const ss = getSpreadsheet_();
  const entries = ss.getSheetByName(CFG.tabs.entries);

  const named = e.namedValues || {};
  const row = [
    new Date(),
    first_(named['Job']),
    first_(named['Weather']),
    first_(named['Crew Count']),
    first_(named['Subcontractors Onsite']),
    first_(named['Deliveries']),
    first_(named['Safety/Incidents']),
    first_(named['Progress Notes']),
    first_(named['Photos']),
  ];

  entries.appendRow(row);
  generateLatestOutputBlock();
}

function first_(arr) {
  if (!arr || !arr.length) return '';
  return String(arr[0] || '').trim();
}

function generateLatestOutputBlock() {
  ensureTabStructure_();
  const ss = getSpreadsheet_();
  const entries = ss.getSheetByName(CFG.tabs.entries);
  const output = ss.getSheetByName(CFG.tabs.output);

  const last = entries.getLastRow();
  if (last < 2) return;

  const entry = entries.getRange(last, 1, 1, CFG.headers.length).getValues()[0];
  const logText = buildBuildertrendDailyLogText_(entry);

  output.appendRow([
    new Date(),
    entry[0],
    entry[1],
    logText,
    CFG.buildertrendUrl,
  ]);

  const r = output.getLastRow();
  output.getRange(r, 4).setWrap(true);
  output.autoResizeColumn(1);
  output.autoResizeColumn(2);
  output.autoResizeColumn(3);
  output.autoResizeColumn(5);
}

function buildBuildertrendDailyLogText_(entry) {
  const [timestamp, job, weather, crewCount, subs, deliveries, safety, progress, photos] = entry;
  const d = timestamp instanceof Date
    ? Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd')
    : String(timestamp);

  return [
    'DAILY LOG',
    `Project: ${job}`,
    `Date: ${d}`,
    '',
    'WEATHER',
    weather || 'N/A',
    '',
    'LABOR / CREW',
    `Crew Count: ${crewCount || 'N/A'}`,
    `Subcontractors Onsite: ${subs || 'N/A'}`,
    '',
    'DELIVERIES',
    deliveries || 'N/A',
    '',
    'SAFETY / INCIDENTS',
    safety || 'None reported',
    '',
    'WORK COMPLETED / PROGRESS NOTES',
    progress || 'N/A',
    '',
    'PHOTOS',
    photos || 'No photos listed',
    '',
    `Buildertrend Daily Logs: ${CFG.buildertrendUrl}`,
  ].join('\n');
}

function getLatestLogText() {
  const ss = getSpreadsheet_();
  const output = ss.getSheetByName(CFG.tabs.output);
  if (!output || output.getLastRow() < 2) return '';
  return String(output.getRange(output.getLastRow(), 4).getValue() || '');
}

function getBuildertrendUrl() {
  return CFG.buildertrendUrl;
}

function copyLatestLogTextToClipboardNotice() {
  const ui = SpreadsheetApp.getUi();
  const txt = getLatestLogText();
  if (!txt) {
    ui.alert('No generated log text found yet. Submit the form first.');
    return;
  }

  ui.alert('Use: CCB Daily Log → Open Mobile Copy Page for one-tap copy.');
}

function openMobileCopyPage() {
  const url = ScriptApp.getService().getUrl();
  if (!url) {
    SpreadsheetApp.getUi().alert('Deploy as a Web App first, then retry this action.');
    return;
  }
  const html = HtmlService.createHtmlOutput(
    `<script>window.open('${url}', '_blank');google.script.host.close();</script>`
  ).setWidth(200).setHeight(80);
  SpreadsheetApp.getUi().showModalDialog(html, 'Opening Mobile Page...');
}

function doGet() {
  return HtmlService.createTemplateFromFile('MobileCopy')
    .evaluate()
    .setTitle('CCB Daily Log Button')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
