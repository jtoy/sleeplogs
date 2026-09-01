/*
 * Host-side test harness for SleepLogs PKJS (src/pkjs/index.js).
 *
 * Runs the REAL shipping PKJS code in Node with a mocked phone environment
 * (Pebble API, localStorage, XMLHttpRequest) + a fake Clay (the real one needs
 * a browserify build step and the Pebble `message_keys` module).
 *
 * Usage:
 *   cd watch && node test/pkjs.test.js
 *
 * Exits 0 only if every assertion passes.
 */

const Module = require("module");
const path = require("path");

const PKJS_PATH = path.join(__dirname, "..", "src", "pkjs", "index.js");

// ─── Mock environment ───────────────────────────────────────────────
const listeners = {}; // event -> [fn]
const store = new Map(); // localStorage
const sentMessages = []; // { key: value } objects sent via sendAppMessage
const openedUrls = [];

global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

global.Pebble = {
  platform: "qemu",
  addEventListener: (evt, fn) => {
    (listeners[evt] = listeners[evt] || []).push(fn);
  },
  removeEventListener: () => {},
  sendAppMessage: (dict, ok, fail) => {
    sentMessages.push(dict);
    if (ok) ok();
  },
  openURL: (url) => {
    openedUrls.push(url);
  },
  getActiveWatchInfo: () => ({ platform: "emery" }),
  getAccountToken: () => "",
  getWatchToken: () => "",
};

// Mock XHR
class FakeXHR {
  constructor() {
    this.headers = {};
    this.responseText = "";
    this.status = 0;
  }
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k, v) {
    this.headers[k] = v;
  }
  send(body) {
    this.body = body;
    FakeXHR.last = this;
    if (FakeXHR.onSend) FakeXHR.onSend(this);
    // configure the outcome; if one is set, the harness drives the callback
    if (FakeXHR.outcome && FakeXHR.outcome(this)) return;
    // otherwise call onload with whatever status was set (browser behavior:
    // HTTP errors still fire onload, network errors fire onerror)
    if (this.onload) this.onload();
  }
}
FakeXHR.autoRespond = true; // when false + outcome set, harness drives it
global.XMLHttpRequest = FakeXHR;

// Fake Clay: our code only calls clay.generateUrl()
function FakeClay() {}
FakeClay.prototype.generateUrl = () => "data:text/html;charset=utf-8,clay-url";
FakeClay.prototype.getSettings = () => ({});

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@rebble/clay") return FakeClay;
  return originalLoad.apply(this, arguments);
};

// ─── Test harness ───────────────────────────────────────────────────
let g_pass = 0;
let g_fail = 0;
function check(cond, msg) {
  if (cond) g_pass++;
  else {
    g_fail++;
    console.log("FAIL: " + msg);
  }
}

function fire(event, payload) {
  (listeners[event] || []).forEach((fn) => fn(payload));
}

function reset() {
  store.clear();
  sentMessages.length = 0;
  openedUrls.length = 0;
  listeners["ready"] = [];
  listeners["appmessage"] = [];
  listeners["showConfiguration"] = [];
  listeners["webviewclosed"] = [];
  FakeXHR.outcome = null;
  FakeXHR.autoRespond = true;
  FakeXHR.onSend = null;
}

function lastMessage() {
  return sentMessages[sentMessages.length - 1];
}

// Load PKJS fresh for each run (secrets.js is baked in at build time;
// for the harness we inject a token via a temp copy to avoid touching the
// real secrets file).
function loadPKJS(tokens) {
  // Re-require with a mocked secrets module
  const fs = require("fs");
  const srcPath = path.join(__dirname, "..", "src", "pkjs", "index.js");
  const src = fs.readFileSync(srcPath, "utf8");
  const secretsPath = path.join(__dirname, "..", "src", "pkjs", "secrets.js");
  const origSecrets = fs.readFileSync(secretsPath, "utf8");
  fs.writeFileSync(secretsPath, "module.exports = " + JSON.stringify(tokens) + ";");
  try {
    delete require.cache[require.resolve(secretsPath)];
    delete require.cache[require.resolve(PKJS_PATH)];
    require(PKJS_PATH);
  } finally {
    fs.writeFileSync(secretsPath, origSecrets);
  }
}

// ─── Tests ──────────────────────────────────────────────────────────

console.log("=== PKJS harness tests ===\n");

// 1. webviewclosed with plain JSON string response
reset();
loadPKJS({ ORC_TOKEN: "", API_URL: "" });
const resp1 = JSON.stringify({ OrcToken: { value: "tok-abc" }, ApiUrl: { value: "https://sleeplogs.jtoy.net" }, AutoPopup: { value: true } });
fire("webviewclosed", { response: resp1 });
check(store.get("orcToken") === "tok-abc", "1. webviewclosed JSON-string: orcToken saved");
check(store.get("apiUrl") === "https://sleeplogs.jtoy.net", "1. apiUrl saved");
check(store.has("clay-settings"), "1. clay-settings persisted");
console.log("   orcToken:", store.get("orcToken"));

// 2. webviewclosed with URL-encoded response
reset();
loadPKJS({ ORC_TOKEN: "", API_URL: "" });
const resp2 = encodeURIComponent(JSON.stringify({ OrcToken: { value: "tok-xyz" } }));
fire("webviewclosed", { response: resp2 });
check(store.get("orcToken") === "tok-xyz", "2. webviewclosed URL-encoded: orcToken saved");

