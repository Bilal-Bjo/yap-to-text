import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface TranscribeResult {
  raw_text: string;
  cleaned_text: string;
  language: string;
  mode?: string;
  timestamp?: number;
}

interface AudioDevice {
  id: string;
  name: string;
}

interface ModeInfo {
  id: string;
  name: string;
  description: string;
  requires_ollama: boolean;
}

interface Stats {
  todayCount: number;
  sessionWords: number;
  streak: number;
}

type AppStatus = "idle" | "recording" | "transcribing" | "cleaning" | "ready";

interface HotkeyConfig {
  key: string;
  modifiers: string[];
}

const DEFAULT_HOTKEY: HotkeyConfig = { key: "Space", modifiers: ["Meta", "Shift"] };

// Mode icons as inline SVGs
const ModeIcons: Record<string, React.ReactNode> = {
  default: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
    </svg>
  ),
  email: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
    </svg>
  ),
  bullets: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
    </svg>
  ),
  summary: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  ),
  slack: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
    </svg>
  ),
  meeting_notes: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
    </svg>
  ),
  code_comment: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
    </svg>
  ),
};

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
  const [availableModes, setAvailableModes] = useState<ModeInfo[]>([]);
  const [selectedMode, setSelectedMode] = useState<string>(() => {
    return localStorage.getItem("yap-selected-mode") || "default";
  });
  const [copiedFeedback, setCopiedFeedback] = useState(false);
  const [stats, setStats] = useState<Stats>({ todayCount: 0, sessionWords: 0, streak: 1 });
  const statusRef = useRef(status);
  const isModelLoadedRef = useRef(isModelLoaded);
  const selectedModeRef = useRef(selectedMode);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { isModelLoadedRef.current = isModelLoaded; }, [isModelLoaded]);
  useEffect(() => { selectedModeRef.current = selectedMode; }, [selectedMode]);
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
    loadAvailableModes();
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

  const loadAvailableModes = async () => {
    try {
      const modes = await invoke<ModeInfo[]>("get_available_modes");
      setAvailableModes(modes);
      const savedMode = localStorage.getItem("yap-selected-mode") || "default";
      setSelectedMode(savedMode);
      selectedModeRef.current = savedMode;
      await invoke("set_mode", { mode: savedMode });
      await invoke("set_overlay_mode", { mode: savedMode });
    } catch (e) { console.error("Failed to load available modes:", e); }
  };

  const handleModeSelect = async (modeId: string) => {
    const mode = availableModes.find(m => m.id === modeId);
    if (mode?.requires_ollama && modeId !== "default" && !isOllamaAvailable) return;
    try {
      setSelectedMode(modeId);
      selectedModeRef.current = modeId;
      localStorage.setItem("yap-selected-mode", modeId);
      await invoke("set_mode", { mode: modeId });
      await invoke("set_overlay_mode", { mode: modeId });
    } catch (e) { console.error("Failed to set mode:", e); }
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
    const keySymbols: Record<string, string> = {
      MetaRight: "⌘R", MetaLeft: "⌘L",
      ShiftRight: "⇧R", ShiftLeft: "⇧L",
      AltRight: "⌥R", AltLeft: "⌥L",
      ControlRight: "⌃R", ControlLeft: "⌃L",
      Space: "Space",
    };
    const keyDisplay = keySymbols[config.key] || config.key;
    return `${config.modifiers.map((m) => modSymbols[m] || m).join("")}${keyDisplay}`;
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
      const currentMode = selectedModeRef.current;
      await invoke("start_recording");
      await invoke("set_overlay_mode", { mode: currentMode });
      await invoke("show_overlay", { overlayState: "recording", mode: currentMode });
      setTimeout(async () => {
        await invoke("set_overlay_mode", { mode: currentMode });
      }, 100);
      setStatus("recording");
    } catch (e) { setError(`Failed to start recording: ${e}`); }
  }, []);

  const handleRecordStop = useCallback(async () => {
    if (statusRef.current !== "recording") return;
    try {
      setStatus("transcribing");
      await invoke("set_overlay_state", { overlayState: "processing" });
      const wavData = await invoke<number[]>("stop_recording");
      const currentMode = selectedModeRef.current;

      // First: Transcribe audio
      const transcription = await invoke<{ text: string; language: string }>("transcribe_audio", {
        wavData: Array.from(wavData),
      });

      const rawText = transcription.text.trim();
      if (!rawText || rawText.length < 2) {
        throw new Error("Could not transcribe audio. Try speaking louder or longer.");
      }

      // Second: AI Cleanup (if enabled)
      let cleanedText = rawText;
      const ollamaEnabled = await invoke<boolean>("is_ollama_enabled");

      if (ollamaEnabled && rawText.length > 3) {
        setStatus("cleaning");
        await invoke("set_overlay_state", { overlayState: "generating" });
        try {
          const cleaned = await invoke<string>("cleanup_text", {
            text: rawText,
            language: transcription.language,
            mode: currentMode,
          });
          // Only use cleaned if it doesn't look like an error message
          if (!cleaned.includes("provide") || !cleaned.includes("transcript")) {
            cleanedText = cleaned;
          }
        } catch {
          // Fall back to raw text on cleanup error
        }
      }

      const enhancedResult: TranscribeResult = {
        raw_text: rawText,
        cleaned_text: cleanedText,
        language: transcription.language,
        mode: currentMode,
        timestamp: Date.now(),
      };
      setResult(enhancedResult);
      setHistory((prev) => [enhancedResult, ...prev.slice(0, 9)]);
      const finalText = cleanedText;
      // Update stats (simple increment)
      setStats(prev => ({
        ...prev,
        todayCount: prev.todayCount + 1,
        sessionWords: prev.sessionWords + finalText.split(/\s+/).length,
      }));
      await invoke("copy_to_clipboard", { text: finalText });
      await invoke("add_recent_transcript", { text: finalText });
      await invoke("set_overlay_state", { overlayState: "done" });
      setStatus("ready");
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

    // Use e.code to detect specific keys including left/right variants
    const code = e.code;

    // Check if this is a right-side modifier key pressed alone or as primary key
    const rightSideKeys = ["MetaRight", "ShiftRight", "AltRight", "ControlRight"];

    // Build modifiers list, excluding the key if it's being used as the primary key
    const modifiers: string[] = [];

    // If pressing a right-side key, use it as the main key with left-side modifiers
    if (rightSideKeys.includes(code)) {
      // Collect any OTHER modifiers being held
      if (e.metaKey && code !== "MetaRight") modifiers.push("Meta");
      if (e.shiftKey && code !== "ShiftRight") modifiers.push("Shift");
      if (e.altKey && code !== "AltRight") modifiers.push("Alt");
      if (e.ctrlKey && code !== "ControlRight") modifiers.push("Control");

      saveHotkey({ key: code, modifiers });
      setIsCapturingHotkey(false);
      return;
    }

    // Standard modifier detection
    if (e.metaKey) modifiers.push("Meta");
    if (e.shiftKey) modifiers.push("Shift");
    if (e.altKey) modifiers.push("Alt");
    if (e.ctrlKey) modifiers.push("Control");

    let key = e.key;
    if (key === " ") key = "Space";
    if (key.length === 1) key = key.toUpperCase();

    // Only save if we have modifiers and the key isn't itself a modifier
    if (modifiers.length > 0 && !["Meta", "Shift", "Alt", "Control"].includes(key)) {
      saveHotkey({ key, modifiers });
      setIsCapturingHotkey(false);
    }
  };

  const copyText = async (text: string) => {
    try {
      await invoke("copy_to_clipboard", { text });
      setCopiedFeedback(true);
      setTimeout(() => setCopiedFeedback(false), 1500);
    }
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

  const getWordCount = (text: string) => text.split(/\s+/).filter(w => w.length > 0).length;
  const getCharCount = (text: string) => text.length;

  const getModeIcon = (modeId: string) => {
    return ModeIcons[modeId] || ModeIcons.default;
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
        <div className="absolute top-14 right-4 left-4 z-10 max-h-[calc(100vh-80px)] overflow-y-auto animate-slideIn">
          <div className="p-5 rounded-2xl bg-white/[0.03] backdrop-blur-2xl border border-white/[0.06] shadow-2xl shadow-black/50">

            {/* Audio Section */}
            <div className="mb-6">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-400/80 mb-4 flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                </svg>
                Audio
              </h3>

              {/* Model Path */}
              <div className="mb-4">
                <label className="block text-[10px] font-medium uppercase tracking-[0.15em] text-white/30 mb-2">Model Path</label>
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
                    className="px-5 py-2.5 bg-white text-black rounded-xl text-[13px] font-semibold hover:bg-white/90 active:scale-95 transition-all disabled:opacity-40"
                  >
                    {isModelLoaded ? "Reload" : "Load"}
                  </button>
                </div>
              </div>

              {/* Microphone Selection */}
              <div>
                <label className="block text-[10px] font-medium uppercase tracking-[0.15em] text-white/30 mb-2">Microphone</label>
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
                    className="px-3 py-2.5 bg-white/[0.03] border border-white/[0.06] rounded-xl text-white/40 hover:bg-white/[0.06] hover:text-white/60 active:scale-95 transition-all"
                    title="Refresh devices"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t border-white/[0.06] my-5" />

            {/* Output Mode Section */}
            <div className="mb-6">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-400/80 mb-4 flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                </svg>
                Output Mode
              </h3>

              {/* Mode Cards Grid */}
              <div className="grid grid-cols-2 gap-2">
                {availableModes.map((mode) => {
                  const isDisabled = mode.requires_ollama && mode.id !== "default" && !isOllamaAvailable;
                  const isSelected = selectedMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      onClick={() => handleModeSelect(mode.id)}
                      disabled={isDisabled}
                      className={`relative p-3 rounded-xl text-left transition-all duration-200 ${
                        isSelected
                          ? "bg-white/[0.08] border-2 border-white/30 shadow-lg shadow-white/5"
                          : isDisabled
                          ? "bg-white/[0.02] border border-white/[0.04] opacity-50 cursor-not-allowed"
                          : "bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.12]"
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className={`p-1.5 rounded-lg ${isSelected ? "bg-cyan-400/20 text-cyan-400" : "bg-white/[0.06] text-white/40"}`}>
                          {getModeIcon(mode.id)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[12px] font-medium truncate ${isSelected ? "text-white" : "text-white/70"}`}>
                            {mode.name}
                          </p>
                          <p className="text-[10px] text-white/30 line-clamp-2 mt-0.5">
                            {mode.description}
                          </p>
                        </div>
                      </div>
                      {isDisabled && (
                        <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-amber-500/20 text-amber-400/80 text-[8px] font-medium uppercase tracking-wider rounded">
                          Ollama
                        </span>
                      )}
                      {isSelected && (
                        <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-cyan-400 rounded-full animate-pulse" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-white/[0.06] my-5" />

            {/* AI Processing Section */}
            <div className="mb-6">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-400/80 mb-4 flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                </svg>
                AI Processing
              </h3>
              <Toggle
                label="AI Cleanup"
                sublabel={isOllamaAvailable ? "Connected to Ollama" : "Ollama not running"}
                enabled={aiCleanupEnabled}
                onToggle={toggleAiCleanup}
                statusColor={isOllamaAvailable ? "green" : "red"}
              />
            </div>

            <div className="border-t border-white/[0.06] my-5" />

            {/* System Section */}
            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-400/80 mb-4 flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 0 1 1.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.559.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.894.149c-.424.07-.764.383-.929.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 0 1-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.398.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 0 1-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 0 1 .12-1.45l.773-.773a1.125 1.125 0 0 1 1.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894Z" />
                </svg>
                System
              </h3>
              <div className="space-y-3">
                <Toggle
                  label="Launch at Login"
                  enabled={autoStartEnabled}
                  onToggle={toggleAutoStart}
                />
                <Toggle
                  label="Global Shortcut"
                  sublabel={hotkeyEnabled ? formatHotkey(hotkey) : "Disabled"}
                  enabled={hotkeyEnabled}
                  onToggle={() => setHotkeyEnabled(!hotkeyEnabled)}
                />
              </div>

              {/* Hotkey Capture */}
              {hotkeyEnabled && (
                <div className="mt-4">
                  <input
                    type="text"
                    readOnly
                    onFocus={() => setIsCapturingHotkey(true)}
                    onKeyDown={handleKeyCapture}
                    onBlur={() => setIsCapturingHotkey(false)}
                    value={isCapturingHotkey ? "Press keys..." : formatHotkey(hotkey)}
                    className={`w-full px-4 py-3 rounded-xl text-[13px] text-center font-medium tracking-wide cursor-pointer caret-transparent transition-all ${
                      isCapturingHotkey
                        ? "bg-cyan-400 text-black"
                        : "bg-white/[0.03] border border-white/[0.06] text-white/50 hover:border-white/20 hover:text-white/70"
                    }`}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex flex-col min-h-screen px-6">
        {/* Record Button - Fixed at top */}
        <div className="flex flex-col items-center pt-16 pb-4 flex-shrink-0">
          <div className="relative">
          {/* Animated ring when recording */}
          {status === "recording" && (
            <>
              <div className="absolute inset-0 rounded-full bg-cyan-400/20 blur-3xl scale-150 animate-pulse" />
              <div className="absolute -inset-3 rounded-full border-2 border-cyan-400/50 animate-ping" />
              <div className="absolute -inset-2 rounded-full border border-cyan-400/30 animate-pulse" />
            </>
          )}

          <button
            onMouseDown={handleRecordStart}
            onMouseUp={handleRecordStop}
            onMouseLeave={status === "recording" ? handleRecordStop : undefined}
            onTouchStart={handleRecordStart}
            onTouchEnd={handleRecordStop}
            disabled={!isModelLoaded || (status !== "idle" && status !== "ready")}
            className={`relative w-[120px] h-[120px] rounded-full flex items-center justify-center transition-all duration-300 ${
              status === "recording"
                ? "bg-gradient-to-br from-cyan-400 to-cyan-500 scale-105 shadow-xl shadow-cyan-400/30"
                : "bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.15] active:scale-95"
            } disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-white/[0.04] disabled:hover:border-white/[0.08]`}
          >
            {status === "recording" ? (
              <div className="w-8 h-8 bg-[#0a0a0a] rounded-lg" />
            ) : status === "transcribing" || status === "cleaning" ? (
              <div className="w-8 h-8 border-3 border-white/30 border-t-cyan-400 rounded-full animate-spin" />
            ) : (
              <svg className={`w-10 h-10 transition-colors ${isModelLoaded ? "text-white/80" : "text-white/20"}`} fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            )}
          </button>
        </div>

        {/* Status */}
        <p className={`mt-6 text-[13px] font-medium tracking-wide transition-all duration-300 ${
          status === "ready" ? "text-emerald-400" :
          status === "recording" ? "text-cyan-400 animate-pulse" : "text-white/30"
        }`}>
          {getStatusText()}
        </p>

        {/* Stats bar - show when idle */}
        {(status === "idle" || status === "ready") && stats.todayCount > 0 && (
          <div className="mt-4 flex items-center gap-4 text-[11px] text-white/25 animate-fadeIn">
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
              </svg>
              {stats.todayCount} today
            </span>
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
              </svg>
              {stats.sessionWords} words
            </span>
            {stats.streak > 1 && (
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z" />
                </svg>
                {stats.streak} day streak
              </span>
            )}
          </div>
        )}

          {/* Error */}
          {error && (
            <p className="mt-4 text-[12px] text-red-400/80 text-center max-w-[260px] animate-shake">{error}</p>
          )}
        </div>

        {/* Results - Scrollable area */}
        <div className="flex-1 overflow-y-auto flex flex-col items-center">
          {/* Result - Glass Card with mode badge */}
          {result && (
            <div className="w-full max-w-sm animate-slideUp">
              <div
                onClick={() => copyText(result.cleaned_text || result.raw_text)}
                className={`relative p-5 rounded-2xl bg-white/[0.03] backdrop-blur-xl border cursor-pointer transition-all duration-200 ${
                  copiedFeedback
                    ? "border-emerald-400/50 bg-emerald-400/5"
                    : "border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.1]"
                }`}
              >
                {/* Mode badge */}
                {result.mode && (
                  <div className="absolute top-3 right-3">
                    <span className="px-2 py-1 bg-cyan-400/10 text-cyan-400/80 text-[9px] font-semibold uppercase tracking-wider rounded-md">
                      {availableModes.find(m => m.id === result.mode)?.name || result.mode}
                    </span>
                  </div>
                )}

                <p className="text-[15px] leading-[1.6] text-white/90 font-light pr-16">
                  {result.cleaned_text || result.raw_text}
                </p>

                <div className="mt-4 flex items-center gap-3">
                  <span className="text-[10px] font-medium uppercase tracking-[0.15em] text-white/25">
                    {result.language}
                  </span>
                  <span className="text-white/10">·</span>
                  <span className="text-[10px] text-white/25">
                    {getWordCount(result.cleaned_text || result.raw_text)} words
                  </span>
                  <span className="text-white/10">·</span>
                  <span className="text-[10px] text-white/25">
                    {getCharCount(result.cleaned_text || result.raw_text)} chars
                  </span>
                  <span className="ml-auto text-[10px] font-medium uppercase tracking-[0.15em] text-white/25">
                    {copiedFeedback ? "Copied!" : "Tap to copy"}
                  </span>
                </div>
              </div>
            </div>
          )}

        {/* History */}
        {history.length > 1 && !showSettings && (
          <div className="mt-6 w-full max-w-sm animate-fadeIn">
            <div className="space-y-2">
              {history.slice(1, 4).map((item, i) => (
                <button
                  key={i}
                  onClick={() => copyText(item.cleaned_text || item.raw_text)}
                  className="w-full p-4 rounded-xl bg-white/[0.02] text-left text-[13px] text-white/40 hover:bg-white/[0.04] hover:text-white/60 transition-all duration-200 truncate group relative"
                >
                  <span className="truncate block pr-16">{item.cleaned_text || item.raw_text}</span>
                  {item.mode && item.mode !== "default" && (
                    <span className="absolute top-3 right-3 px-1.5 py-0.5 bg-white/[0.05] text-white/30 text-[8px] font-medium uppercase tracking-wider rounded opacity-0 group-hover:opacity-100 transition-opacity">
                      {availableModes.find(m => m.id === item.mode)?.name || item.mode}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Toast notification */}
      {copiedFeedback && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-emerald-500/20 border border-emerald-500/30 rounded-xl text-emerald-400 text-[12px] font-medium animate-toastIn">
          Copied to clipboard
        </div>
      )}
    </div>
  );
}

function Toggle({ label, sublabel, enabled, onToggle, statusColor }: {
  label: string;
  sublabel?: string;
  enabled: boolean;
  onToggle: () => void;
  statusColor?: "green" | "red";
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div>
        <p className="text-[13px] text-white/70">{label}</p>
        {sublabel && (
          <p className="text-[11px] text-white/25 mt-0.5 flex items-center gap-1.5">
            {statusColor && (
              <span className={`w-1.5 h-1.5 rounded-full ${statusColor === "green" ? "bg-emerald-400" : "bg-red-400"}`} />
            )}
            {sublabel}
          </p>
        )}
      </div>
      <button
        onClick={onToggle}
        className={`relative w-11 h-[26px] rounded-full transition-all duration-200 ${
          enabled ? "bg-cyan-400" : "bg-white/10"
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
