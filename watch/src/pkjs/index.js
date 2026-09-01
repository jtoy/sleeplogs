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
      console.log('Columns fetch error: ' + xhr.status);
      sendColumnsFailed();
    }
  };
  xhr.onerror = function() {
    console.log('Columns fetch network error');
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
  Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e || !e.response) return;

  try {
    var dict = clay.getSettings(e.response, false);

    // Store ORC token and API URL on phone (never sent to watch)
    var tokenSetting = dict['OrcToken'];
    if (tokenSetting !== undefined) {
      var tokenVal = typeof tokenSetting === 'object' ? tokenSetting.value : tokenSetting;
      if (tokenVal) {
        localStorage.setItem('orcToken', String(tokenVal));
        console.log('ORC token saved');
      }
      delete dict['OrcToken'];
    }

    var urlSetting = dict['ApiUrl'];
    if (urlSetting !== undefined) {
      var urlVal = typeof urlSetting === 'object' ? urlSetting.value : urlSetting;
      if (urlVal) {
        localStorage.setItem('apiUrl', String(urlVal));
        console.log('API URL saved: ' + urlVal);
      }
      delete dict['ApiUrl'];
    }

    // Forward remaining settings (AutoPopup, PopupHour, etc.) to watch
    Pebble.sendAppMessage(dict, function() {
      console.log('Settings sent to watch');
    }, function(err) {
      console.log('Settings send failed');
    });
  } catch (ex) {
    console.log('webviewclosed error: ' + ex.message);
  }
});
