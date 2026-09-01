#ifndef SLEEPLOGS_H
#define SLEEPLOGS_H

/*
 * Shared, platform-independent sleep-log logic for SleepLogs.
 *
 * This header is deliberately free of Pebble SDK types so it can be
 * unit-tested on a host machine (gcc) WITHOUT pebble.h.
 *
 * Build standalone test:
 *   gcc -std=c99 -Wall -Wextra -o test_sleeplogs test_sleeplogs.c && ./test_sleeplogs
 */

#include <stdbool.h>
#include <stdint.h>
#include <time.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

/* ─── Persist keys ─────────────────────────────────────────────────────── */
#define PERSIST_SETTINGS_KEY     1
#define PERSIST_VERSION_KEY      2
#define PERSIST_WAKEUP_ID_KEY    3
#define PERSIST_SETTINGS_VERSION 1

/* ─── Message keys (10000 + index in package.json messageKeys) ─────────── */
#define MK_REQUEST_COLUMNS   10000
#define MK_COLUMNS_DATA      10001
#define MK_COLUMNS_FAILED    10002
#define MK_SUBMIT_LOG        10003
#define MK_LOG_RESULT        10004
#define MK_AUTO_POPUP        10005
#define MK_POPUP_HOUR        10006
#define MK_POPUP_MINUTE      10007
#define MK_REMINDER_INTERVAL 10008
#define MK_API_URL           10009
#define MK_ORC_TOKEN         10010

/* ─── Tuple type ids (mirror Pebble TUPLE_INT / TUPLE_CSTRING) ──────────── */
#define SL_TUPLE_INT     0
#define SL_TUPLE_CSTRING 1

/* ─── Limits ───────────────────────────────────────────────────────────── */
#define MAX_COLUMNS       16
#define MAX_LABEL_LEN     32
#define MAX_KEY_LEN       32
#define MAX_ANSWER_LEN    256
#ifndef SECONDS_PER_DAY
#define SECONDS_PER_DAY   86400  /* pebble.h already defines this on-device */
#endif

/* ─── Field types ──────────────────────────────────────────────────────── */
typedef enum {
  FIELD_RATING = 0,  /* 1-5 stars */
  FIELD_INT    = 1,
  FIELD_BOOL   = 2,
  FIELD_TEXT   = 3,
  FIELD_UNKNOWN = 99
} FieldType;

/* ─── Column definition (parsed from API response) ─────────────────────── */
#define MAX_DEFAULT_LEN 64
typedef struct {
  char key[MAX_KEY_LEN];
  char label[MAX_LABEL_LEN];
  FieldType field_type;
  int  default_value;        /* for int/rating/bool; parsed numeric */
  char default_value_str[MAX_DEFAULT_LEN];  /* raw string (text/bool) */
  int  min_value;
  int  max_value;
  bool has_default;
} ColumnDef;

/* ─── Answer for a single column ──────────────────────────────────────── */
typedef struct {
  int  int_value;
  bool bool_value;
  char text_value[MAX_ANSWER_LEN];
  bool answered;
} Answer;

/* ─── App settings (persisted on watch) ────────────────────────────────── */
typedef struct {
  bool auto_popup;
  int  popup_hour;       /* 0-23 */
  int  popup_minute;     /* 0-59 */
  int  reminder_interval; /* minutes, e.g. 30 */
} SleepSettings;

/* ─── Parse field type string ─────────────────────────────────────────── */
static inline FieldType parse_field_type(const char *s) {
  if (!s) return FIELD_UNKNOWN;
  if (strcmp(s, "rating") == 0) return FIELD_RATING;
  if (strcmp(s, "int")    == 0) return FIELD_INT;
  if (strcmp(s, "bool")   == 0) return FIELD_BOOL;
  if (strcmp(s, "text")   == 0) return FIELD_TEXT;
  return FIELD_UNKNOWN;
}

/* ─── Validation ───────────────────────────────────────────────────────── */
static inline bool is_valid_rating(int v) { return v >= 1 && v <= 5; }

static inline int adjust_int_value(int current, int delta, int min_val, int max_val) {
  int v = current + delta;
  if (v < min_val) v = min_val;
  if (v > max_val) v = max_val;
  return v;
}

/* ─── Settings defaults + validation ──────────────────────────────────── */
static inline void settings_set_defaults(SleepSettings *s) {
  s->auto_popup = true;
  s->popup_hour = 6;
  s->popup_minute = 0;
  s->reminder_interval = 30;
}

static inline bool settings_is_valid(const SleepSettings *s) {
  return s->popup_hour >= 0 && s->popup_hour <= 23 &&
         s->popup_minute >= 0 && s->popup_minute <= 59 &&
         s->reminder_interval >= 5 && s->reminder_interval <= 120;
}

