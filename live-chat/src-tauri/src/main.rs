#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{Menu, MenuItem};
use tauri_plugin_autostart::ManagerExt;

fn force_overlay_on_top(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        };
        use windows::Win32::Foundation::HWND;

        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                let _ = SetWindowPos(
                    HWND(hwnd.0 as isize),
                    HWND_TOPMOST,
                    0, 0, 0, 0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        }
    }
}

#[tauri::command]
fn set_overlay_interactive(app: tauri::AppHandle, interactive: bool) -> Result<(), String> {
    let overlay = app.get_webview_window("overlay").ok_or("overlay not found")?;
    overlay.set_ignore_cursor_events(!interactive).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
struct MonitorInfo {
    name: String,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
}

#[tauri::command]
fn list_monitors(app: tauri::AppHandle) -> Vec<MonitorInfo> {
    let overlay = match app.get_webview_window("overlay") {
        Some(w) => w,
        None => return vec![],
    };
    let monitors = match overlay.available_monitors() {
        Ok(m) => m,
        Err(_) => return vec![],
    };
    monitors
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            let size = m.size();
            let pos = m.position();
            MonitorInfo {
                name: m.name().cloned().unwrap_or_else(|| format!("Monitor {}", i + 1)),
                width: size.width,
                height: size.height,
                x: pos.x,
                y: pos.y,
            }
        })
        .collect()
}

#[tauri::command]
fn set_overlay_monitor(app: tauri::AppHandle, x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
    let overlay = app.get_webview_window("overlay").ok_or("overlay not found")?;
    overlay.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(x, y)))
        .map_err(|e| e.to_string())?;
    overlay.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(width, height)))
        .map_err(|e| e.to_string())?;
    force_overlay_on_top(&overlay);
    Ok(())
}

#[tauri::command]
fn get_autostart(app: tauri::AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let autostart = app.autolaunch();
    if enabled {
        autostart.enable().map_err(|e| e.to_string())
    } else {
        autostart.disable().map_err(|e| e.to_string())
    }
}

#[derive(serde::Serialize)]
struct FileEntry {
    name: String,
    mtime_ms: u64,
}

#[tauri::command]
fn list_files_sorted(dir: String) -> Result<Vec<FileEntry>, String> {
    let mut entries: Vec<FileEntry> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            let mtime_ms = metadata
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            Some(FileEntry { name, mtime_ms })
        })
        .collect();
    entries.sort_by(|a, b| b.mtime_ms.cmp(&a.mtime_ms));
    Ok(entries)
}

fn main() {
    // Allow autoplay with sound in WebView2 (needed for overlay which is non-focusable)
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--autoplay-policy=no-user-gesture-required");

    let mut builder = tauri::Builder::default();

    // Only enforce single instance in release mode so dev and bundled app can run side by side
    #[cfg(not(debug_assertions))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![get_autostart, set_autostart, set_overlay_interactive, list_monitors, set_overlay_monitor, list_files_sorted])
        .setup(|app| {
            // Setup overlay window
            let overlay_window = app.get_webview_window("overlay").unwrap();
            overlay_window.set_decorations(false).unwrap();
            overlay_window.set_skip_taskbar(true).unwrap();
            overlay_window.set_focusable(false).unwrap();
            overlay_window.set_ignore_cursor_events(true).unwrap();
            overlay_window.set_shadow(false).unwrap();

            // Cover entire screen without using fullscreen mode
            if let Some(monitor) = overlay_window.current_monitor().unwrap() {
                let size = monitor.size();
                let pos = monitor.position();
                overlay_window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(pos.x, pos.y))).unwrap();
                overlay_window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(size.width, size.height))).unwrap();
            }

            overlay_window.set_always_on_top(true).unwrap();
            force_overlay_on_top(&overlay_window);

            // Re-assert topmost every 5 seconds (Windows can demote it)
            let overlay_clone = overlay_window.clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(10));
                    force_overlay_on_top(&overlay_clone);
                }
            });

            // Build system tray
            let show_item = MenuItem::with_id(app, "show", "Ouvrir Shitpost", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Shitpost")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Hide main window only when launched via autostart (Windows boot)
            let is_autostart = std::env::args().any(|a| a == "--autostart");
            if is_autostart {
                if let Some(main_window) = app.get_webview_window("main") {
                    let _ = main_window.hide();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide main window on close instead of quitting
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
