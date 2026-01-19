mod audio;
mod ollama;
mod whisper;

use arboard::Clipboard;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, Manager, State,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg(target_os = "macos")]
use cocoa::appkit::NSWindowCollectionBehavior;
#[cfg(target_os = "macos")]
use cocoa::base::id;
#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};

// Global state - all types must be Send + Sync
struct AppState {
    recording_state: audio::RecordingState,
    whisper: Mutex<Option<whisper::WhisperTranscriber>>,
    ollama: Mutex<ollama::OllamaClient>,
    recent_transcripts: Mutex<Vec<String>>,
}

// ============ Audio Commands ============

#[tauri::command]
fn start_recording(state: State<'_, AppState>) -> Result<(), String> {
    audio::start_recording(&state.recording_state)
}

#[tauri::command]
fn stop_recording(state: State<'_, AppState>) -> Result<Vec<u8>, String> {
    audio::stop_recording(&state.recording_state)
}

#[tauri::command]
fn is_recording(state: State<'_, AppState>) -> bool {
    audio::is_recording(&state.recording_state)
}

#[tauri::command]
fn get_input_devices() -> Vec<audio::AudioDevice> {
    audio::get_input_devices()
}

#[tauri::command]
fn set_input_device(device_id: Option<String>, state: State<'_, AppState>) {
    audio::set_input_device(&state.recording_state, device_id);
}

#[tauri::command]
fn get_selected_device(state: State<'_, AppState>) -> Option<String> {
    audio::get_selected_device(&state.recording_state)
}

// ============ Whisper Commands ============

#[tauri::command]
fn load_whisper_model(model_path: String, state: State<'_, AppState>) -> Result<(), String> {
    let path = PathBuf::from(&model_path);
    let mut transcriber = whisper::WhisperTranscriber::new(path);
    transcriber.load_model()?;

    let mut whisper_state = state.whisper.lock().unwrap();
    *whisper_state = Some(transcriber);

    Ok(())
}