/* ─── Night-of date derivation ─────────────────────────────────────────
 * If current time is before noon, the "night of" is yesterday.
 * If noon or later, "night of" is today.
 * Writes "YYYY-MM-DD" into buf.
 */
static inline void night_of_date(const struct tm *now, char *buf, int bufsize) {
  struct tm adjusted = *now;
  if (adjusted.tm_hour < 12) {
    /* Before noon — this is "last night", so subtract one day.
     * Use mktime to handle month/year rollovers. */
    adjusted.tm_mday -= 1;
    time_t t = mktime(&adjusted);
    struct tm *fixed = localtime(&t);
    if (fixed) {
      snprintf(buf, bufsize, "%04d-%02d-%02d",
               fixed->tm_year + 1900, fixed->tm_mon + 1, fixed->tm_mday);
      return;
    }
  }
  snprintf(buf, bufsize, "%04d-%02d-%02d",
           adjusted.tm_year + 1900, adjusted.tm_mon + 1, adjusted.tm_mday);
}

/* ─── Next wakeup time calculation ─────────────────────────────────────
 * Returns the next occurrence of HH:MM that is at least 31 seconds
 * in the future (Pebble wakeup minimum is 30s). If today's HH:MM has
 * already passed (or is too close), returns tomorrow's.
 */
static inline time_t next_wakeup_time(time_t now, int hour, int minute) {
  struct tm *lt = localtime(&now);
  if (!lt) return now + 60;

  struct tm target = *lt;
  target.tm_hour = hour;
  target.tm_min = minute;
  target.tm_sec = 0;
  time_t t = mktime(&target);

  /* Must be at least 31s in the future */
  if (t <= now + 30) {
    /* Try tomorrow */
    target.tm_mday += 1;
    t = mktime(&target);
  }
  return t;
}

/* ─── Format sleep duration from seconds ──────────────────────────────── */
static inline void format_sleep_duration(int total_seconds, char *buf, int bufsize) {
  if (total_seconds < 0) total_seconds = 0;
  int hours = total_seconds / 3600;
  int minutes = (total_seconds % 3600) / 60;
  snprintf(buf, bufsize, "%dh %dm", hours, minutes);
}

/* ─── Parse pipe-delimited columns string ──────────────────────────────
 * Format: "key|label|type|default|min|max\nkey|label|type|default|min|max\n..."
 * Returns the number of columns parsed (up to max_cols).
 */
static inline int parse_columns_string(const char *input, ColumnDef *cols, int max_cols) {
  if (!input || !cols) return 0;

  int count = 0;
  const char *line = input;

  while (*line && count < max_cols) {
    ColumnDef *c = &cols[count];
    memset(c, 0, sizeof(ColumnDef));
    c->default_value = 0;
    c->has_default = false;
    c->min_value = 0;
    c->max_value = 100;

    /* Parse: key|label|type|default|min|max */
    const char *end = strchr(line, '\n');
    if (!end) end = line + strlen(line);

    /* Field 1: key */
    const char *sep = strchr(line, '|');
    if (!sep || sep >= end) break;
    int len = (int)(sep - line);
    if (len >= MAX_KEY_LEN) len = MAX_KEY_LEN - 1;
    strncpy(c->key, line, len);
    c->key[len] = '\0';

    /* Field 2: label */
    const char *field = sep + 1;
    sep = strchr(field, '|');
    if (!sep || sep >= end) break;
    len = (int)(sep - field);
    if (len >= MAX_LABEL_LEN) len = MAX_LABEL_LEN - 1;
    strncpy(c->label, field, len);
    c->label[len] = '\0';

    /* Field 3: type */
    field = sep + 1;
    sep = strchr(field, '|');
    if (!sep || sep >= end) break;
    char type_buf[20];
    len = (int)(sep - field);
    if (len >= (int)sizeof(type_buf)) len = (int)sizeof(type_buf) - 1;
    strncpy(type_buf, field, len);
    type_buf[len] = '\0';
    c->field_type = parse_field_type(type_buf);

    /* Field 4: default */
    field = sep + 1;
    sep = strchr(field, '|');
    if (!sep || sep >= end) break;
    if (sep > field) {
      char def_buf[MAX_DEFAULT_LEN];
      len = (int)(sep - field);
      if (len >= (int)sizeof(def_buf)) len = (int)sizeof(def_buf) - 1;
      strncpy(def_buf, field, len);
      def_buf[len] = '\0';
      if (def_buf[0] != '\0') {
        /* Keep the raw string (text defaults need it). */
        strncpy(c->default_value_str, def_buf, MAX_DEFAULT_LEN - 1);
        c->default_value_str[MAX_DEFAULT_LEN - 1] = '\0';
        /* Numeric for int/rating. Bool parses "true"/"false"/1/0. */
        if (c->field_type == FIELD_BOOL) {
          c->default_value = (strcmp(def_buf, "true") == 0 || strcmp(def_buf, "1") == 0) ? 1 : 0;
        } else {
          c->default_value = atoi(def_buf);
        }
        c->has_default = true;
      }
    }

    /* Field 5: min */
    field = sep + 1;
    sep = strchr(field, '|');
    if (!sep || sep >= end) break;
    {
      char min_buf[16];
      len = (int)(sep - field);
      if (len >= (int)sizeof(min_buf)) len = (int)sizeof(min_buf) - 1;
      strncpy(min_buf, field, len);
      min_buf[len] = '\0';
      if (min_buf[0] != '\0') c->min_value = atoi(min_buf);
    }

    /* Field 6: max (rest of line) */
    field = sep + 1;
    len = (int)(end - field);
    {
      char max_buf[16];
      if (len >= (int)sizeof(max_buf)) len = (int)sizeof(max_buf) - 1;
      strncpy(max_buf, field, len);
      max_buf[len] = '\0';
      if (max_buf[0] != '\0') c->max_value = atoi(max_buf);
    }

    count++;
    line = (*end == '\n') ? end + 1 : end;
  }

  return count;
}

