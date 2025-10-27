// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn force_overlay_on_top(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE, SWP_NOACTIVATE};
        use windows::Win32::Foundation::HWND;
        
        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                let _ = SetWindowPos(
                    HWND(hwnd.0 as isize),
                    HWND_TOPMOST,
                    0, 0, 0, 0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
                );
            }
        }
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let overlay_window = app.get_webview_window("overlay").unwrap();
            overlay_window.set_decorations(false).unwrap();
            overlay_window.set_always_on_top(true).unwrap();
            overlay_window.set_skip_taskbar(true).unwrap();
            overlay_window.set_focusable(false).unwrap();
            overlay_window.set_ignore_cursor_events(true).unwrap();
            overlay_window.set_fullscreen(true).unwrap();
            overlay_window.set_shadow(false).unwrap();
            
            // Force the overlay to be on top of everything
            force_overlay_on_top(&overlay_window);
            
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
