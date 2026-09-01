var Clay = require('@rebble/clay');
var clayConfig = require('./config');
var clay = new Clay(clayConfig, null, { autoHandleEvents: false });

// ─── State ──────────────────────────────────────────────────
var DEFAULT_API_URL = 'https://sleeplogs.jtoy.net';

function getApiUrl() {
  return localStorage.getItem('apiUrl') || DEFAULT_API_URL;
}

function getOrcToken() {
  return localStorage.getItem('orcToken') || '';
}

// ─── Fetch columns from Vercel API ──────────────────────────
function fetchColumns() {
  var token = getOrcToken();
  if (!token) {
    console.log('No ORC token configured');
    sendColumnsFailed();
    return;
  }

  var url = getApiUrl() + '/api/columns';
  console.log('Fetching columns from: ' + url);

  var xhr = new XMLHttpRequest();
  xhr.onload = function() {
    if (xhr.status === 200) {
      try {
        var response = JSON.parse(xhr.responseText);
        var columns = response.columns;
        if (!Array.isArray(columns) || columns.length === 0) {
          console.log('No columns returned');
          sendColumnsFailed();
          return;
        }

        // Build pipe-delimited string:
        // key|label|type|default|min|max\n...
        var lines = [];
        for (var i = 0; i < columns.length; i++) {
          var c = columns[i];
          lines.push([
            c.key || '',
            c.label || '',
            c.field_type || '',
            c.default_value || '',
            (c.min_value !== null && c.min_value !== undefined) ? String(c.min_value) : '',
            (c.max_value !== null && c.max_value !== undefined) ? String(c.max_value) : ''
          ].join('|'));
        }
        var data = lines.join('\n') + '\n';

        console.log('Sending ' + columns.length + ' columns to watch');
        Pebble.sendAppMessage({ 'ColumnsData': data }, function() {
          console.log('Columns sent OK');
        }, function(e) {
          console.log('Columns send FAILED');
          sendColumnsFailed();
        });
      } catch (e) {
        console.log('Columns parse error: ' + e.message);
        sendColumnsFailed();
      }
    } else {
      console.log('Columns fetch HTTP error: ' + xhr.status + ' url=' + url);
      sendColumnsFailed();
    }
  };
  xhr.onerror = function() {
    console.log('Columns fetch network error (CORS? phone online?): ' + url);
    sendColumnsFailed();
  };
  xhr.open('GET', url, true);
  xhr.setRequestHeader('Authorization', 'Bearer ' + token);
  xhr.send();
}

function sendColumnsFailed() {
  Pebble.sendAppMessage({ 'ColumnsFailed': 1 }, function() {}, function() {});
}

// ─── Submit sleep log to Vercel API ─────────────────────────
function submitLog(jsonStr) {
  var token = getOrcToken();
  if (!token) {
    console.log('No ORC token for submit');
    sendLogResult(0);
    return;
  }

  var url = getApiUrl() + '/api/write_log';
  console.log('Submitting log to: ' + url);

  var xhr = new XMLHttpRequest();
  xhr.onload = function() {
    if (xhr.status === 200) {
      console.log('Log submitted OK');
      sendLogResult(1);
    } else {
      console.log('Log submit error: ' + xhr.status);
      sendLogResult(0);
    }
  };
  xhr.onerror = function() {
    console.log('Log submit network error');
    sendLogResult(0);
  };
  xhr.open('POST', url, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'Bearer ' + token);
  xhr.send(jsonStr);
}

function sendLogResult(success) {
  Pebble.sendAppMessage({ 'LogResult': success }, function() {}, function() {});
}

// ─── Event handlers ─────────────────────────────────────────
Pebble.addEventListener('ready', function() {
  console.log('PebbleKit JS ready for SleepLogs');
});

Pebble.addEventListener('appmessage', function(e) {
  var payload = e.payload;

  if (payload['RequestColumns']) {
    fetchColumns();
    return;
  }

  if (payload['SubmitLog']) {
    submitLog(payload['SubmitLog']);
    return;
  }

  console.log('Unhandled appmessage: ' + JSON.stringify(payload));
});

Pebble.addEventListener('showConfiguration', function() {
  // Clay only auto-saves values on a previous Save. Re-seed clay-settings from
  // our own stored values so the config page shows the saved token/URL on reopen
  // (stored values live on the phone in localStorage, never on the watch).
  var token = localStorage.getItem('orcToken');
  var apiUrl = localStorage.getItem('apiUrl');
  if (token || apiUrl) {
    var existing = {};
    try { existing = JSON.parse(localStorage.getItem('clay-settings')) || {}; } catch (e) {}
    if (token) existing['OrcToken'] = token;
    if (apiUrl) existing['ApiUrl'] = apiUrl;
    localStorage.setItem('clay-settings', JSON.stringify(existing));
  }
  Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e || !e.response) return;

  try {
    // e.response can arrive as a JSON string (classic Pebble app) or an
    // already-parsed object (newer platforms). Normalize to an object here
    // instead of relying on Clay's getSettings, which can throw on object
    // responses and silently drop the save.
    var parsed = e.response;
    if (typeof parsed === 'string') {
      if (parsed !== '' && parsed[0] !== '{') {
        parsed = decodeURIComponent(parsed);
      }
      parsed = JSON.parse(parsed);
    }

    // Clay form values arrive wrapped as { key: { value: ... } } — unwrap them.
    var settings = {};
    Object.keys(parsed).forEach(function(key) {
      var v = parsed[key];
      settings[key] = (v !== null && typeof v === 'object') ? v.value : v;
    });

    // Persist the secrets on the phone (never sent to the watch).
    if (settings['OrcToken']) {
      localStorage.setItem('orcToken', String(settings['OrcToken']));
      console.log('ORC token saved (' + String(settings['OrcToken']).length + ' chars)');
    } else {
      console.log('No ORC token in config response');
    }
    if (settings['ApiUrl']) {
      localStorage.setItem('apiUrl', String(settings['ApiUrl']));
      console.log('API URL saved: ' + settings['ApiUrl']);
    }

    // Persist for Clay prefill on next open.
    localStorage.setItem('clay-settings', JSON.stringify(settings));

    // Forward non-secret settings to the watch.
    delete settings['OrcToken'];
    delete settings['ApiUrl'];
    if (Object.keys(settings).length > 0) {
      Pebble.sendAppMessage(settings, function() {
        console.log('Settings sent to watch');
      }, function(err) {
        console.log('Settings send failed');
      });
    }
  } catch (ex) {
    console.log('webviewclosed error: ' + ex.message);
  }
});
