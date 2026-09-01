#include <pebble.h>
#include "sleeplogs.h"

/* ─── State ───────────────────────────────────────────────────── */
static SleepSettings s_settings;
static ColumnDef s_columns[MAX_COLUMNS];
static Answer   s_answers[MAX_COLUMNS];
static int s_num_columns = 0;
static int s_current_question = 0;
static bool s_submitted = false;
static bool s_columns_loaded = false;

/* ─── UI ──────────────────────────────────────────────────────── */
static Window *s_main_window;
static TextLayer *s_title_layer;
static TextLayer *s_value_layer;
static TextLayer *s_hint_layer;
static TextLayer *s_progress_layer;
static TextLayer *s_status_layer;

/* ─── Dictation ───────────────────────────────────────────────── */
#if defined(PBL_MICROPHONE)
static DictationSession *s_dictation_session;
static char s_dictation_buf[MAX_ANSWER_LEN];
#endif

/* ─── Persist ─────────────────────────────────────────────────── */
static void prv_load_settings(void) {
  settings_set_defaults(&s_settings);
  if (persist_exists(PERSIST_SETTINGS_KEY)) {
    int read = persist_read_data(PERSIST_SETTINGS_KEY, &s_settings, sizeof(s_settings));
    if (read != (int)sizeof(s_settings) || !settings_is_valid(&s_settings)) {
      settings_set_defaults(&s_settings);
    }
  }
}

static void prv_save_settings(void) {
  persist_write_data(PERSIST_SETTINGS_KEY, &s_settings, sizeof(s_settings));
}

/* ─── Wakeup scheduling ──────────────────────────────────────── */
static void schedule_daily_wakeup(void) {
  if (!s_settings.auto_popup) return;
  wakeup_cancel_all();
  time_t wake = next_wakeup_time(time(NULL), s_settings.popup_hour, s_settings.popup_minute);
  WakeupId id = wakeup_schedule(wake, 0, true);
  if (id >= 0) {
    persist_write_int(PERSIST_WAKEUP_ID_KEY, id);
  }
}

static void schedule_reminder(void) {
  time_t wake = time(NULL) + (s_settings.reminder_interval * 60);
  int32_t cookie = 1; /* reminder, not daily */
  wakeup_schedule(wake, cookie, false);
}

/* ─── Display ─────────────────────────────────────────────────── */
static void update_display(void) {
  if (!s_columns_loaded || s_num_columns == 0) return;

  static char title_buf[48];
  static char value_buf[64];
  static char progress_buf[16];
  static char hint_buf[64];

  if (s_current_question >= s_num_columns) {
    /* Submit screen */
    text_layer_set_text(s_title_layer, "Submit Log?");
    text_layer_set_text(s_value_layer, "SELECT = Submit");
    text_layer_set_text(s_hint_layer, "BACK = edit");
    snprintf(progress_buf, sizeof(progress_buf), "Done");
    text_layer_set_text(s_progress_layer, progress_buf);
    return;
  }

  ColumnDef *col = &s_columns[s_current_question];
  Answer *ans = &s_answers[s_current_question];

  snprintf(title_buf, sizeof(title_buf), "%s", col->label);
  text_layer_set_text(s_title_layer, title_buf);

  switch (col->field_type) {
    case FIELD_RATING:
      snprintf(value_buf, sizeof(value_buf), "%d / 5", ans->int_value);
      snprintf(hint_buf, sizeof(hint_buf), "UP/DOWN, SELECT next");
      break;
    case FIELD_INT:
      snprintf(value_buf, sizeof(value_buf), "%d", ans->int_value);
      snprintf(hint_buf, sizeof(hint_buf), "UP/DOWN (%d-%d)", col->min_value, col->max_value);
      break;
    case FIELD_BOOL:
      snprintf(value_buf, sizeof(value_buf), "%s", ans->bool_value ? "Yes" : "No");
      snprintf(hint_buf, sizeof(hint_buf), "UP/DOWN toggle");
      break;
    case FIELD_TEXT:
      if (ans->text_value[0]) {
        snprintf(value_buf, sizeof(value_buf), "%.30s...", ans->text_value);
      } else {
        snprintf(value_buf, sizeof(value_buf), "(empty)");
      }
      snprintf(hint_buf, sizeof(hint_buf), "SELECT = dictate");
      break;
    default:
      snprintf(value_buf, sizeof(value_buf), "?");
      hint_buf[0] = '\0';
      break;
  }

  text_layer_set_text(s_value_layer, value_buf);
  text_layer_set_text(s_hint_layer, hint_buf);

  snprintf(progress_buf, sizeof(progress_buf), "%d/%d",
           s_current_question + 1, s_num_columns);
  text_layer_set_text(s_progress_layer, progress_buf);
}

