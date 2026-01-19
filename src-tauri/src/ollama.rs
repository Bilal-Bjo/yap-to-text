use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::modes::TranscriptionMode;

const OLLAMA_API_URL: &str = "http://localhost:11434/api/generate";
const DEFAULT_MODEL: &str = "gemma2:2b";

#[derive(Debug, Serialize)]
struct OllamaRequest {
    model: String,
    prompt: String,
    system: String,
    stream: bool,
    context: Option<Vec<i32>>, // Empty context to prevent history
}

#[derive(Debug, Deserialize)]
struct OllamaResponse {
    response: String,
    done: bool,
}

#[derive(Clone)]
pub struct OllamaClient {
    client: Client,
    model: String,
    enabled: bool,
}

impl OllamaClient {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            model: DEFAULT_MODEL.to_string(),
            enabled: true,
        }
    }

    pub fn set_model(&mut self, model: &str) {
        self.model = model.to_string();
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Check if Ollama is running and the model is available
    pub async fn check_availability(&self) -> Result<bool, String> {
        let url = "http://localhost:11434/api/tags";

        match self.client.get(url).send().await {
            Ok(response) => {
                if response.status().is_success() {
                    // Check if our model is available
                    if let Ok(text) = response.text().await {
                        Ok(text.contains(&self.model) || text.contains("models"))
                    } else {
                        Ok(true) // Ollama is running, assume model is available
                    }
                } else {
                    Ok(false)
                }
            }
            Err(_) => Ok(false),
        }
    }

    /// Clean up the transcript using Ollama with the specified mode
    pub async fn cleanup_text(&self, text: &str, language: Option<&str>, mode: &str) -> Result<String, String> {
        if !self.enabled {
            return Ok(text.to_string());
        }

        if text.trim().is_empty() {
            return Ok(text.to_string());
        }

        let transcription_mode = TranscriptionMode::from_str(mode);

        // Build a prompt that explicitly states the language
        let lang_name = language.map(|l| match l {
            "fr" => "French",
            "es" => "Spanish",
            "de" => "German",
            "it" => "Italian",
            "pt" => "Portuguese",
            "nl" => "Dutch",
            "ru" => "Russian",
            "zh" => "Chinese",
            "ja" => "Japanese",
            "ko" => "Korean",
            "ar" => "Arabic",
            "en" => "English",
            _ => l,
        }).unwrap_or("the same language");

        let system_prompt = transcription_mode.get_system_prompt(lang_name);

        let prompt = match transcription_mode {
            TranscriptionMode::Default => format!(
                "Clean this {} transcript (keep in {}, do NOT translate):\n\n{}",
                lang_name, lang_name, text
            ),
            TranscriptionMode::Email => format!(
                "Format this {} transcript as a professional email (keep in {}):\n\n{}",
                lang_name, lang_name, text
            ),
            TranscriptionMode::Bullets => format!(
                "Convert this {} transcript to bullet points (keep in {}):\n\n{}",
                lang_name, lang_name, text
            ),
            TranscriptionMode::Summary => format!(
                "Summarize this {} transcript (keep in {}):\n\n{}",
                lang_name, lang_name, text
            ),
            TranscriptionMode::Slack => format!(
                "Convert this {} transcript to a casual chat message (keep in {}):\n\n{}",
                lang_name, lang_name, text
            ),
            TranscriptionMode::MeetingNotes => format!(
                "Format this {} transcript as meeting notes (keep in {}):\n\n{}",
                lang_name, lang_name, text
            ),
            TranscriptionMode::CodeComment => format!(
                "Format this {} transcript as a code comment (keep in {}):\n\n{}",
                lang_name, lang_name, text
            ),
        };

        let request = OllamaRequest {
            model: self.model.clone(),
            prompt,
            system: system_prompt,
            stream: false,
            context: Some(vec![]), // Empty context = no history
        };

        let response = self
            .client
            .post(OLLAMA_API_URL)
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                if e.is_connect() {
                    "Ollama is not running. Start Ollama or disable AI cleanup.".to_string()
                } else {
                    format!("Failed to send request to Ollama: {}", e)
                }
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Ollama returned error {}: {}", status, error_text));
        }

        let ollama_response: OllamaResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

        // Clean up the response (remove any leading/trailing whitespace or quotes)
        let cleaned = ollama_response
            .response
            .trim()
            .trim_matches('"')
            .trim()
            .to_string();

        Ok(cleaned)
    }
}

impl Default for OllamaClient {
    fn default() -> Self {
        Self::new()
    }
}

/// List of recommended models for text cleanup
pub fn get_recommended_models() -> Vec<(&'static str, &'static str)> {
    vec![
        ("gemma2:2b", "Fast, good quality (1.6GB)"),
        ("phi3:3.8b", "Better quality (2.2GB)"),
        ("llama3.1:8b", "Best quality (4.7GB)"),
        ("grmr", "Grammar-focused (experimental)"),
    ]
}
