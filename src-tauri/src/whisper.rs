use std::path::PathBuf;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct WhisperTranscriber {
    context: Option<WhisperContext>,
    model_path: PathBuf,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub language: String,
}

impl WhisperTranscriber {
    pub fn new(model_path: PathBuf) -> Self {
        Self {
            context: None,
            model_path,
        }
    }

    pub fn load_model(&mut self) -> Result<(), String> {
        if self.context.is_some() {
            return Ok(());
        }

        if !self.model_path.exists() {
            return Err(format!(
                "Model file not found: {}",
                self.model_path.display()
            ));
        }

        let ctx = WhisperContext::new_with_params(
            self.model_path.to_str().unwrap(),
            WhisperContextParameters::default(),
        )
        .map_err(|e| format!("Failed to load Whisper model: {}", e))?;

        self.context = Some(ctx);
        Ok(())
    }

    pub fn transcribe(&self, audio_data: &[f32]) -> Result<TranscriptionResult, String> {
        let ctx = self
            .context
            .as_ref()
            .ok_or("Model not loaded. Call load_model() first")?;

        let mut state = ctx
            .create_state()
            .map_err(|e| format!("Failed to create state: {}", e))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

        // Configure for best results
        params.set_language(None); // Auto-detect language
        params.set_translate(false); // Keep original language
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);
        params.set_suppress_non_speech_tokens(true);

        // Run transcription
        state
            .full(params, audio_data)
            .map_err(|e| format!("Transcription failed: {}", e))?;

        // Collect results
        let num_segments = state.full_n_segments().map_err(|e| format!("Failed to get segments: {}", e))?;
        let mut text = String::new();

        for i in 0..num_segments {
            if let Ok(segment) = state.full_get_segment_text(i) {
                text.push_str(&segment);
                text.push(' ');
            }
        }

        // Get detected language
        let language = state
            .full_lang_id_from_state()
            .ok()
            .and_then(|id| whisper_rs::get_lang_str(id).map(|s| s.to_string()))
            .unwrap_or_else(|| "unknown".to_string());

        Ok(TranscriptionResult {
            text: text.trim().to_string(),
            language,
        })
    }

    pub fn is_model_loaded(&self) -> bool {
        self.context.is_some()
    }
}

/// Convert WAV bytes to f32 samples at 16kHz
pub fn wav_to_samples(wav_data: &[u8]) -> Result<Vec<f32>, String> {
    let cursor = std::io::Cursor::new(wav_data);
    let mut reader = hound::WavReader::new(cursor)
        .map_err(|e| format!("Failed to read WAV: {}", e))?;

    let spec = reader.spec();

    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => {
            reader.samples::<f32>()
                .filter_map(|s| s.ok())
                .collect()
        }
        hound::SampleFormat::Int => {
            let max_val = (1 << (spec.bits_per_sample - 1)) as f32;
            reader.samples::<i32>()
                .filter_map(|s| s.ok())
                .map(|s| s as f32 / max_val)
                .collect()
        }
    };

    Ok(samples)
}

/// Get the default models directory
pub fn get_models_dir() -> PathBuf {
    let mut path = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    path.push("yap-to-text");
    path.push("models");
    path
}

/// Get available model sizes
pub fn get_available_models() -> Vec<(&'static str, &'static str, u64)> {
    vec![
        ("tiny", "ggml-tiny.bin", 75_000_000),
        ("base", "ggml-base.bin", 142_000_000),
        ("small", "ggml-small.bin", 466_000_000),
        ("medium", "ggml-medium.bin", 1_500_000_000),
    ]
}
