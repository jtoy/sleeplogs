function hourOpts() {
  var o = [];
  for (var h = 0; h < 24; h++) {
    o.push({ label: String(h).padStart(2, '0') + ':00', value: h });
  }
  return o;
}

module.exports = [
  { "type": "heading", "defaultValue": "SleepLogs" },

  { "type": "section", "items": [
    { "type": "heading", "defaultValue": "Popup Schedule" },
    { "type": "toggle", "messageKey": "AutoPopup", "label": "Auto popup", "defaultValue": true },
    { "type": "select", "messageKey": "PopupHour", "label": "Popup hour",
      "defaultValue": 6, "options": hourOpts() },
    { "type": "select", "messageKey": "PopupMinute", "label": "Popup minute",
      "defaultValue": 0,
      "options": [
        { "label": ":00", "value": 0 },
        { "label": ":15", "value": 15 },
        { "label": ":30", "value": 30 },
        { "label": ":45", "value": 45 }
      ]
    },
    { "type": "select", "messageKey": "ReminderInterval", "label": "Remind every (min)",
      "defaultValue": 30,
      "options": [
        { "label": "15 minutes", "value": 15 },
        { "label": "30 minutes", "value": 30 },
        { "label": "45 minutes", "value": 45 },
        { "label": "60 minutes", "value": 60 }
      ]
    }
  ]},

  { "type": "section", "items": [
    { "type": "heading", "defaultValue": "Connection" },
    { "type": "input", "messageKey": "ApiUrl", "label": "API URL",
      "defaultValue": "https://sleeplogs.jtoy.net",
      "attributes": { "placeholder": "https://sleeplogs.jtoy.net" }
    },
    { "type": "input", "messageKey": "OrcToken", "label": "Distark ORC Token",
      "defaultValue": "",
      "attributes": { "type": "password", "placeholder": "Paste your ORC token" }
    }
  ]},

  { "type": "submit", "defaultValue": "Save" }
];