#[tauri::command]
fn transcribe_audio(
    wav_data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<whisper::TranscriptionResult, String> {
    let whisper_state = state.whisper.lock().unwrap();
    let transcriber = whisper_state
        .as_ref()
        .ok_or("Whisper model not loaded")?;

    let samples = whisper::wav_to_samples(&wav_data)?;
    transcriber.transcribe(&samples)
}

#[tauri::command]
fn is_whisper_loaded(state: State<'_, AppState>) -> bool {
    let whisper_state = state.whisper.lock().unwrap();
    whisper_state.as_ref().map(|w| w.is_model_loaded()).unwrap_or(false)
}

#[tauri::command]
fn get_models_directory() -> String {
    whisper::get_models_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn get_available_whisper_models() -> Vec<(String, String, u64)> {
    whisper::get_available_models()
        .into_iter()
        .map(|(name, file, size)| (name.to_string(), file.to_string(), size))
        .collect()
}

// ============ Ollama Commands ============

#[tauri::command]
async fn cleanup_text(text: String, language: Option<String>, state: State<'_, AppState>) -> Result<String, String> {
    let ollama = {
        let guard = state.ollama.lock().unwrap();
        guard.clone()
    };
    ollama.cleanup_text(&text, language.as_deref()).await
}

#[tauri::command]
async fn check_ollama_available(state: State<'_, AppState>) -> Result<bool, String> {
    let ollama = {
        let guard = state.ollama.lock().unwrap();
        guard.clone()
    };
    ollama.check_availability().await
}

#[tauri::command]
fn set_ollama_enabled(enabled: bool, state: State<'_, AppState>) {
    let mut ollama = state.ollama.lock().unwrap();
    ollama.set_enabled(enabled);
}

#[tauri::command]
fn is_ollama_enabled(state: State<'_, AppState>) -> bool {
    let ollama = state.ollama.lock().unwrap();
    ollama.is_enabled()
}

#[tauri::command]
fn set_ollama_model(model: String, state: State<'_, AppState>) {
    let mut ollama = state.ollama.lock().unwrap();
    ollama.set_model(&model);
}

#[tauri::command]
fn get_recommended_ollama_models() -> Vec<(String, String)> {
    ollama::get_recommended_models()
        .into_iter()
        .map(|(name, desc)| (name.to_string(), desc.to_string()))
        .collect()
}

// ============ Clipboard Commands ============

#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| format!("Failed to access clipboard: {}", e))?;
    clipboard
        .set_text(&text)
        .map_err(|e| format!("Failed to copy to clipboard: {}", e))?;
    Ok(())
}

#[tauri::command]
fn simulate_paste() -> Result<(), String> {
    // Use AppleScript to simulate Cmd+V
    std::process::Command::new("osascript")
        .arg("-e")
        .arg("tell application \"System Events\" to keystroke \"v\" using command down")
        .output()
        .map_err(|e| format!("Failed to simulate paste: {}", e))?;
    Ok(())
}

// ============ Global Hotkey Commands ============

#[tauri::command]
fn register_hotkey(app: AppHandle, key: String, modifiers: Vec<String>) -> Result<(), String> {
    // First unregister any existing hotkey
    let _ = unregister_all_hotkeys(app.clone());

    // Parse modifiers
    let mut mods = Modifiers::empty();
    for m in &modifiers {
        match m.to_lowercase().as_str() {
            "ctrl" | "control" => mods |= Modifiers::CONTROL,
            "alt" | "option" => mods |= Modifiers::ALT,
            "shift" => mods |= Modifiers::SHIFT,
            "meta" | "cmd" | "command" | "super" => mods |= Modifiers::META,
            _ => {}
        }
    }

    // Parse key code
    let code = match key.to_lowercase().as_str() {
        "a" => Code::KeyA, "b" => Code::KeyB, "c" => Code::KeyC, "d" => Code::KeyD,
        "e" => Code::KeyE, "f" => Code::KeyF, "g" => Code::KeyG, "h" => Code::KeyH,
        "i" => Code::KeyI, "j" => Code::KeyJ, "k" => Code::KeyK, "l" => Code::KeyL,
        "m" => Code::KeyM, "n" => Code::KeyN, "o" => Code::KeyO, "p" => Code::KeyP,
        "q" => Code::KeyQ, "r" => Code::KeyR, "s" => Code::KeyS, "t" => Code::KeyT,
        "u" => Code::KeyU, "v" => Code::KeyV, "w" => Code::KeyW, "x" => Code::KeyX,
        "y" => Code::KeyY, "z" => Code::KeyZ,
        "space" => Code::Space,
        "enter" | "return" => Code::Enter,
        "escape" | "esc" => Code::Escape,
        "backspace" => Code::Backspace,
        "tab" => Code::Tab,
        "f1" => Code::F1, "f2" => Code::F2, "f3" => Code::F3, "f4" => Code::F4,
        "f5" => Code::F5, "f6" => Code::F6, "f7" => Code::F7, "f8" => Code::F8,
        "f9" => Code::F9, "f10" => Code::F10, "f11" => Code::F11, "f12" => Code::F12,
        _ => return Err(format!("Unknown key: {}", key)),
    };

    let shortcut = Shortcut::new(Some(mods), code);

    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| format!("Failed to register hotkey: {}", e))?;

    Ok(())
}

#[tauri::command]
fn unregister_all_hotkeys(app: AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("Failed to unregister hotkeys: {}", e))?;
    Ok(())
}

// ============ Overlay Commands ============

