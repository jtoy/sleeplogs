var Clay = require('@rebble/clay');
var clayConfig = require('./config');
// Build-time secrets (baked into the pbw — see secrets.js)
var secrets = require('./secrets');

var clay = new Clay(clayConfig, null, { autoHandleEvents: false });

// ─── State ──────────────────────────────────────────────────
var DEFAULT_API_URL = secrets.API_URL || 'https://sleeplogs.jtoy.net';

function getApiUrl() {
  // Preference: baked-in build secret > localStorage (phone) > default
  return secrets.API_URL || localStorage.getItem('apiUrl') || DEFAULT_API_URL;
}

function getOrcToken() {
  // Preference: baked-in build secret > localStorage (phone)
  if (secrets.ORC_TOKEN) return secrets.ORC_TOKEN;
  var token = localStorage.getItem('orcToken');
  if (token) return token;
  // Last resort: Clay's own persisted settings (written by stock Clay on Save)
  try {
    var claySettings = JSON.parse(localStorage.getItem('clay-settings') || '{}');
    if (claySettings['OrcToken']) return String(claySettings['OrcToken']);
  } catch (e) {}
  return '';
}

// Error codes sent to the watch with ColumnsFailed:
//   1 = no token configured
//   2 = network / CORS error
//   3 = HTTP error (server responded)
function sendColumnsFailed(code) {
  Pebble.sendAppMessage({ 'ColumnsFailed': code || 2 }, function() {}, function() {});
}

// ─── Wakeup silent-skip: was tonight already logged? ──────────
// Status to watch: 1 = already submitted, 0 = not, 2 = can't check.
function sendSubmittedStatus(status) {
  Pebble.sendAppMessage({ 'SubmittedStatus': status }, function() {}, function() {});
}

function checkSubmitted(nightOf) {
  var token = getOrcToken();
  if (!token) {
    console.log('No ORC token for submitted-check');
    sendSubmittedStatus(2);
    return;
  }
  var url = getApiUrl() + '/api/logs?night_of=' + encodeURIComponent(nightOf);
  console.log('Checking if ' + nightOf + ' was submitted: ' + url);

  var xhr = new XMLHttpRequest();
  xhr.onload = function() {
    if (xhr.status === 200) {
      try {
        var resp = JSON.parse(xhr.responseText);
        var logs = resp.logs || [];
        var exists = Array.isArray(logs) && logs.length > 0;
        console.log('night_of ' + nightOf + ' exists: ' + exists);
        sendSubmittedStatus(exists ? 1 : 0);
      } catch (e) {
        console.log('Submitted-check parse error: ' + e.message);
        sendSubmittedStatus(2);
      }
    } else {
      console.log('Submitted-check HTTP error: ' + xhr.status);
      sendSubmittedStatus(2);
    }
  };
  xhr.onerror = function() {
    console.log('Submitted-check network error');
    sendSubmittedStatus(2);
  };
  xhr.open('GET', url, true);
  xhr.setRequestHeader('Authorization', 'Bearer ' + token);
  xhr.send();
}

// ─── Fetch columns from Vercel API ──────────────────────────
function fetchColumns() {
  var token = getOrcToken();
  if (!token) {
    console.log('No ORC token configured (baked secret, localStorage, or Clay)');
    sendColumnsFailed(1);
    return;
  }
  console.log('Using ORC token: ' + token.substring(0, 6) + '... (' + token.length + ' chars)');

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
          sendColumnsFailed(3);
          return;
        }

        // Build pipe-delimited string: key|label|type|default|min|max\n...
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
          sendColumnsFailed(2);
        });
      } catch (e) {
        console.log('Columns parse error: ' + e.message);
        sendColumnsFailed(3);
      }
    } else {
      console.log('Columns fetch HTTP error: ' + xhr.status + ' url=' + url);
      sendColumnsFailed(xhr.status === 401 || xhr.status === 403 ? 4 : 3);
    }
  };
  xhr.onerror = function() {
    console.log('Columns fetch network error (CORS? phone online?): ' + url);
    sendColumnsFailed(2);
  };
  xhr.open('GET', url, true);
  xhr.setRequestHeader('Authorization', 'Bearer ' + token);
  xhr.send();
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
  console.log('Token source: ' + (secrets.ORC_TOKEN ? 'baked-in secret' : (localStorage.getItem('orcToken') ? 'localStorage' : 'NONE')));
  console.log('API URL: ' + getApiUrl());
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

  if (payload['CheckSubmitted']) {
    checkSubmitted(payload['CheckSubmitted']);
    return;
  }

  console.log('Unhandled appmessage: ' + JSON.stringify(payload));
});

Pebble.addEventListener('showConfiguration', function() {
  // Re-seed Clay's settings from our stored values so the config page shows the
  // saved token/URL on reopen (stored values live on the phone in localStorage).
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
  if (!e || !e.response) {
    console.log('Config page closed WITHOUT a response — nothing saved');
    return;
  }

  try {
    // e.response can arrive as a JSON string or an already-parsed object.
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

    // Persist the secrets on the phone.
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