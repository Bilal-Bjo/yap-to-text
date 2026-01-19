use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::io::Cursor;
use hound::{WavSpec, WavWriter};

/// Represents an audio input device
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
}

/// Shared recording state that is Send + Sync
pub struct RecordingState {
    pub samples: Arc<Mutex<Vec<f32>>>,
    pub is_recording: Arc<AtomicBool>,
    pub sample_rate: Arc<Mutex<u32>>,
    pub selected_device_id: Arc<Mutex<Option<String>>>,
}

impl RecordingState {
    pub fn new() -> Self {
        Self {
            samples: Arc::new(Mutex::new(Vec::new())),
            is_recording: Arc::new(AtomicBool::new(false)),
            sample_rate: Arc::new(Mutex::new(16000)),
            selected_device_id: Arc::new(Mutex::new(None)),
        }
    }
}

impl Default for RecordingState {
    fn default() -> Self {
        Self::new()
    }
}

/// Start recording from the selected input device (or default if none selected)
/// Returns immediately, recording happens in background
pub fn start_recording(state: &RecordingState) -> Result<(), String> {
    if state.is_recording.load(Ordering::SeqCst) {
        return Err("Already recording".to_string());
    }

    // Clear previous samples
    {
        let mut samples = state.samples.lock().unwrap();
        samples.clear();
    }

    let host = cpal::default_host();

    // Get selected device or fall back to default
    let selected_id = {
        let selected = state.selected_device_id.lock().unwrap();
        selected.clone()
    };

    let device = if let Some(device_id) = selected_id {
        // Find the device by name/ID
        host.input_devices()
            .map_err(|e| format!("Failed to enumerate input devices: {}", e))?
            .find(|d| d.name().map(|n| n == device_id).unwrap_or(false))
            .ok_or_else(|| format!("Selected device '{}' not found", device_id))?
    } else {
        // Use default device
        host.default_input_device()
            .ok_or("No input device available")?
    };

    // Get supported config closest to 16kHz mono
    let supported_config = device
        .supported_input_configs()
        .map_err(|e| format!("Error getting supported configs: {}", e))?
        .find(|c| c.channels() == 1)
        .or_else(|| {
            device
                .supported_input_configs()
                .ok()?
                .next()
        })
        .ok_or("No supported input config")?;

    let config = supported_config.with_max_sample_rate();

    {
        let mut sample_rate = state.sample_rate.lock().unwrap();
        *sample_rate = config.sample_rate().0;
    }

    let samples_clone = Arc::clone(&state.samples);
    let is_recording_for_callback = Arc::clone(&state.is_recording);
    let is_recording_for_loop = Arc::clone(&state.is_recording);
    let channels = config.channels() as usize;

    // Set recording flag before starting
    state.is_recording.store(true, Ordering::SeqCst);

    // Build and start stream in a separate thread
    std::thread::spawn(move || {
        let stream = device
            .build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if !is_recording_for_callback.load(Ordering::SeqCst) {
                        return;
                    }

                    let mut samples = samples_clone.lock().unwrap();
                    // If stereo, convert to mono by averaging channels
                    if channels > 1 {
                        for chunk in data.chunks(channels) {
                            let mono = chunk.iter().sum::<f32>() / channels as f32;
                            samples.push(mono);
                        }
                    } else {
                        samples.extend_from_slice(data);
                    }
                },
                |err| {
                    eprintln!("Audio stream error: {}", err);
                },
                None,
            )
            .expect("Failed to build input stream");

        stream.play().expect("Failed to start stream");

        // Keep stream alive while recording
        while is_recording_for_loop.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        // Stream is automatically dropped here
    });

    Ok(())
}

/// Stop recording and return WAV data
pub fn stop_recording(state: &RecordingState) -> Result<Vec<u8>, String> {
    if !state.is_recording.load(Ordering::SeqCst) {
        return Err("Not recording".to_string());
    }

    // Signal to stop recording
    state.is_recording.store(false, Ordering::SeqCst);

    // Wait a bit for the recording thread to finish
    std::thread::sleep(std::time::Duration::from_millis(100));

    let samples = {
        let samples = state.samples.lock().unwrap();
        samples.clone()
    };

    if samples.is_empty() {
        return Err("No audio recorded".to_string());
    }

    let sample_rate = {
        let sr = state.sample_rate.lock().unwrap();
        *sr
    };

    // Resample to 16kHz if needed (Whisper requirement)
    let resampled = if sample_rate != 16000 {
        resample(&samples, sample_rate, 16000)
    } else {
        samples
    };

    // Convert to WAV bytes
    samples_to_wav(&resampled)
}

fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    let ratio = to_rate as f64 / from_rate as f64;
    let new_len = (samples.len() as f64 * ratio) as usize;
    let mut resampled = Vec::with_capacity(new_len);

    for i in 0..new_len {
        let src_idx = i as f64 / ratio;
        let src_idx_floor = src_idx.floor() as usize;
        let src_idx_ceil = (src_idx_floor + 1).min(samples.len() - 1);
        let frac = src_idx - src_idx_floor as f64;

        let sample = samples[src_idx_floor] * (1.0 - frac as f32)
            + samples[src_idx_ceil] * frac as f32;
        resampled.push(sample);
    }

    resampled
}

fn samples_to_wav(samples: &[f32]) -> Result<Vec<u8>, String> {
    let spec = WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = WavWriter::new(&mut cursor, spec)
            .map_err(|e| format!("Failed to create WAV writer: {}", e))?;

        for &sample in samples {
            // Convert f32 [-1.0, 1.0] to i16
            let sample_i16 = (sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
            writer
                .write_sample(sample_i16)
                .map_err(|e| format!("Failed to write sample: {}", e))?;
        }

        writer
            .finalize()
            .map_err(|e| format!("Failed to finalize WAV: {}", e))?;
    }

    Ok(cursor.into_inner())
}

pub fn is_recording(state: &RecordingState) -> bool {
    state.is_recording.load(Ordering::SeqCst)
}

/// Get list of available audio input devices
pub fn get_input_devices() -> Vec<AudioDevice> {
    let host = cpal::default_host();
    let mut devices = Vec::new();

    if let Ok(input_devices) = host.input_devices() {
        for device in input_devices {
            if let Ok(name) = device.name() {
                devices.push(AudioDevice {
                    id: name.clone(),
                    name,
                });
            }
        }
    }

    devices
}

/// Set the selected input device by ID
pub fn set_input_device(state: &RecordingState, device_id: Option<String>) {
    let mut selected = state.selected_device_id.lock().unwrap();
    *selected = device_id;
}

/// Get the currently selected input device ID
pub fn get_selected_device(state: &RecordingState) -> Option<String> {
    let selected = state.selected_device_id.lock().unwrap();
    selected.clone()
}