/* ─── Build and send log JSON ─────────────────────────────────── */
static void submit_log(void) {
  /* Build a compact JSON payload for PKJS to POST */
  static char json[2048];
  char night[16];
  time_t now = time(NULL);
  struct tm *lt = localtime(&now);
  night_of_date(lt, night, sizeof(night));

  int pos = snprintf(json, sizeof(json), "{\"night_of\":\"%s\",\"data\":{", night);

  for (int i = 0; i < s_num_columns && pos < (int)sizeof(json) - 64; i++) {
    if (i > 0) pos += snprintf(json + pos, sizeof(json) - pos, ",");

    ColumnDef *c = &s_columns[i];
    Answer *a = &s_answers[i];

    switch (c->field_type) {
      case FIELD_RATING:
      case FIELD_INT:
        pos += snprintf(json + pos, sizeof(json) - pos,
                        "\"%s\":%d", c->key, a->int_value);
        break;
      case FIELD_BOOL:
        pos += snprintf(json + pos, sizeof(json) - pos,
                        "\"%s\":%s", c->key, a->bool_value ? "true" : "false");
        break;
      case FIELD_TEXT:
        /* Escape quotes in text for valid JSON */
        pos += snprintf(json + pos, sizeof(json) - pos, "\"%s\":\"", c->key);
        for (const char *p = a->text_value; *p && pos < (int)sizeof(json) - 4; p++) {
          if (*p == '"' || *p == '\\') {
            json[pos++] = '\\';
          }
          json[pos++] = *p;
        }
        pos += snprintf(json + pos, sizeof(json) - pos, "\"");
        break;
      default:
        break;
    }
  }
  snprintf(json + pos, sizeof(json) - pos, "}}");

  /* Send via AppMessage */
  DictionaryIterator *iter;
  AppMessageResult result = app_message_outbox_begin(&iter);
  if (result == APP_MSG_OK) {
    dict_write_cstring(iter, MESSAGE_KEY_SubmitLog, json);
    app_message_outbox_send();
  }

  s_submitted = true;
  text_layer_set_text(s_status_layer, "Submitting...");
}

/* ─── Dictation callback ──────────────────────────────────────── */
#if defined(PBL_MICROPHONE)
static void dictation_callback(DictationSession *session, DictationSessionStatus status,
                                char *transcription, void *context) {
  (void)session; (void)context;
  if (status == DictationSessionStatusSuccess && s_current_question < s_num_columns) {
    Answer *ans = &s_answers[s_current_question];
    strncpy(ans->text_value, transcription, MAX_ANSWER_LEN - 1);
    ans->text_value[MAX_ANSWER_LEN - 1] = '\0';
    ans->answered = true;
    update_display();
  }
}
#endif

