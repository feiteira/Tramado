// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Tramado desktop shell (architecture §5.5). The webview has no network and no plugin
//! permission beyond window control: every dialog, opener, notification, deep link, autostart
//! and shortcut is driven from Rust, and every class file goes through `tramado_base::ClassFs`.
//! Frozen after M0: work packages fill in `commands/*.rs`, `media.rs`, `tray.rs`, `window.rs`
//! and `deeplink.rs`.

pub mod commands;
pub mod deeplink;
pub mod media;
pub mod state;
pub mod tray;
pub mod util;
pub mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    if std::env::var_os("TRAMADO_DATA_DIR").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            deeplink::on_second_instance(app, argv)
        }));
    }
    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol("tramado-media", media::handle)
        .setup(|app| state::setup(app)) // Shared + every commands::<domain>::init, tray, deep links, window
        .on_window_event(window::on_window_event)
        .invoke_handler(tauri::generate_handler![
            // §6.1 app, files, private data, cache
            commands::app::app_info,
            commands::app::app_file_read,
            commands::app::app_file_write,
            commands::app::app_log,
            commands::app::app_take_pending_links,
            commands::app::app_set_background_mode,
            commands::app::app_autostart_get,
            commands::app::app_autostart_set,
            commands::app::app_quit,
            commands::app::diag_collect,
            commands::app::person_init,
            commands::app::person_prove,
            commands::app::storage_usage,
            commands::app::cache_clear,
            commands::app::app_reveal,
            commands::app::private_read,
            commands::app::private_write,
            commands::app::private_append,
            commands::app::private_list,
            commands::app::private_remove,
            commands::app::private_purge,
            commands::app::cache_read,
            commands::app::cache_write,
            commands::app::cache_remove,
            // §6.2 class registry and class files
            commands::classes::classes_list,
            commands::classes::classes_root,
            commands::classes::classes_set_root,
            commands::classes::class_create,
            commands::classes::class_adopt,
            commands::classes::class_fork,
            commands::classes::class_update,
            commands::classes::class_forget,
            commands::classes::class_trash,
            commands::classes::class_trash_empty,
            commands::classes::class_list,
            commands::classes::class_stat,
            commands::classes::class_read,
            commands::classes::class_read_range,
            commands::classes::class_write,
            commands::classes::class_append,
            commands::classes::class_mkdir,
            commands::classes::class_move,
            commands::classes::class_remove,
            commands::classes::class_hash,
            commands::classes::class_import,
            commands::classes::class_export,
            commands::classes::class_reveal,
            commands::classes::class_open,
            // §6.3 dialogs
            commands::dialogs::dialog_pick_files,
            commands::dialogs::dialog_pick_folder,
            commands::dialogs::dialog_save,
            commands::dialogs::dialog_save_text,
            // §6.4 secrets and AI
            commands::ai::secret_set,
            commands::ai::secret_status,
            commands::ai::secret_clear,
            commands::ai::ai_send,
            commands::ai::ai_cancel,
            commands::ai::ai_hosts,
            commands::ai::ai_host_allow,
            commands::ai::ai_host_forget,
            commands::ai::ai_privacy_get,
            commands::ai::ai_privacy_set,
            commands::ai::ai_activity,
            commands::ai::ai_activity_clear,
            commands::ai::ai_busy_policy_get,
            commands::ai::ai_busy_policy_set,
            // §6.5 system
            commands::system::open_external,
            commands::system::notify_show,
            commands::system::shortcut_set_markers,
            commands::system::system_power,
            // §6.7 sync
            commands::sync::sync_identity,
            commands::sync::sync_identity_resolve,
            commands::sync::sync_start,
            commands::sync::sync_restart,
            commands::sync::sync_status,
            commands::sync::sync_snapshot,
            commands::sync::sync_settings_apply,
            commands::sync::sync_policy_set,
            commands::sync::sync_sign,
            commands::sync::sync_share_class,
            commands::sync::sync_join_class,
            commands::sync::sync_cancel_join,
            commands::sync::sync_accept_folder,
            commands::sync::sync_leave_class,
            commands::sync::sync_admit,
            commands::sync::sync_decline,
            commands::sync::sync_normalize_ids,
            commands::sync::sync_own_addresses,
            commands::sync::sync_file_info,
            commands::sync::sync_wait_available,
            commands::sync::sync_wait_caught_up,
            commands::sync::sync_device_stats,
            commands::sync::sync_folder_status,
            commands::sync::sync_versions,
            commands::sync::sync_restore,
            commands::sync::sync_folder_errors,
            commands::sync::sync_pause_class,
            commands::sync::sync_mass_delete_resolve,
            commands::sync::sync_scan,
            commands::sync::sync_diagnostics,
            commands::sync::sync_existing,
            // §6.8 speech
            commands::speech::speech_info,
            commands::speech::speech_models,
            commands::speech::speech_model_download,
            commands::speech::speech_model_attach,
            commands::speech::speech_model_cancel,
            commands::speech::speech_model_delete,
            commands::speech::speech_model_import,
            commands::speech::speech_devices,
            commands::speech::speech_meter_start,
            commands::speech::speech_meter_stop,
            commands::speech::speech_recorder_start,
            commands::speech::speech_recorder_attach,
            commands::speech::speech_recorder_pause,
            commands::speech::speech_recorder_resume,
            commands::speech::speech_recorder_mark,
            commands::speech::speech_recorder_stop,
            commands::speech::speech_recordings_pending,
            commands::speech::speech_recording_publish,
            commands::speech::speech_recording_discard,
            commands::speech::speech_import_audio,
            commands::speech::speech_import_attach,
            commands::speech::speech_transcribe_start,
            commands::speech::speech_transcribe_attach,
            commands::speech::speech_transcribe_cancel,
            commands::speech::speech_jobs,
            commands::speech::speech_transcribe_take,
            commands::speech::speech_peaks,
        ])
        .build(tauri::generate_context!())
        .expect("Tramado failed to start")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                state::on_exit(app)
            }
        });
}