#[tauri::command]
fn show_overlay(app: AppHandle, overlay_state: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overlay") {
        // Set the state
        let _ = window.emit("overlay-state", &overlay_state);

        // Position at bottom center of screen
        if let Ok(Some(monitor)) = window.primary_monitor() {
            let screen_size = monitor.size();
            let scale = monitor.scale_factor();
            let window_width = 110.0 * scale;
            let window_height = 28.0 * scale;
            let x = ((screen_size.width as f64 - window_width) / 2.0) as i32;
            let y = (screen_size.height as f64 - window_height - (100.0 * scale)) as i32; // 100px from bottom
            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
        }

        // Set window level to show above fullscreen apps on macOS
        #[cfg(target_os = "macos")]
        {
            if let Ok(ns_window) = window.ns_window() {
                unsafe {
                    let ns_window = ns_window as id;
                    // Use screen saver window level (1000) to show above fullscreen
                    let _: () = msg_send![ns_window, setLevel: 1000_i64];
                    // Allow window to appear on all spaces including fullscreen
                    let _: () = msg_send![ns_window, setCollectionBehavior:
                        NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces |
                        NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary |
                        NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
                    ];
                }
            }
        }

        let _ = window.show();
    }
    Ok(())
}

#[tauri::command]
fn hide_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
fn set_overlay_state(app: AppHandle, overlay_state: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.emit("overlay-state", &overlay_state);
    }
    Ok(())
}

// ============ Tray Menu Commands ============

#[tauri::command]
fn add_recent_transcript(app: AppHandle, text: String, state: State<'_, AppState>) -> Result<(), String> {
    // Add to recent transcripts (keep max 3)
    {
        let mut transcripts = state.recent_transcripts.lock().unwrap();
        transcripts.insert(0, text);
        transcripts.truncate(3);
    }

    // Update the tray menu
    update_tray_menu(&app, &state)?;

    Ok(())
}

fn update_tray_menu(app: &AppHandle, state: &State<'_, AppState>) -> Result<(), String> {
    let transcripts = state.recent_transcripts.lock().unwrap();

    // Build menu items
    let mut items: Vec<MenuItem<tauri::Wry>> = Vec::new();

    for (i, text) in transcripts.iter().enumerate() {
        // Truncate long texts for display
        let display_text = if text.len() > 50 {
            format!("{}...", &text[..47])
        } else {
            text.clone()
        };

        let item = MenuItem::with_id(
            app,
            format!("transcript_{}", i),
            &display_text,
            true,
            None::<&str>,
        ).map_err(|e| format!("Failed to create menu item: {}", e))?;

        items.push(item);
    }

    // Create menu
    let menu = if items.is_empty() {
        let no_items = MenuItem::with_id(app, "no_items", "No transcripts yet", false, None::<&str>)
            .map_err(|e| format!("Failed to create menu: {}", e))?;
        Menu::with_items(app, &[&no_items])
            .map_err(|e| format!("Failed to create menu: {}", e))?
    } else {
        let separator = PredefinedMenuItem::separator(app)
            .map_err(|e| format!("Failed to create separator: {}", e))?;
        let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
            .map_err(|e| format!("Failed to create quit: {}", e))?;
        let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)
            .map_err(|e| format!("Failed to create show: {}", e))?;

        let item_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = items.iter()
            .map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
            .chain(std::iter::once(&separator as &dyn tauri::menu::IsMenuItem<tauri::Wry>))
            .chain(std::iter::once(&show as &dyn tauri::menu::IsMenuItem<tauri::Wry>))
            .chain(std::iter::once(&quit as &dyn tauri::menu::IsMenuItem<tauri::Wry>))
            .collect();

        Menu::with_items(app, &item_refs)
            .map_err(|e| format!("Failed to create menu: {}", e))?
    };

    // Update tray
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(menu))
            .map_err(|e| format!("Failed to set tray menu: {}", e))?;
    }

    Ok(())
}

// ============ Combined Workflow ============