// 3. webviewclosed with already-parsed OBJECT response (newer platforms)
reset();
loadPKJS({ ORC_TOKEN: "", API_URL: "" });
fire("webviewclosed", { response: { OrcToken: { value: "tok-obj" } } });
check(store.get("orcToken") === "tok-obj", "3. webviewclosed object response: orcToken saved");

// 4. webviewclosed with no response (user cancels) — must not crash, nothing saved
reset();
loadPKJS({ ORC_TOKEN: "", API_URL: "" });
fire("webviewclosed", { response: "" });
fire("webviewclosed", { response: undefined });
check(!store.has("orcToken"), "4. cancel: nothing saved, no crash");

// 5. RequestColumns with baked-in token → XHR GET with Bearer
reset();
loadPKJS({ ORC_TOKEN: "baked-token-1", API_URL: "" });
FakeXHR.onSend = (x) => {
  x.status = 200;
  x.responseText = JSON.stringify({ columns: [{ key: "sleep_rating", label: "Sleep Rating", field_type: "rating", default_value: null, min_value: 1, max_value: 5 }] });
};
fire("appmessage", { payload: { RequestColumns: 1 } });
check(FakeXHR.last !== undefined, "5. RequestColumns triggered XHR");
if (FakeXHR.last) {
  check(FakeXHR.last.url === "https://sleeplogs.jtoy.net/api/columns", "5. XHR URL is columns endpoint (" + FakeXHR.last.url + ")");
  check(FakeXHR.last.headers["Authorization"] === "Bearer baked-token-1", "5. Bearer header set (" + FakeXHR.last.headers["Authorization"] + ")");
}
const colsMsg = lastMessage();
check(colsMsg && colsMsg["ColumnsData"] !== undefined, "5. ColumnsData sent to watch");
if (colsMsg && colsMsg["ColumnsData"]) {
  check(colsMsg["ColumnsData"].includes("sleep_rating"), "5. columns include sleep_rating");
}

// 6. RequestColumns with NO token → ColumnsFailed code 1
reset();
loadPKJS({ ORC_TOKEN: "", API_URL: "" });
fire("appmessage", { payload: { RequestColumns: 1 } });
const failMsg = lastMessage();
check(failMsg && failMsg["ColumnsFailed"] === 1, "6. no token → ColumnsFailed code 1 (got " + JSON.stringify(failMsg) + ")");

// 7. HTTP 401 from server → ColumnsFailed code 4
reset();
loadPKJS({ ORC_TOKEN: "tok-expired", API_URL: "" });
FakeXHR.onSend = (x) => {
  x.status = 401;
  x.responseText = "";
};
fire("appmessage", { payload: { RequestColumns: 1 } });
const authFail = lastMessage();
check(authFail && authFail["ColumnsFailed"] === 4, "7. HTTP 401 → ColumnsFailed code 4 (got " + JSON.stringify(authFail) + ")");

// 8. Network error → ColumnsFailed code 2
reset();
loadPKJS({ ORC_TOKEN: "tok-net", API_URL: "" });
FakeXHR.outcome = (x) => {
  x.onerror();
  return true;
};
fire("appmessage", { payload: { RequestColumns: 1 } });
const netFail = lastMessage();
check(netFail && netFail["ColumnsFailed"] === 2, "8. network error → ColumnsFailed code 2 (got " + JSON.stringify(netFail) + ")");

// 9. SubmitLog with token → POST to write_log with Bearer, LogResult 1 on 200
reset();
loadPKJS({ ORC_TOKEN: "baked-token-2", API_URL: "" });
FakeXHR.onSend = (x) => {
  x.status = 200;
  x.responseText = JSON.stringify({ ok: true, id: 1 });
};
const logJson = JSON.stringify({ night_of: "2026-08-27", data: { sleep_rating: 4 } });
fire("appmessage", { payload: { SubmitLog: logJson } });
check(FakeXHR.last.method === "POST", "9. submit uses POST");
check(FakeXHR.last.url === "https://sleeplogs.jtoy.net/api/write_log", "9. submit URL is write_log");
check(FakeXHR.last.headers["Authorization"] === "Bearer baked-token-2", "9. submit Bearer header");
check(FakeXHR.last.body === logJson, "9. submit body is the log JSON");
const logOk = lastMessage();
check(logOk && logOk["LogResult"] === 1, "9. LogResult 1 on success");

// 10. SubmitLog with no token → LogResult 0
reset();
loadPKJS({ ORC_TOKEN: "", API_URL: "" });
fire("appmessage", { payload: { SubmitLog: logJson } });
const logFail = lastMessage();
check(logFail && logFail["LogResult"] === 0, "10. LogResult 0 without token");

// 11. showConfiguration opens Clay URL
reset();
loadPKJS({ ORC_TOKEN: "x", API_URL: "" });
fire("showConfiguration", {});
check(openedUrls.length === 1 && openedUrls[0].startsWith("data:text/html"), "11. showConfiguration opens config page");

// 12. baked-in token wins over localStorage
reset();
store.set("orcToken", "local-tok");
loadPKJS({ ORC_TOKEN: "baked-tok", API_URL: "" });
fire("appmessage", { payload: { RequestColumns: 1 } });
if (FakeXHR.last) {
  check(FakeXHR.last.headers["Authorization"] === "Bearer baked-tok", "12. baked token wins over localStorage");
}

// ─── Summary ────────────────────────────────────────────────────────
console.log("\n" + g_pass + "/" + (g_pass + g_fail) + " checks passed");
if (g_fail > 0) {
  console.log("FAILED: " + g_fail + " check(s)");
  process.exit(1);
}
console.log("ALL PKJS TESTS PASSED ✅");
process.exit(0);