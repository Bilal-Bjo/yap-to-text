import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface TranscribeResult {
  raw_text: string;
  cleaned_text: string;
  language: string;
}

interface AudioDevice {
  id: string;
  name: string;
}

type AppStatus = "idle" | "recording" | "transcribing" | "cleaning" | "ready";

interface HotkeyConfig {
  key: string;
  modifiers: string[];
}

const DEFAULT_HOTKEY: HotkeyConfig = { key: "Space", modifiers: ["Meta", "Shift"] };

function App() {
  const [status, setStatus] = useState<AppStatus>("idle");
  const [result, setResult] = useState<TranscribeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isOllamaAvailable, setIsOllamaAvailable] = useState(false);
  const [aiCleanupEnabled, setAiCleanupEnabled] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [modelPath, setModelPath] = useState("");
  const [history, setHistory] = useState<TranscribeResult[]>(() => {
    const saved = localStorage.getItem("yap-history");
    if (saved) { try { return JSON.parse(saved); } catch { return []; } }
    return [];
  });
  const [initialHistoryLoaded, setInitialHistoryLoaded] = useState(false);
  const [hotkey, setHotkey] = useState<HotkeyConfig>(DEFAULT_HOTKEY);
  const [isCapturingHotkey, setIsCapturingHotkey] = useState(false);
  const [hotkeyEnabled, setHotkeyEnabled] = useState(true);
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const statusRef = useRef(status);
  const isModelLoadedRef = useRef(isModelLoaded);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { isModelLoadedRef.current = isModelLoaded; }, [isModelLoaded]);
  useEffect(() => {
    if (history.length > 0) localStorage.setItem("yap-history", JSON.stringify(history));
  }, [history]);
  useEffect(() => {
    // Restore last result from history on mount
    if (!initialHistoryLoaded && history.length > 0) {
      setResult(history[0]);
      setInitialHistoryLoaded(true);
    }
  }, [history, initialHistoryLoaded]);

  useEffect(() => {
    checkWhisperStatus();
    checkOllamaStatus();
    getModelsDir();
    loadSavedHotkey();
    loadAutoStartSetting();
    loadAudioDevices();
    autoLoadModel();
  }, []);

  const autoLoadModel = async () => {
    try {
      const loaded = await invoke<boolean>("is_whisper_loaded");
      if (loaded) { setIsModelLoaded(true); return; }
      const dir = await invoke<string>("get_models_directory");
      const defaultPath = `${dir}/ggml-base.bin`;
      await invoke("load_whisper_model", { modelPath: defaultPath });
      setIsModelLoaded(true);
      setModelPath(defaultPath);
    } catch { /* Model not available */ }
  };

  const loadAutoStartSetting = async () => {
    try {
      const enabled = await invoke<boolean>("plugin:autostart|is_enabled");
      setAutoStartEnabled(enabled);
    } catch { /* Plugin not available */ }
  };

  const toggleAutoStart = async () => {
    try {
      if (autoStartEnabled) await invoke("plugin:autostart|disable");
      else await invoke("plugin:autostart|enable");
      setAutoStartEnabled(!autoStartEnabled);
    } catch (e) { console.error("Failed to toggle autostart:", e); }
  };

  const loadAudioDevices = async () => {
    try {
      const devices = await invoke<AudioDevice[]>("get_input_devices");
      setAudioDevices(devices);
      // Load saved selection from localStorage
      const savedDevice = localStorage.getItem("yap-selected-microphone");
      if (savedDevice && devices.some(d => d.id === savedDevice)) {
        setSelectedDevice(savedDevice);
        await invoke("set_input_device", { deviceId: savedDevice });
      }
    } catch (e) { console.error("Failed to load audio devices:", e); }
  };

  const handleDeviceSelect = async (deviceId: string | null) => {
    try {
      setSelectedDevice(deviceId);
      await invoke("set_input_device", { deviceId });
      if (deviceId) {
        localStorage.setItem("yap-selected-microphone", deviceId);
      } else {
        localStorage.removeItem("yap-selected-microphone");
      }
    } catch (e) { console.error("Failed to set audio device:", e); }
  };

  const getModelsDir = async () => {
    try {
      const dir = await invoke<string>("get_models_directory");
      setModelPath(`${dir}/ggml-base.bin`);
    } catch (e) { console.error("Failed to get models directory:", e); }
  };

  const loadSavedHotkey = () => {
    const saved = localStorage.getItem("yap-hotkey");
    if (saved) { try { setHotkey(JSON.parse(saved)); } catch { /* Use default */ } }
    const enabledSaved = localStorage.getItem("yap-hotkey-enabled");
    if (enabledSaved !== null) setHotkeyEnabled(enabledSaved === "true");
  };

  const saveHotkey = (config: HotkeyConfig) => {
    localStorage.setItem("yap-hotkey", JSON.stringify(config));
    setHotkey(config);
  };

  const registerCurrentHotkey = async () => {
    if (!hotkeyEnabled) return;
    try {
      await invoke("register_hotkey", { key: hotkey.key, modifiers: hotkey.modifiers });
    } catch (e) { console.error("Failed to register hotkey:", e); }
  };

  useEffect(() => {
    if (hotkeyEnabled) registerCurrentHotkey();
    else invoke("unregister_all_hotkeys").catch(console.error);
    localStorage.setItem("yap-hotkey-enabled", hotkeyEnabled.toString());
  }, [hotkeyEnabled, hotkey]);

  useEffect(() => {
    let unlistenPressed: (() => void) | undefined;
    let unlistenReleased: (() => void) | undefined;
    const setup = async () => {
      unlistenPressed = await listen<string>("hotkey-pressed", () => {
        if (!isModelLoadedRef.current) return;
        if (statusRef.current !== "idle" && statusRef.current !== "ready") return;
        handleRecordStart();
      });
      unlistenReleased = await listen<string>("hotkey-released", () => {
        if (statusRef.current === "recording") handleRecordStop();
      });
    };
    setup();
    return () => { unlistenPressed?.(); unlistenReleased?.(); };
  }, []);

  const formatHotkey = (config: HotkeyConfig) => {
    const modSymbols: Record<string, string> = { Meta: "⌘", Shift: "⇧", Alt: "⌥", Control: "⌃" };
    return `${config.modifiers.map((m) => modSymbols[m] || m).join("")}${config.key}`;
  };

  const checkWhisperStatus = async () => {
    try { setIsModelLoaded(await invoke<boolean>("is_whisper_loaded")); }
    catch (e) { console.error("Failed to check Whisper status:", e); }
  };

  const checkOllamaStatus = async () => {
    try { setIsOllamaAvailable(await invoke<boolean>("check_ollama_available")); }
    catch { setIsOllamaAvailable(false); }
  };

  const loadModel = async () => {
    try {
      setError(null);
      setStatus("transcribing");
      await invoke("load_whisper_model", { modelPath });
      setIsModelLoaded(true);
      setStatus("idle");
    } catch (e) {
      setError(`Failed to load model: ${e}`);
      setStatus("idle");
    }
  };

  const handleRecordStart = useCallback(async () => {
    if (!isModelLoadedRef.current) { setError("Load model first"); return; }
    try {
      setError(null);
      setResult(null);
      await invoke("start_recording");
      await invoke("show_overlay", { overlayState: "recording" });
      setStatus("recording");
    } catch (e) { setError(`Failed to start recording: ${e}`); }
  }, []);

  const handleRecordStop = useCallback(async () => {
    if (statusRef.current !== "recording") return;
    try {
      setStatus("transcribing");
      await invoke("set_overlay_state", { overlayState: "processing" });
      const wavData = await invoke<number[]>("stop_recording");
      const transcription = await invoke<TranscribeResult>("transcribe_and_cleanup", {
        wavData: Array.from(wavData),
      });
      setResult(transcription);
      setHistory((prev) => [transcription, ...prev.slice(0, 9)]);
      const finalText = transcription.cleaned_text || transcription.raw_text;
      await invoke("copy_to_clipboard", { text: finalText });
      await invoke("add_recent_transcript", { text: finalText });
      await invoke("set_overlay_state", { overlayState: "done" });
      setStatus("ready");
      // Hide overlay and auto-paste
      setTimeout(async () => {
        await invoke("hide_overlay");
        await invoke("simulate_paste");
      }, 500);
    } catch (e) {
      setError(`${e}`);
      setStatus("idle");
      await invoke("hide_overlay");
    }
  }, []);

  const toggleAiCleanup = async () => {
    const newValue = !aiCleanupEnabled;
    setAiCleanupEnabled(newValue);
    await invoke("set_ollama_enabled", { enabled: newValue });
  };

  const handleKeyCapture = (e: React.KeyboardEvent) => {
    if (!isCapturingHotkey) return;
    e.preventDefault();
    const modifiers: string[] = [];
    if (e.metaKey) modifiers.push("Meta");
    if (e.shiftKey) modifiers.push("Shift");
    if (e.altKey) modifiers.push("Alt");
    if (e.ctrlKey) modifiers.push("Control");
    let key = e.key;
    if (key === " ") key = "Space";
    if (key.length === 1) key = key.toUpperCase();
    if (modifiers.length > 0 && !["Meta", "Shift", "Alt", "Control"].includes(key)) {
      saveHotkey({ key, modifiers });
      setIsCapturingHotkey(false);
    }
  };

  const copyText = async (text: string) => {
    try { await invoke("copy_to_clipboard", { text }); }
    catch (e) { console.error("Failed to copy:", e); }
  };

  const getStatusText = () => {
    switch (status) {
      case "recording": return "Listening...";
      case "transcribing": return "Transcribing...";
      case "cleaning": return "Processing...";
      case "ready": return "Copied to clipboard";
      default: return isModelLoaded ? formatHotkey(hotkey) : "Setup required";
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white select-none overflow-hidden">
      {/* Subtle gradient background */}
      <div className="fixed inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />

      {/* Settings button - top right */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`p-2.5 rounded-xl backdrop-blur-xl transition-all duration-200 ${
            showSettings
              ? "bg-white/10 text-white"
              : "bg-white/[0.03] text-white/40 hover:bg-white/[0.06] hover:text-white/60"
          }`}
        >
          <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        </button>
      </div>

      {/* Settings Panel - Glass UI */}
      {showSettings && (
        <div className="absolute top-14 right-4 left-4 z-10 max-h-[calc(100vh-80px)] overflow-y-auto">
          <div className="p-5 rounded-2xl bg-white/[0.03] backdrop-blur-2xl border border-white/[0.06] shadow-2xl shadow-black/50">
            {/* Model */}
            <div className="mb-6">
              <label className="block text-[10px] font-medium uppercase tracking-[0.15em] text-white/30 mb-2.5">Model Path</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={modelPath}
                  onChange={(e) => setModelPath(e.target.value)}
                  className="flex-1 px-3.5 py-2.5 bg-white/[0.03] border border-white/[0.06] rounded-xl text-[13px] text-white/80 placeholder-white/20 focus:outline-none focus:border-white/20 focus:bg-white/[0.05] transition-all"
                  placeholder="/path/to/model.bin"
                />
                <button
                  onClick={loadModel}
                  disabled={status === "transcribing"}
                  className="px-5 py-2.5 bg-white text-black rounded-xl text-[13px] font-semibold hover:bg-white/90 transition-all disabled:opacity-40"
                >
                  {isModelLoaded ? "Reload" : "Load"}
                </button>
              </div>
            </div>

            {/* Microphone Selection */}
            <div className="mb-6">
              <label className="block text-[10px] font-medium uppercase tracking-[0.15em] text-white/30 mb-2.5">Microphone</label>
              <div className="flex gap-2">
                <select
                  value={selectedDevice || ""}
                  onChange={(e) => handleDeviceSelect(e.target.value || null)}
                  className="flex-1 px-3.5 py-2.5 bg-white/[0.03] border border-white/[0.06] rounded-xl text-[13px] text-white/80 focus:outline-none focus:border-white/20 focus:bg-white/[0.05] transition-all appearance-none cursor-pointer"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='rgba(255,255,255,0.4)'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', backgroundSize: '16px' }}
                >
                  <option value="" className="bg-[#1a1a1a]">System Default</option>
                  {audioDevices.map((device) => (
                    <option key={device.id} value={device.id} className="bg-[#1a1a1a]">
                      {device.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={loadAudioDevices}
                  className="px-3 py-2.5 bg-white/[0.03] border border-white/[0.06] rounded-xl text-white/40 hover:bg-white/[0.06] hover:text-white/60 transition-all"
                  title="Refresh devices"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Toggles */}
            <div className="space-y-3">
              <Toggle
                label="AI Cleanup"
                sublabel={isOllamaAvailable ? "Connected" : "Not running"}
                enabled={aiCleanupEnabled}
                onToggle={toggleAiCleanup}
              />
              <Toggle
                label="Launch at Login"
                enabled={autoStartEnabled}
                onToggle={toggleAutoStart}
              />
              <Toggle
                label="Global Shortcut"
                sublabel={hotkeyEnabled ? formatHotkey(hotkey) : undefined}
                enabled={hotkeyEnabled}
                onToggle={() => setHotkeyEnabled(!hotkeyEnabled)}
              />
            </div>

            {/* Hotkey Capture */}
            {hotkeyEnabled && (
              <div className="mt-5 pt-5 border-t border-white/[0.06]">
                <input
                  type="text"
                  readOnly
                  onFocus={() => setIsCapturingHotkey(true)}
                  onKeyDown={handleKeyCapture}
                  onBlur={() => setIsCapturingHotkey(false)}
                  value={isCapturingHotkey ? "Press keys..." : formatHotkey(hotkey)}
                  className={`w-full px-4 py-3 rounded-xl text-[13px] text-center font-medium tracking-wide cursor-pointer caret-transparent transition-all ${
                    isCapturingHotkey
                      ? "bg-white text-black"
                      : "bg-white/[0.03] border border-white/[0.06] text-white/50 hover:border-white/20 hover:text-white/70"
                  }`}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex flex-col items-center justify-center min-h-screen px-6">
        {/* Record Button */}
        <div className="relative">
          {/* Glow effect when recording */}
          {status === "recording" && (
            <div className="absolute inset-0 rounded-full bg-white/20 blur-2xl scale-150 animate-pulse" />
          )}

          <button
            onMouseDown={handleRecordStart}
            onMouseUp={handleRecordStop}
            onMouseLeave={status === "recording" ? handleRecordStop : undefined}
            onTouchStart={handleRecordStart}
            onTouchEnd={handleRecordStop}
            disabled={!isModelLoaded || (status !== "idle" && status !== "ready")}
            className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 ${
              status === "recording"
                ? "bg-white scale-105"
                : "bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.15]"
            } disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-white/[0.04] disabled:hover:border-white/[0.08]`}
          >
            {status === "recording" ? (
              <div className="w-7 h-7 bg-[#0a0a0a] rounded-[6px]" />
            ) : status === "transcribing" || status === "cleaning" ? (
              <div className="w-6 h-6 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
            ) : (
              <svg className={`w-8 h-8 transition-colors ${isModelLoaded ? "text-white/80" : "text-white/20"}`} fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            )}
          </button>
        </div>

        {/* Status */}
        <p className={`mt-6 text-[13px] font-medium tracking-wide transition-colors ${
          status === "ready" ? "text-emerald-400" :
          status === "recording" ? "text-white" : "text-white/30"
        }`}>
          {getStatusText()}
        </p>

        {/* Error */}
        {error && (
          <p className="mt-4 text-[12px] text-red-400/80 text-center max-w-[260px]">{error}</p>
        )}

        {/* Result - Glass Card */}
        {result && (
          <div className="mt-8 w-full max-w-sm">
            <div
              onClick={() => copyText(result.cleaned_text || result.raw_text)}
              className="p-5 rounded-2xl bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] cursor-pointer hover:bg-white/[0.05] hover:border-white/[0.1] transition-all duration-200"
            >
              <p className="text-[15px] leading-[1.6] text-white/90 font-light">
                {result.cleaned_text || result.raw_text}
              </p>
              <div className="mt-4 flex items-center gap-2">
                <span className="text-[10px] font-medium uppercase tracking-[0.15em] text-white/25">
                  {result.language}
                </span>
                <span className="text-white/10">·</span>
                <span className="text-[10px] font-medium uppercase tracking-[0.15em] text-white/25">
                  Tap to copy
                </span>
              </div>
            </div>
          </div>
        )}

        {/* History */}
        {history.length > 1 && !showSettings && (
          <div className="mt-8 w-full max-w-sm">
            <div className="space-y-2">
              {history.slice(1, 4).map((item, i) => (
                <button
                  key={i}
                  onClick={() => copyText(item.cleaned_text || item.raw_text)}
                  className="w-full p-4 rounded-xl bg-white/[0.02] text-left text-[13px] text-white/40 hover:bg-white/[0.04] hover:text-white/60 transition-all duration-200 truncate"
                >
                  {item.cleaned_text || item.raw_text}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle({ label, sublabel, enabled, onToggle }: {
  label: string;
  sublabel?: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div>
        <p className="text-[13px] text-white/70">{label}</p>
        {sublabel && <p className="text-[11px] text-white/25 mt-0.5">{sublabel}</p>}
      </div>
      <button
        onClick={onToggle}
        className={`relative w-11 h-[26px] rounded-full transition-all duration-200 ${
          enabled ? "bg-white" : "bg-white/10"
        }`}
      >
        <span
          className={`absolute top-[3px] w-5 h-5 rounded-full transition-all duration-200 ${
            enabled ? "left-[22px] bg-[#0a0a0a]" : "left-[3px] bg-white/30"
          }`}
        />
      </button>
    </div>
  );
}

export default App;