/* ─── Button handlers ─────────────────────────────────────────── */
static void up_handler(ClickRecognizerRef r, void *ctx) {
  (void)r; (void)ctx;
  if (s_current_question >= s_num_columns) return;

  ColumnDef *col = &s_columns[s_current_question];
  Answer *ans = &s_answers[s_current_question];

  switch (col->field_type) {
    case FIELD_RATING:
      ans->int_value = adjust_int_value(ans->int_value, 1, col->min_value, col->max_value);
      break;
    case FIELD_INT: {
      int step = (col->max_value > 100) ? 50 : 1;
      ans->int_value = adjust_int_value(ans->int_value, step, col->min_value, col->max_value);
      break;
    }
    case FIELD_BOOL:
      ans->bool_value = !ans->bool_value;
      break;
    default:
      break;
  }
  update_display();
}

static void down_handler(ClickRecognizerRef r, void *ctx) {
  (void)r; (void)ctx;
  if (s_current_question >= s_num_columns) return;

  ColumnDef *col = &s_columns[s_current_question];
  Answer *ans = &s_answers[s_current_question];

  switch (col->field_type) {
    case FIELD_RATING:
      ans->int_value = adjust_int_value(ans->int_value, -1, col->min_value, col->max_value);
      break;
    case FIELD_INT: {
      int step = (col->max_value > 100) ? 50 : 1;
      ans->int_value = adjust_int_value(ans->int_value, -step, col->min_value, col->max_value);
      break;
    }
    case FIELD_BOOL:
      ans->bool_value = !ans->bool_value;
      break;
    default:
      break;
  }
  update_display();
}

static void select_handler(ClickRecognizerRef r, void *ctx) {
  (void)r; (void)ctx;

  if (s_current_question >= s_num_columns) {
    /* Submit */
    submit_log();
    return;
  }

  ColumnDef *col = &s_columns[s_current_question];

  if (col->field_type == FIELD_TEXT) {
#if defined(PBL_MICROPHONE)
    dictation_session_start(s_dictation_session);
    return;
#endif
  }

  /* Mark answered and advance */
  s_answers[s_current_question].answered = true;
  s_current_question++;
  update_display();
}

static void back_handler(ClickRecognizerRef r, void *ctx) {
  (void)r; (void)ctx;
  if (s_current_question > 0) {
    s_current_question--;
    update_display();
  } else {
    /* Exit — schedule reminder if not submitted */
    if (!s_submitted && s_settings.auto_popup) {
      schedule_reminder();
    }
    window_stack_pop(true);
  }
}

static void click_config(void *ctx) {
  (void)ctx;
  window_single_click_subscribe(BUTTON_ID_UP, up_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_handler);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_handler);
  window_single_click_subscribe(BUTTON_ID_BACK, back_handler);
}

/* ─── Pre-fill total_sleep_minutes from Pebble Health ─────────── */
static void prefill_health_data(void) {
#if defined(PBL_HEALTH)
  time_t now = time(NULL);
  time_t today = time_start_of_today();
  time_t yesterday_evening = today - (6 * 3600); /* ~6pm yesterday */

  for (int i = 0; i < s_num_columns; i++) {
    if (strcmp(s_columns[i].key, "total_sleep_minutes") == 0) {
      if (health_service_metric_accessible(HealthMetricSleepSeconds,
            yesterday_evening, now) & HealthServiceAccessibilityMaskAvailable) {
        int sleep_s = (int)health_service_sum(HealthMetricSleepSeconds,
                                               yesterday_evening, now);
        s_answers[i].int_value = sleep_s / 60;
      }
      break;
    }
  }
#endif
}