/* ─── Initialize answer from column definition ───────────────────────── */
static inline void init_answer(Answer *a, const ColumnDef *c) {
  memset(a, 0, sizeof(Answer));
  a->answered = false;
  a->text_value[0] = '\0';
  if (c->has_default) {
    switch (c->field_type) {
      case FIELD_BOOL:
        a->bool_value = (c->default_value != 0);
        break;
      case FIELD_TEXT:
        strncpy(a->text_value, c->default_value_str, MAX_ANSWER_LEN - 1);
        a->text_value[MAX_ANSWER_LEN - 1] = '\0';
        break;
      default: /* rating, int */
        a->int_value = c->default_value;
        break;
    }
  } else {
    if (c->field_type == FIELD_RATING) {
      a->int_value = 3; /* middle of 1-5 */
    } else if (c->field_type == FIELD_INT) {
      a->int_value = c->min_value;
    } else if (c->field_type == FIELD_BOOL) {
      a->bool_value = false;
    }
    /* text: nothing (empty) */
  }
}

/* ─── Build the submit JSON payload ──────────────────────────────
 * {"night_of":"YYYY-MM-DD","data":{"key":value,...}}
 * Only columns with answered=true are included, so finishing early never
 * writes default values for skipped questions. Text values are escaped.
 * Returns number of bytes written.
 */
static inline int build_log_json(const ColumnDef *cols, const Answer *answers,
                                 int num, const char *night_of,
                                 char *buf, int bufsize) {
  if (!buf || bufsize <= 0) return 0;
  int pos = 0;
  int len = snprintf(buf, bufsize, "{\"night_of\":\"%s\",\"data\":{", night_of ? night_of : "");
  if (len < 0) return 0;
  pos = (len >= bufsize) ? (bufsize - 1) : len;

  bool any = false;
  for (int i = 0; i < num && pos < bufsize - 8; i++) {
    if (!answers[i].answered) continue;
    if (any) buf[pos++] = ',';
    any = true;

    const ColumnDef *c = &cols[i];
    const Answer *a = &answers[i];
    int w = 0;
    switch (c->field_type) {
      case FIELD_RATING:
      case FIELD_INT:
        w = snprintf(buf + pos, bufsize - pos, "\"%s\":%d", c->key, a->int_value);
        break;
      case FIELD_BOOL:
        w = snprintf(buf + pos, bufsize - pos, "\"%s\":%s", c->key, a->bool_value ? "true" : "false");
        break;
      case FIELD_TEXT: {
        w = snprintf(buf + pos, bufsize - pos, "\"%s\":\"", c->key);
        pos += (w >= 0) ? (w > bufsize - pos ? bufsize - pos : w) : 0;
        for (const char *p = a->text_value; *p && pos < bufsize - 2; p++) {
          if (*p == '"' || *p == '\\') buf[pos++] = '\\';
          buf[pos++] = *p;
        }
        if (pos < bufsize - 1) buf[pos++] = '"';
        continue;   /* pos already updated in the loop */
      }
      default:
        break;
    }
    if (w < 0) return pos;
    pos += (w > (bufsize - pos)) ? (bufsize - pos) : w;
  }

  if (pos < bufsize - 1) {
    int tail = snprintf(buf + pos, bufsize - pos, "}}");
    if (tail < 0) return pos;
    pos += (tail > (bufsize - pos)) ? (bufsize - pos) : tail;
  } else if (bufsize > 0) {
    buf[bufsize - 1] = '\0';
  }
  return pos;
}

#endif /* SLEEPLOGS_H */
