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

// 13. Submit HTTP error (500) -> LogResult 0
reset();
loadPKJS({ ORC_TOKEN: "tok-x", API_URL: "" });
FakeXHR.onSend = (x) => { x.status = 500; x.responseText = ""; };
fire("appmessage", { payload: { SubmitLog: logJson } });
check(FakeXHR.last && FakeXHR.last.url.includes("/api/write_log"), "13. submit hit write_log");
const logErr = lastMessage();
check(logErr && logErr["LogResult"] === 0, "13. LogResult 0 on HTTP 500");

// 14. Columns API returns empty array -> ColumnsFailed code 3
reset();
loadPKJS({ ORC_TOKEN: "tok-empt", API_URL: "" });
FakeXHR.onSend = (x) => { x.status = 200; x.responseText = JSON.stringify({ columns: [] }); };
fire("appmessage", { payload: { RequestColumns: 1 } });
const emptyFail = lastMessage();
check(emptyFail && emptyFail["ColumnsFailed"] === 3, "14. empty columns -> ColumnsFailed 3");

// 15. webviewclosed with only ApiUrl (no token) -> token untouched
reset();
loadPKJS({ ORC_TOKEN: "", API_URL: "" });
fire("webviewclosed", { response: JSON.stringify({ ApiUrl: { value: "https://example.com" } }) });
check(store.get("apiUrl") === "https://example.com", "15. apiUrl saved");
check(store.get("orcToken") === undefined || store.get("orcToken") === null, "15. no token stored");

// 16. Columns with a default value are passed through raw
reset();
loadPKJS({ ORC_TOKEN: "tok-def", API_URL: "" });
FakeXHR.onSend = (x) => {
  x.status = 200;
  x.responseText = JSON.stringify({ columns: [
    { key: "melatonin_mcg", label: "Melatonin (mcg)", field_type: "int", default_value: "400", min_value: 0, max_value: 5000 },
    { key: "nap", label: "Nap?", field_type: "bool", default_value: "true", min_value: null, max_value: null },
  ] });
};
fire("appmessage", { payload: { RequestColumns: 1 } });
const cMsg = lastMessage();
if (cMsg && cMsg["ColumnsData"]) {
  check(cMsg["ColumnsData"].includes("400"), "16. int default passed through");
  check(cMsg["ColumnsData"].includes("|true|"), "16. bool default passed through");
}

// 17. localStorage token used when no baked secret
reset();
store.set("orcToken", "local-tok-2");
loadPKJS({ ORC_TOKEN: "", API_URL: "" });
fire("appmessage", { payload: { RequestColumns: 1 } });
if (FakeXHR.last) {
  check(FakeXHR.last.headers["Authorization"] === "Bearer local-tok-2", "17. localStorage token used");
}

// 18. clay-settings fallback token (no orcToken key, but clay-settings has it)
reset();
store.set("clay-settings", JSON.stringify({ OrcToken: "clay-tok-3" }));
loadPKJS({ ORC_TOKEN: "", API_URL: "" });
fire("appmessage", { payload: { RequestColumns: 1 } });
if (FakeXHR.last) {
  check(FakeXHR.last.headers["Authorization"] === "Bearer clay-tok-3", "18. clay-settings fallback token used");
}

// 19. CheckSubmitted: server says the night exists -> SubmittedStatus 1
reset();
loadPKJS({ ORC_TOKEN: "tok-check", API_URL: "" });
FakeXHR.onSend = (x) => {
  x.status = 200;
  x.responseText = JSON.stringify({ logs: [{ id: 1, night_of: "2026-09-02" }] });
};
fire("appmessage", { payload: { CheckSubmitted: "2026-09-02" } });
check(FakeXHR.last && FakeXHR.last.url.includes("/api/logs?night_of=2026-09-02"), "19. check URL has night_of filter");
const c1 = lastMessage();
check(c1 && c1["SubmittedStatus"] === 1, "19. exists -> SubmittedStatus 1");

// 20. CheckSubmitted: server says empty -> SubmittedStatus 0
reset();
loadPKJS({ ORC_TOKEN: "tok-check", API_URL: "" });
FakeXHR.onSend = (x) => { x.status = 200; x.responseText = JSON.stringify({ logs: [] }); };
fire("appmessage", { payload: { CheckSubmitted: "2026-09-03" } });
const c2 = lastMessage();
check(c2 && c2["SubmittedStatus"] === 0, "20. empty -> SubmittedStatus 0");

// 21. CheckSubmitted: HTTP error -> SubmittedStatus 2 (fall back to prompting)
reset();
loadPKJS({ ORC_TOKEN: "tok-check", API_URL: "" });
FakeXHR.onSend = (x) => { x.status = 500; x.responseText = ""; };
fire("appmessage", { payload: { CheckSubmitted: "2026-09-02" } });
const c3 = lastMessage();
check(c3 && c3["SubmittedStatus"] === 2, "21. HTTP error -> SubmittedStatus 2");

// 22. CheckSubmitted: no token -> 2
reset();
loadPKJS({ ORC_TOKEN: "", API_URL: "" });
fire("appmessage", { payload: { CheckSubmitted: "2026-09-02" } });
const c4 = lastMessage();
check(c4 && c4["SubmittedStatus"] === 2, "22. no token -> SubmittedStatus 2");

// ─── Summary ────────────────────────────────────────────────────────
console.log("\n" + g_pass + "/" + (g_pass + g_fail) + " checks passed");
if (g_fail > 0) {
  console.log("FAILED: " + g_fail + " check(s)");
  process.exit(1);
}
console.log("ALL PKJS TESTS PASSED ✅");
process.exit(0);