/* ─── AppMessage ──────────────────────────────────────────────── */
static void prv_exit_after_timeout(void *data) {
  (void)data;
  window_stack_pop_all(true);
}
static void inbox_received_handler(DictionaryIterator *iter, void *context) {
  (void)context;

  /* Columns data from PKJS */
  Tuple *cols_tuple = dict_find(iter, MESSAGE_KEY_ColumnsData);
  if (cols_tuple) {
    s_num_columns = parse_columns_string(cols_tuple->value->cstring,
                                          s_columns, MAX_COLUMNS);
    s_columns_loaded = true;

    /* Initialize answers */
    for (int i = 0; i < s_num_columns; i++) {
      init_answer(&s_answers[i], &s_columns[i]);
    }

    prefill_health_data();
    s_current_question = 0;
    text_layer_set_text(s_status_layer, "");
    update_display();
    return;
  }

  /* Columns failed */
  Tuple *fail_tuple = dict_find(iter, MESSAGE_KEY_ColumnsFailed);
  if (fail_tuple) {
    text_layer_set_text(s_status_layer, "No connection.\nCheck phone & token.");
    /* Exit after 3 seconds */
    app_timer_register(3000, prv_exit_after_timeout, NULL);
    return;
  }

  /* Log result */
  Tuple *result_tuple = dict_find(iter, MESSAGE_KEY_LogResult);
  if (result_tuple) {
    if (result_tuple->value->int32 == 1) {
      text_layer_set_text(s_status_layer, "Saved!");
      /* Schedule next daily wakeup and exit after 2s */
      schedule_daily_wakeup();
      app_timer_register(2000, prv_exit_after_timeout, NULL);
    } else {
      text_layer_set_text(s_status_layer, "Save failed.");
    }
    return;
  }

  /* Settings from Clay */
  bool changed = false;
  Tuple *t;

  t = dict_find(iter, MESSAGE_KEY_AutoPopup);
  if (t) { s_settings.auto_popup = (t->value->int32 != 0); changed = true; }

  t = dict_find(iter, MESSAGE_KEY_PopupHour);
  if (t) { s_settings.popup_hour = t->value->int32; changed = true; }

  t = dict_find(iter, MESSAGE_KEY_PopupMinute);
  if (t) { s_settings.popup_minute = t->value->int32; changed = true; }

  t = dict_find(iter, MESSAGE_KEY_ReminderInterval);
  if (t) { s_settings.reminder_interval = t->value->int32; changed = true; }

  if (changed) {
    prv_save_settings();
    schedule_daily_wakeup();
  }
}

static void inbox_dropped_handler(AppMessageResult reason, void *context) {
  (void)context;
  APP_LOG(APP_LOG_LEVEL_ERROR, "Inbox dropped: %d", (int)reason);
}

static void outbox_failed_handler(DictionaryIterator *iter, AppMessageResult reason, void *ctx) {
  (void)iter; (void)ctx;
  APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox failed: %d", (int)reason);
  text_layer_set_text(s_status_layer, "Send failed");
}

static void outbox_sent_handler(DictionaryIterator *iter, void *ctx) {
  (void)iter; (void)ctx;
  APP_LOG(APP_LOG_LEVEL_INFO, "Outbox sent");
}

/* ─── Request columns from PKJS ───────────────────────────────── */
static void request_columns(void) {
  DictionaryIterator *iter;
  AppMessageResult result = app_message_outbox_begin(&iter);
  if (result == APP_MSG_OK) {
    dict_write_int32(iter, MESSAGE_KEY_RequestColumns, 1);
    app_message_outbox_send();
  }
}

