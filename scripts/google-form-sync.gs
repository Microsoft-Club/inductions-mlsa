/**
 * Google Form → MLSA induction app. Sends each new form response to the app's form-sync function,
 * which adds the person to the candidates (or updates them) and shows anything odd as a warning on
 * the queue board.
 *
 * Paste this into the form's responses sheet (Extensions → Apps Script). Setup, step by step:
 * docs/google-form-sync.md in the app's repository.
 *
 * Script properties (Project Settings → Script properties):
 *   SYNC_URL     https://<project-ref>.supabase.co/functions/v1/form-sync
 *   SYNC_SECRET  the same value as FORM_SYNC_SECRET in Supabase (Edge Functions → Secrets)
 */

/** Runs from the installable "On form submit" trigger (From spreadsheet → On form submit). */
function onFormSubmit(e) {
  sendRow_(e.range.getSheet(), e.range.getRow());
}

/**
 * Run by hand from the editor to check the setup: sends the newest response again. Safe to repeat;
 * a response the app already has changes nothing.
 */
function sendLatestResponse() {
  const sheet = SpreadsheetApp.getActive().getSheets().find((s) => s.getFormUrl());
  if (!sheet) throw new Error('This spreadsheet has no form responses sheet');
  Logger.log(`Row ${sheet.getLastRow()}: ${sendRow_(sheet, sheet.getLastRow())}`);
}

/** Sends the header row and one response row, as displayed (exactly what a CSV export holds). */
function sendRow_(sheet, row) {
  const properties = PropertiesService.getScriptProperties();
  const url = properties.getProperty('SYNC_URL');
  const secret = properties.getProperty('SYNC_SECRET');
  if (!url || !secret) throw new Error('Set SYNC_URL and SYNC_SECRET under Project Settings → Script properties');

  const columns = sheet.getLastColumn();
  const payload = JSON.stringify({
    header: sheet.getRange(1, 1, 1, columns).getDisplayValues()[0],
    values: sheet.getRange(row, 1, 1, columns).getDisplayValues()[0],
  });

  let problem = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) Utilities.sleep(2000 * attempt);
    let response;
    try {
      response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-form-sync-secret': secret },
        payload,
        muteHttpExceptions: true,
      });
    } catch (err) {
      problem = String(err);
      continue;
    }
    const status = response.getResponseCode();
    if (status === 200) return response.getContentText();
    problem = `HTTP ${status} ${response.getContentText()}`;
    // A wrong secret, a changed form or no active induction won't fix itself by retrying.
    if (status < 500) break;
  }
  // Failing the run makes Google email the script's owner about it.
  throw new Error(`The induction app did not take row ${row}: ${problem}`);
}