#[tauri::command]
async fn transcribe_and_cleanup(
    wav_data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<TranscribeResult, String> {
    // Check if we have audio data
    if wav_data.len() < 1000 {
        return Err("No audio captured. Check microphone permissions in System Settings > Privacy & Security > Microphone.".to_string());
    }

    // First transcribe
    let transcription = {
        let whisper_state = state.whisper.lock().unwrap();
        let transcriber = whisper_state
            .as_ref()
            .ok_or("Whisper model not loaded")?;

        let samples = whisper::wav_to_samples(&wav_data)?;

        // Check if audio has any signal
        let max_amplitude: f32 = samples.iter().map(|s| s.abs()).fold(0.0, f32::max);
        if max_amplitude < 0.01 {
            return Err("Audio too quiet - check that your microphone is working and you have granted permission.".to_string());
        }

        transcriber.transcribe(&samples)?
    };

    // Check if transcription is meaningful
    let raw_text = transcription.text.trim();
    if raw_text.is_empty() || raw_text.len() < 2 {
        return Err("Could not transcribe audio. Try speaking louder or longer.".to_string());
    }

    // Then cleanup with Ollama if enabled
    let (ollama_enabled, ollama_client) = {
        let ollama = state.ollama.lock().unwrap();
        (ollama.is_enabled(), ollama.clone())
    };

    let language = &transcription.language;

    let cleaned_text = if ollama_enabled && raw_text.len() > 3 {
        match ollama_client.cleanup_text(raw_text, Some(language)).await {
            Ok(cleaned) => {
                // If Ollama returns something that looks like an error/instruction, use raw text
                if cleaned.contains("provide") && cleaned.contains("transcript") {
                    raw_text.to_string()
                } else {
                    cleaned
                }
            },
            Err(_) => raw_text.to_string(), // Fall back to raw text on error
        }
    } else {
        raw_text.to_string()
    };

    Ok(TranscribeResult {
        raw_text: raw_text.to_string(),
        cleaned_text,
        language: transcription.language,
    })
}

#[derive(Debug, Clone, serde::Serialize)]
struct TranscribeResult {
    raw_text: String,
    cleaned_text: String,
    language: String,
}

// ============ App Entry Point ============

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = env_logger::try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // Emit events for key press/release to frontend
                    match event.state() {
                        ShortcutState::Pressed => {
                            let _ = app.emit("hotkey-pressed", shortcut.to_string());
                        }
                        ShortcutState::Released => {
                            let _ = app.emit("hotkey-released", shortcut.to_string());
                        }
                    }
                })
                .build(),
        )
        .manage(AppState {
            recording_state: audio::RecordingState::new(),
            whisper: Mutex::new(None),
            ollama: Mutex::new(ollama::OllamaClient::new()),
            recent_transcripts: Mutex::new(Vec::new()),
        })
        .setup(|app| {
            // Create tray icon with menu
            let no_items = MenuItem::with_id(app, "no_items", "No transcripts yet", false, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&no_items, &separator, &show, &quit])?;

            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .menu_on_left_click(true)
                .on_menu_event(|app, event| {
                    let id = event.id.as_ref();
                    if id.starts_with("transcript_") {
                        // Get transcript index and copy to clipboard
                        if let Ok(idx) = id.replace("transcript_", "").parse::<usize>() {
                            if let Some(state) = app.try_state::<AppState>() {
                                let transcripts = state.recent_transcripts.lock().unwrap();
                                if let Some(text) = transcripts.get(idx) {
                                    if let Ok(mut clipboard) = Clipboard::new() {
                                        let _ = clipboard.set_text(text);
                                    }
                                }
                            }
                        }
                    } else if id == "show" {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    } else if id == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Audio
            start_recording,
            stop_recording,
            is_recording,
            get_input_devices,
            set_input_device,
            get_selected_device,
            // Whisper
            load_whisper_model,
            transcribe_audio,
            is_whisper_loaded,
            get_models_directory,
            get_available_whisper_models,
            // Ollama
            cleanup_text,
            check_ollama_available,
            set_ollama_enabled,
            is_ollama_enabled,
            set_ollama_model,
            get_recommended_ollama_models,
            // Clipboard
            copy_to_clipboard,
            simulate_paste,
            // Hotkeys
            register_hotkey,
            unregister_all_hotkeys,
            // Overlay
            show_overlay,
            hide_overlay,
            set_overlay_state,
            // Tray
            add_recent_transcript,
            // Combined
            transcribe_and_cleanup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
