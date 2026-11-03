// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Start-up and exit (architecture §4.4, §5.5). Frozen after M0.

use std::sync::Arc;

use tauri::{AppHandle, Manager};
use tramado_base::applog::AppLog;
use tramado_base::classfs::ClassFs;
use tramado_base::paths::Paths;
use tramado_base::picks::PickRegistry;
use tramado_base::registry::ClassRegistry;

use crate::commands;

/// What every domain shares (managed by Tauri; each `commands::<domain>::init` receives it).
#[derive(Clone)]
pub struct Shared {
    pub paths: Arc<Paths>,
    pub registry: Arc<ClassRegistry>,
    pub fs: Arc<ClassFs>,
    pub picks: Arc<PickRegistry>,
    pub version: String,
}

/// Paths, app log (managed as `Arc<AppLog>`), class registry, `Shared`, then every domain's
/// `init` in the order of architecture §4.4, then deep links and the main window.
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let resolver = handle.path();
    let paths = Arc::new(Paths::resolve(
        resolver.app_config_dir()?,
        resolver.app_local_data_dir()?,
        resolver.app_cache_dir()?,
        resolver.home_dir()?,
        resolver.resource_dir().ok(),
    ));
    for dir in [&paths.config, &paths.data, &paths.cache] {
        std::fs::create_dir_all(dir)?;
    }
    let log = Arc::new(AppLog::open(&paths.logs_dir())?);
    log.write(
        "info",
        &format!("Tramado {} starting", handle.package_info().version),
        None,
    );
    app.manage(log);
    let registry = Arc::new(ClassRegistry::load(&paths.config)?);
    let fs = Arc::new(ClassFs::new(paths.clone(), registry.clone()));
    let shared = Shared {
        paths,
        registry,
        fs,
        picks: Arc::new(PickRegistry::new()),
        version: handle.package_info().version.to_string(),
    };
    app.manage(shared.clone());
    commands::app::init(&handle, &shared)?;
    commands::classes::init(&handle, &shared)?;
    commands::dialogs::init(&handle, &shared)?;
    commands::ai::init(&handle, &shared)?;
    commands::system::init(&handle, &shared)?;
    commands::sync::init(&handle, &shared)?;
    commands::speech::init(&handle, &shared)?;
    crate::deeplink::init(&handle, &shared)?;
    crate::tray::init(&handle, &shared)?;
    crate::window::init(&handle, &shared)?;
    Ok(())
}

/// The exit path: speech (finalise the recording journal, cancel the job keeping partials),
/// sync (background stop, 5 s deadline), then the app log.
pub fn on_exit(app: &AppHandle) {
    commands::speech::on_exit(app);
    commands::sync::on_exit(app);
    commands::app::on_exit(app);
}