/* ─── Window load/unload ──────────────────────────────────────── */
static void window_load(Window *window) {
  window_set_background_color(window, GColorBlack);
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);

  /* Progress — top right */
  s_progress_layer = text_layer_create(GRect(b.size.w - 60, 4, 56, 18));
  text_layer_set_background_color(s_progress_layer, GColorClear);
  text_layer_set_text_color(s_progress_layer, GColorDarkGray);
  text_layer_set_font(s_progress_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14));
  text_layer_set_text_alignment(s_progress_layer, GTextAlignmentRight);

  /* Title — question label */
  s_title_layer = text_layer_create(GRect(10, 20, b.size.w - 20, 30));
  text_layer_set_background_color(s_title_layer, GColorClear);
  text_layer_set_text_color(s_title_layer, GColorWhite);
  text_layer_set_font(s_title_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD));
  text_layer_set_text_alignment(s_title_layer, GTextAlignmentCenter);

  /* Value — big display */
  s_value_layer = text_layer_create(GRect(10, 65, b.size.w - 20, 60));
  text_layer_set_background_color(s_value_layer, GColorClear);
  text_layer_set_text_color(s_value_layer, GColorChromeYellow);
  text_layer_set_font(s_value_layer, fonts_get_system_font(FONT_KEY_BITHAM_42_BOLD));
  text_layer_set_text_alignment(s_value_layer, GTextAlignmentCenter);

  /* Hint — instructions */
  s_hint_layer = text_layer_create(GRect(10, 135, b.size.w - 20, 30));
  text_layer_set_background_color(s_hint_layer, GColorClear);
  text_layer_set_text_color(s_hint_layer, GColorDarkGray);
  text_layer_set_font(s_hint_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_hint_layer, GTextAlignmentCenter);

  /* Status — bottom */
  s_status_layer = text_layer_create(GRect(10, 170, b.size.w - 20, 50));
  text_layer_set_background_color(s_status_layer, GColorClear);
  text_layer_set_text_color(s_status_layer, GColorWhite);
  text_layer_set_font(s_status_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_status_layer, GTextAlignmentCenter);
  text_layer_set_text(s_status_layer, "Loading...");

  layer_add_child(root, text_layer_get_layer(s_progress_layer));
  layer_add_child(root, text_layer_get_layer(s_title_layer));
  layer_add_child(root, text_layer_get_layer(s_value_layer));
  layer_add_child(root, text_layer_get_layer(s_hint_layer));
  layer_add_child(root, text_layer_get_layer(s_status_layer));
}

static void window_unload(Window *window) {
  (void)window;
  text_layer_destroy(s_title_layer);
  text_layer_destroy(s_value_layer);
  text_layer_destroy(s_hint_layer);
  text_layer_destroy(s_progress_layer);
  text_layer_destroy(s_status_layer);
}

/* ─── Init / Deinit ────────────────────────────────────────────── */
static void init(void) {
  /* Version migration */
  if (persist_read_int(PERSIST_VERSION_KEY) != PERSIST_SETTINGS_VERSION) {
    persist_write_int(PERSIST_VERSION_KEY, PERSIST_SETTINGS_VERSION);
    persist_delete(PERSIST_SETTINGS_KEY);
  }

  prv_load_settings();

  /* Check connectivity — if no phone, exit silently */
  if (!connection_service_peek_pebble_app_connection()) {
    return;
  }

  /* If woken by wakeup, vibrate */
  if (launch_reason() == APP_LAUNCH_WAKEUP) {
    static const uint32_t segs[] = { 200, 150, 200, 150, 200 };
    VibePattern pat = { .durations = segs, .num_segments = 5 };
    vibes_enqueue_custom_pattern(pat);
  }

  /* Create main window */
  s_main_window = window_create();
  window_set_click_config_provider(s_main_window, click_config);
  window_set_window_handlers(s_main_window, (WindowHandlers){
    .load = window_load, .unload = window_unload,
  });
  window_stack_push(s_main_window, true);

  /* AppMessage */
  app_message_register_inbox_received(inbox_received_handler);
  app_message_register_inbox_dropped(inbox_dropped_handler);
  app_message_register_outbox_failed(outbox_failed_handler);
  app_message_register_outbox_sent(outbox_sent_handler);
  app_message_open(app_message_inbox_size_maximum(), app_message_outbox_size_maximum());

  /* Dictation */
#if defined(PBL_MICROPHONE)
  s_dictation_session = dictation_session_create(sizeof(s_dictation_buf),
                                                  dictation_callback, NULL);
#endif

  /* Request columns from phone */
  request_columns();
}

static void deinit(void) {
#if defined(PBL_MICROPHONE)
  if (s_dictation_session) dictation_session_destroy(s_dictation_session);
#endif
  if (s_main_window) window_destroy(s_main_window);
}

int main(void) { init(); app_event_loop(); deinit(); }
