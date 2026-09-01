/*
 * Standalone unit tests for SleepLogs — exercises the REAL shipping logic
 * in src/c/sleeplogs.h (no copy). Build & run on the host (no Pebble SDK):
 *
 *   gcc -std=c99 -Wall -Wextra -o test_sleeplogs test_sleeplogs.c && ./test_sleeplogs
 *
 * Exits 0 only if every assertion passes.
 */
#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include <stdlib.h>
#include <time.h>

#include "src/c/sleeplogs.h"

static int g_pass = 0, g_fail = 0;

#define CHECK(cond, msg) do { \
  if (cond) { g_pass++; } \
  else { g_fail++; printf("FAIL: %s (line %d)\n", msg, __LINE__); } \
} while (0)

/* Helper: create a struct tm for a specific date/time */
static struct tm make_tm(int year, int mon, int day, int hour, int min) {
  struct tm t;
  memset(&t, 0, sizeof(t));
  t.tm_year = year - 1900;
  t.tm_mon = mon - 1;
  t.tm_mday = day;
  t.tm_hour = hour;
  t.tm_min = min;
  t.tm_sec = 0;
  t.tm_isdst = -1;
  return t;
}

int main(void) {
  char buf[64];

  /* ─── parse_field_type ──────────────────────────────────────── */
  CHECK(parse_field_type("rating") == FIELD_RATING, "parse rating");
  CHECK(parse_field_type("int")    == FIELD_INT,    "parse int");
  CHECK(parse_field_type("bool")   == FIELD_BOOL,   "parse bool");
  CHECK(parse_field_type("text")   == FIELD_TEXT,    "parse text");
  CHECK(parse_field_type("bogus")  == FIELD_UNKNOWN, "parse unknown");
  CHECK(parse_field_type(NULL)     == FIELD_UNKNOWN, "parse null");
  CHECK(parse_field_type("")       == FIELD_UNKNOWN, "parse empty");

  /* ─── is_valid_rating ───────────────────────────────────────── */
  CHECK(!is_valid_rating(0), "rating 0 invalid");
  CHECK(is_valid_rating(1),  "rating 1 valid");
  CHECK(is_valid_rating(3),  "rating 3 valid");
  CHECK(is_valid_rating(5),  "rating 5 valid");
  CHECK(!is_valid_rating(6), "rating 6 invalid");
  CHECK(!is_valid_rating(-1),"rating -1 invalid");

  /* ─── adjust_int_value ──────────────────────────────────────── */
  CHECK(adjust_int_value(3, 1, 0, 10) == 4,  "adjust +1");
  CHECK(adjust_int_value(3, -1, 0, 10) == 2, "adjust -1");
  CHECK(adjust_int_value(0, -1, 0, 10) == 0, "adjust floor clamp");
  CHECK(adjust_int_value(10, 1, 0, 10) == 10,"adjust ceil clamp");
  CHECK(adjust_int_value(5, 10, 0, 10) == 10,"adjust overshoot clamp");
  CHECK(adjust_int_value(5, -20, 0, 10) == 0,"adjust undershoot clamp");
  CHECK(adjust_int_value(400, 100, 0, 5000) == 500, "adjust melatonin +100");
  CHECK(adjust_int_value(400, -100, 0, 5000) == 300, "adjust melatonin -100");

  /* ─── settings defaults + validation ─────────────────────────── */
  SleepSettings s;
  settings_set_defaults(&s);
  CHECK(s.auto_popup == true, "default auto_popup on");
  CHECK(s.popup_hour == 6, "default popup_hour 6");
  CHECK(s.popup_minute == 0, "default popup_minute 0");
  CHECK(s.reminder_interval == 30, "default reminder 30");
  CHECK(settings_is_valid(&s), "defaults valid");

  s.popup_hour = -1;
  CHECK(!settings_is_valid(&s), "hour -1 invalid");
  s.popup_hour = 24;
  CHECK(!settings_is_valid(&s), "hour 24 invalid");
  s.popup_hour = 6;
  s.popup_minute = 60;
  CHECK(!settings_is_valid(&s), "minute 60 invalid");
  s.popup_minute = 0;
  s.reminder_interval = 3;
  CHECK(!settings_is_valid(&s), "interval 3 invalid");
  s.reminder_interval = 121;
  CHECK(!settings_is_valid(&s), "interval 121 invalid");
  s.reminder_interval = 30;
  CHECK(settings_is_valid(&s), "restored valid");

  /* ─── night_of_date ─────────────────────────────────────────── */

  /* 6:00 AM → before noon → last night = yesterday */
  {
    struct tm t = make_tm(2026, 8, 27, 6, 0);
    night_of_date(&t, buf, sizeof buf);
    CHECK(strcmp(buf, "2026-08-26") == 0, "6am -> yesterday (Aug 26)");
  }

  /* 11:59 AM → before noon → yesterday */
  {
    struct tm t = make_tm(2026, 8, 27, 11, 59);
    night_of_date(&t, buf, sizeof buf);
    CHECK(strcmp(buf, "2026-08-26") == 0, "11:59am -> yesterday");
  }

  /* 12:00 PM → noon → today */
  {
    struct tm t = make_tm(2026, 8, 27, 12, 0);
    night_of_date(&t, buf, sizeof buf);
    CHECK(strcmp(buf, "2026-08-27") == 0, "noon -> today");
  }

  /* 10:00 PM → today */
  {
    struct tm t = make_tm(2026, 8, 27, 22, 0);
    night_of_date(&t, buf, sizeof buf);
    CHECK(strcmp(buf, "2026-08-27") == 0, "10pm -> today");
  }

  /* Midnight → before noon → yesterday */
  {
    struct tm t = make_tm(2026, 8, 27, 0, 0);
    night_of_date(&t, buf, sizeof buf);
    CHECK(strcmp(buf, "2026-08-26") == 0, "midnight -> yesterday");
  }

  /* Month rollover: Jan 1, 3:00 AM → Dec 31 of previous year */
  {
    struct tm t = make_tm(2027, 1, 1, 3, 0);
    night_of_date(&t, buf, sizeof buf);
    CHECK(strcmp(buf, "2026-12-31") == 0, "Jan 1 3am -> Dec 31");
  }

  /* Leap year: Mar 1 of a leap year 3am -> Feb 29 (2028 is leap) */
  {
    struct tm t = make_tm(2028, 3, 1, 3, 0);
    night_of_date(&t, buf, sizeof buf);
    CHECK(strcmp(buf, "2028-02-29") == 0, "Mar 1 2028 3am -> Feb 29 (leap)");
  }

  /* Non-leap year: Mar 1, 3am -> Feb 28 */
  {
    struct tm t = make_tm(2026, 3, 1, 3, 0);
    night_of_date(&t, buf, sizeof buf);
    CHECK(strcmp(buf, "2026-02-28") == 0, "Mar 1 2026 3am -> Feb 28");
  }

  /* 1st of month morning -> last day of previous month */
  {
    struct tm t = make_tm(2026, 9, 1, 5, 30);
    night_of_date(&t, buf, sizeof buf);
    CHECK(strcmp(buf, "2026-08-31") == 0, "Sep 1 5:30am -> Aug 31");
  }

  /* Just before noon on a Sunday -> Saturday */
  {
    struct tm t = make_tm(2026, 8, 30, 11, 59);
    night_of_date(&t, buf, sizeof buf);
    CHECK(strcmp(buf, "2026-08-29") == 0, "Aug 30 11:59am -> Aug 29");
  }

  /* ─── next_wakeup_time ──────────────────────────────────────── */
  {
    /* Create a known "now": 2026-08-27 05:00:00 */
    struct tm t = make_tm(2026, 8, 27, 5, 0);
    time_t now = mktime(&t);

    /* Wakeup at 06:00 — should be today */
    time_t wake = next_wakeup_time(now, 6, 0);
    CHECK(wake > now + 30, "wakeup in future");
    struct tm *wt = localtime(&wake);
    CHECK(wt->tm_hour == 6, "wakeup hour 6");
    CHECK(wt->tm_min == 0, "wakeup minute 0");
    CHECK(wt->tm_mday == 27, "wakeup day 27 (today)");
  }

  {
    /* now is 2026-08-27 07:00:00, wakeup at 06:00 → should be TOMORROW */
    struct tm t = make_tm(2026, 8, 27, 7, 0);
    time_t now = mktime(&t);
    time_t wake = next_wakeup_time(now, 6, 0);
    CHECK(wake > now + 30, "wakeup tomorrow in future");
    struct tm *wt = localtime(&wake);
    CHECK(wt->tm_hour == 6, "wakeup tomorrow hour 6");
    CHECK(wt->tm_mday == 28, "wakeup day 28 (tomorrow)");
  }

  {
    /* exactly at the time (06:00:00 now, wake 06:00) → must be tomorrow
     * (within-30s rule) */
    struct tm t = make_tm(2026, 8, 27, 6, 0);
    time_t now = mktime(&t);
    time_t wake = next_wakeup_time(now, 6, 0);
    CHECK(wake > now + 30, "wakeup exactly at time -> future");
    struct tm *wt = localtime(&wake);
    CHECK(wt->tm_mday == 28, "wakeup exactly at time -> tomorrow");
  }

  {
    /* 35s before the target -> today is fine (31s+ min) */
    struct tm t = make_tm(2026, 8, 27, 5, 59); t.tm_sec = 25;
    time_t now = mktime(&t);
    time_t wake = next_wakeup_time(now, 6, 0);
    CHECK(wake - now >= 31, "wakeup 35s before -> same day, >=31s");
  }

  {
    /* month rollover: Aug 31 23:30, wake 05:00 -> Sep 1 */
    struct tm t = make_tm(2026, 8, 31, 23, 30);
    time_t now = mktime(&t);
    time_t wake = next_wakeup_time(now, 5, 0);
    struct tm *wt = localtime(&wake);
    CHECK(wt->tm_mon == 8 && wt->tm_mday == 1, "wakeup rolls into next month");
  }

  /* ─── format_sleep_duration ──────────────────────────────────── */
  format_sleep_duration(23400, buf, sizeof buf);
  CHECK(strcmp(buf, "6h 30m") == 0, "fmt 6h30m");
  format_sleep_duration(0, buf, sizeof buf);
  CHECK(strcmp(buf, "0h 0m") == 0, "fmt 0");
  format_sleep_duration(36500, buf, sizeof buf);
  CHECK(strcmp(buf, "10h 8m") == 0, "fmt 10h8m");
  format_sleep_duration(-100, buf, sizeof buf);
  CHECK(strcmp(buf, "0h 0m") == 0, "fmt negative clamps");
  format_sleep_duration(3600, buf, sizeof buf);
  CHECK(strcmp(buf, "1h 0m") == 0, "fmt 1h exactly");

  /* ─── parse_columns_string ──────────────────────────────────── */
  {
    const char *input =
      "sleep_rating|Sleep Rating|rating||1|5\n"
      "woke_up_times|Wake-ups|int|0|0|20\n"
      "nap|Nap?|bool|0||1\n"
      "notes|Notes|text|||0\n";

    ColumnDef cols[MAX_COLUMNS];
    int count = parse_columns_string(input, cols, MAX_COLUMNS);
    CHECK(count == 4, "parsed 4 columns");

    CHECK(strcmp(cols[0].key, "sleep_rating") == 0, "col0 key");
    CHECK(strcmp(cols[0].label, "Sleep Rating") == 0, "col0 label");
    CHECK(cols[0].field_type == FIELD_RATING, "col0 type rating");
    CHECK(cols[0].has_default == false, "col0 no default");
    CHECK(cols[0].min_value == 1, "col0 min 1");
    CHECK(cols[0].max_value == 5, "col0 max 5");

    CHECK(strcmp(cols[1].key, "woke_up_times") == 0, "col1 key");
    CHECK(cols[1].field_type == FIELD_INT, "col1 type int");
    CHECK(cols[1].has_default == true, "col1 has default");
    CHECK(cols[1].default_value == 0, "col1 default 0");
    CHECK(cols[1].min_value == 0, "col1 min 0");
    CHECK(cols[1].max_value == 20, "col1 max 20");

    CHECK(strcmp(cols[2].key, "nap") == 0, "col2 key");
    CHECK(cols[2].field_type == FIELD_BOOL, "col2 type bool");

    CHECK(strcmp(cols[3].key, "notes") == 0, "col3 key");
    CHECK(cols[3].field_type == FIELD_TEXT, "col3 type text");
  }

  /* Empty/null input */
  {
    ColumnDef cols[4];
    CHECK(parse_columns_string(NULL, cols, 4) == 0, "null input");
    CHECK(parse_columns_string("", cols, 4) == 0, "empty input");
  }

  /* Max columns limit */
  {
    ColumnDef cols[2];
    const char *input =
      "a|A|int|0|0|10\n"
      "b|B|int|0|0|10\n"
      "c|C|int|0|0|10\n";
    int count = parse_columns_string(input, cols, 2);
    CHECK(count == 2, "max_cols caps at 2");
  }

  /* Malformed lines must not crash; parse stops at first broken line */
  {
    ColumnDef cols[4];
    const char *input = "good|Good|int|0|0|10\nbrokenline_with_no_pipes\n";
    int count = parse_columns_string(input, cols, 4);
    CHECK(count == 1, "stops at malformed line");
    CHECK(strcmp(cols[0].key, "good") == 0, "first good col kept");
  }

  /* Unknown field type → FIELD_UNKNOWN, not crash */
  {
    ColumnDef cols[2];
    const char *input = "weird|Weird|banana|0|0|10\n";
    int count = parse_columns_string(input, cols, 2);
    CHECK(count == 1, "parsed unknown type line");
    CHECK(cols[0].field_type == FIELD_UNKNOWN, "unknown -> FIELD_UNKNOWN");
  }

  /* Over-long label truncated safely */
  {
    ColumnDef cols[2];
    char input[300];
    char long_label[80];
    memset(long_label, 'x', sizeof(long_label) - 1);
    long_label[sizeof(long_label) - 1] = '\0';
    snprintf(input, sizeof(input), "k|%s|int|0|0|10", long_label);
    int count = parse_columns_string(input, cols, 2);
    CHECK(count == 1, "parsed long label");
    CHECK(strlen(cols[0].label) < MAX_LABEL_LEN, "label truncated to fit");
    CHECK(strcmp(cols[0].key, "k") == 0, "key intact with long label");
  }

  /* Missing fields: line with only key|label (no type etc.) stops safely */
  {
    ColumnDef cols[2];
    const char *input = "abc|Label only\n";
    int count = parse_columns_string(input, cols, 2);
    CHECK(count == 0, "incomplete line -> 0 cols, no crash");
  }

  /* ─── init_answer ───────────────────────────────────────────── */
  {
    ColumnDef c;
    memset(&c, 0, sizeof c);
    strcpy(c.key, "sleep_rating");
    c.field_type = FIELD_RATING;
    c.has_default = false;
    c.min_value = 1;
    c.max_value = 5;

    Answer a;
    init_answer(&a, &c);
    CHECK(a.int_value == 3, "rating default middle");
    CHECK(a.answered == false, "not answered initially");
  }
  {
    ColumnDef c;
    memset(&c, 0, sizeof c);
    strcpy(c.key, "melatonin");
    c.field_type = FIELD_INT;
    c.has_default = true;
    c.default_value = 400;
    c.min_value = 0;
    c.max_value = 5000;

    Answer a;
    init_answer(&a, &c);
    CHECK(a.int_value == 400, "int with default 400");
  }
  {
    ColumnDef c;
    memset(&c, 0, sizeof c);
    strcpy(c.key, "nap");
    c.field_type = FIELD_BOOL;
    c.has_default = true;
    c.default_value = 0;

    Answer a;
    init_answer(&a, &c);
    CHECK(a.bool_value == false, "bool default false");
  }

  /* ─── Message key constants match package.json ordering ──────── */
  CHECK(MK_REQUEST_COLUMNS   == 10000, "MK RequestColumns");
  CHECK(MK_COLUMNS_DATA      == 10001, "MK ColumnsData");
  CHECK(MK_COLUMNS_FAILED    == 10002, "MK ColumnsFailed");
  CHECK(MK_SUBMIT_LOG        == 10003, "MK SubmitLog");
  CHECK(MK_LOG_RESULT        == 10004, "MK LogResult");
  CHECK(MK_AUTO_POPUP        == 10005, "MK AutoPopup");
  CHECK(MK_POPUP_HOUR        == 10006, "MK PopupHour");
  CHECK(MK_POPUP_MINUTE      == 10007, "MK PopupMinute");
  CHECK(MK_REMINDER_INTERVAL == 10008, "MK ReminderInterval");
  CHECK(MK_API_URL           == 10009, "MK ApiUrl");
  CHECK(MK_ORC_TOKEN         == 10010, "MK OrcToken");

  /* ─── build_log_json ──────────────────────────────────────── */
  {
    ColumnDef cols[3];
    Answer   ans[3];
    memset(cols, 0, sizeof(cols));
    memset(ans, 0, sizeof(ans));
    strcpy(cols[0].key, "sleep_rating"); cols[0].field_type = FIELD_RATING;
    strcpy(cols[1].key, "woke_up_times"); cols[1].field_type = FIELD_INT;
    strcpy(cols[2].key, "nap"); cols[2].field_type = FIELD_BOOL;

    char json[512];
    char m[256];

    /* none answered → empty data object */
    int n = build_log_json(cols, ans, 3, "2026-09-01", json, sizeof(json));
    snprintf(m, sizeof(m), "none answered → empty data (got %s)", json);
    CHECK(strcmp(json, "{\"night_of\":\"2026-09-01\",\"data\":{}}") == 0, m);
    CHECK(n > 0, "build_log_json: nonzero length");

    /* only answered fields included */
    ans[1].answered = true; ans[1].int_value = 3;
    n = build_log_json(cols, ans, 3, "2026-09-01", json, sizeof(json));
    snprintf(m, sizeof(m), "only answered fields (got %s)", json);
    CHECK(strcmp(json, "{\"night_of\":\"2026-09-01\",\"data\":{\"woke_up_times\":3}}") == 0, m);

    /* all three: int + bool + rating order */
    ans[0].answered = true; ans[0].int_value = 5;
    ans[2].answered = true; ans[2].bool_value = true;
    n = build_log_json(cols, ans, 3, "2026-09-01", json, sizeof(json));
    snprintf(m, sizeof(m), "mixed fields (got %s)", json);
    CHECK(strcmp(json,
      "{\"night_of\":\"2026-09-01\",\"data\":{\"sleep_rating\":5,\"woke_up_times\":3,\"nap\":true}}") == 0, m);

    /* text escaping */
    ColumnDef tcol; memset(&tcol, 0, sizeof(tcol));
    Answer   tans;  memset(&tans, 0, sizeof(tans));
    strcpy(tcol.key, "notes"); tcol.field_type = FIELD_TEXT;
    tans.answered = true;
    strcpy(tans.text_value, "He said \"hi\" then \\ ok");
    n = build_log_json(&tcol, &tans, 1, "2026-09-01", json, sizeof(json));
    snprintf(m, sizeof(m), "text escaping (got %s)", json);
    CHECK(strcmp(json,
      "{\"night_of\":\"2026-09-01\",\"data\":{\"notes\":\"He said \\\"hi\\\" then \\\\ ok\"}}") == 0, m);

    /* null night_of tolerated */
    n = build_log_json(cols, ans, 3, NULL, json, sizeof(json));
    CHECK(strstr(json, "\"night_of\":\"\"") != NULL, "build_log_json: null night_of");
  }

  /* ─── default values ────────────────────────────────────────── */
  {
    ColumnDef c; memset(&c, 0, sizeof(c));
    Answer a;

    /* int default */
    c.field_type = FIELD_INT; c.min_value = 0; c.max_value = 5000;
    c.has_default = true; c.default_value = 400;
    init_answer(&a, &c);
    CHECK(a.int_value == 400 && !a.answered, "default: int 400");

    /* bool "true" default (string form from API) */
    c.field_type = FIELD_BOOL; c.default_value = 1; c.has_default = true;
    init_answer(&a, &c);
    CHECK(a.bool_value == true, "default: bool true");

    /* bool "false" */
    c.default_value = 0;
    init_answer(&a, &c);
    CHECK(a.bool_value == false, "default: bool false");

    /* text default copied into text_value */
    c.field_type = FIELD_TEXT;
    strcpy(c.default_value_str, "slept poorly");
    c.has_default = true;
    init_answer(&a, &c);
    CHECK(strcmp(a.text_value, "slept poorly") == 0, "default: text value");
    CHECK(a.int_value == 0, "default: text leaves int at 0");

    /* no default: rating = middle, int = min, bool = false, text = empty */
    c.has_default = false;
    c.field_type = FIELD_RATING; c.min_value = 1; c.max_value = 5;
    init_answer(&a, &c);
    CHECK(a.int_value == 3, "default: rating middle 3");
    c.field_type = FIELD_INT; c.min_value = 0;
    init_answer(&a, &c);
    CHECK(a.int_value == 0, "default: int min");
    c.field_type = FIELD_BOOL;
    init_answer(&a, &c);
    CHECK(a.bool_value == false, "default: bool false");
    c.field_type = FIELD_TEXT;
    init_answer(&a, &c);
    CHECK(a.text_value[0] == '\0', "default: text empty");

    /* parse_columns_string: bool defaults with string names */
    ColumnDef parsed[2];
    int ncol = parse_columns_string("nap|Nap?|bool|true|0|1\nmel|Mel|int|400|0|5000", parsed, 2);
    CHECK(ncol == 2, "default: parse 2 cols");
    CHECK(parsed[0].field_type == FIELD_BOOL && parsed[0].default_value == 1 && parsed[0].has_default,
          "default: parse bool true");
    CHECK(parsed[1].field_type == FIELD_INT && parsed[1].default_value == 400 && parsed[1].has_default,
          "default: parse int 400");
    strcpy(parsed[1].default_value_str, "400");
    CHECK(strcmp(parsed[1].default_value_str, "400") == 0, "default: raw string kept");
  }

  /* ─── Summary ───────────────────────────────────────────────── */
  int total = g_pass + g_fail;
  printf("\n%d/%d tests passed\n", g_pass, total);
  if (g_fail == 0) printf("ALL TESTS PASSED ✅\n");
  else printf("%d TEST(S) FAILED ❌\n", g_fail);
  return g_fail == 0 ? 0 : 1;
}
