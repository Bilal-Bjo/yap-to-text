use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptionMode {
    Default,
    Email,
    Bullets,
    Summary,
    Slack,
    MeetingNotes,
    CodeComment,
}

impl TranscriptionMode {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "email" => Self::Email,
            "bullets" => Self::Bullets,
            "summary" => Self::Summary,
            "slack" => Self::Slack,
            "meeting_notes" => Self::MeetingNotes,
            "code_comment" => Self::CodeComment,
            _ => Self::Default,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Email => "email",
            Self::Bullets => "bullets",
            Self::Summary => "summary",
            Self::Slack => "slack",
            Self::MeetingNotes => "meeting_notes",
            Self::CodeComment => "code_comment",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Default => "Default",
            Self::Email => "Email",
            Self::Bullets => "Bullet Points",
            Self::Summary => "Summary",
            Self::Slack => "Slack Message",
            Self::MeetingNotes => "Meeting Notes",
            Self::CodeComment => "Code Comment",
        }
    }

    pub fn description(&self) -> &'static str {
        match self {
            Self::Default => "Clean up grammar and filler words",
            Self::Email => "Format as professional email",
            Self::Bullets => "Convert to organized bullet points",
            Self::Summary => "Condense into a brief summary",
            Self::Slack => "Short, casual chat message",
            Self::MeetingNotes => "Structure with key points and action items",
            Self::CodeComment => "Format as code documentation",
        }
    }

    pub fn get_system_prompt(&self, language_name: &str) -> String {
        match self {
            Self::Default => format!(
                r#"You are a transcript cleaner that NEVER translates. You clean up speech transcripts by removing filler words and fixing grammar while keeping the EXACT SAME LANGUAGE as the input. If input is {lang}, output {lang}. NEVER change the language. Output ONLY the cleaned text."#,
                lang = language_name
            ),
            Self::Email => format!(
                r#"You are a professional email formatter that NEVER translates. Format this transcript as a professional email with an appropriate greeting, well-structured body paragraphs, and a professional closing. Keep the EXACT SAME LANGUAGE as the input ({lang}). NEVER change the language. Output ONLY the formatted email, nothing else."#,
                lang = language_name
            ),
            Self::Bullets => format!(
                r#"You are a content organizer that NEVER translates. Convert this transcript into clear, organized bullet points. Extract key points and use concise language. Keep the EXACT SAME LANGUAGE as the input ({lang}). NEVER change the language. Output ONLY the bullet list using • or - markers, nothing else."#,
                lang = language_name
            ),
            Self::Summary => format!(
                r#"You are a summarizer that NEVER translates. Condense this transcript into a brief summary capturing the main points. Be concise but comprehensive. Keep the EXACT SAME LANGUAGE as the input ({lang}). NEVER change the language. Output ONLY the summary, nothing else."#,
                lang = language_name
            ),
            Self::Slack => format!(
                r#"You are a chat message formatter that NEVER translates. Convert this transcript into a short, casual message suitable for Slack or chat. Keep it friendly and concise. Keep the EXACT SAME LANGUAGE as the input ({lang}). NEVER change the language. Output ONLY the message, nothing else."#,
                lang = language_name
            ),
            Self::MeetingNotes => format!(
                r#"You are a meeting notes formatter that NEVER translates. Structure this transcript as meeting notes with:
- Key Discussion Points
- Decisions Made
- Action Items (if any)
Keep the EXACT SAME LANGUAGE as the input ({lang}). NEVER change the language. Output ONLY the formatted notes, nothing else."#,
                lang = language_name
            ),
            Self::CodeComment => format!(
                r#"You are a code documentation formatter that NEVER translates. Format this transcript as a code documentation comment. Use appropriate format (JSDoc, docstring, etc. based on content). Be technical and precise. Keep the EXACT SAME LANGUAGE as the input ({lang}). NEVER change the language. Output ONLY the formatted comment, nothing else."#,
                lang = language_name
            ),
        }
    }

    pub fn requires_ollama(&self) -> bool {
        // All modes require Ollama for formatting, but default can fall back to raw text
        true
    }

    pub fn all_modes() -> Vec<Self> {
        vec![
            Self::Default,
            Self::Email,
            Self::Bullets,
            Self::Summary,
            Self::Slack,
            Self::MeetingNotes,
            Self::CodeComment,
        ]
    }
}

impl Default for TranscriptionMode {
    fn default() -> Self {
        Self::Default
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ModeInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub requires_ollama: bool,
}

impl From<TranscriptionMode> for ModeInfo {
    fn from(mode: TranscriptionMode) -> Self {
        Self {
            id: mode.as_str().to_string(),
            name: mode.display_name().to_string(),
            description: mode.description().to_string(),
            requires_ollama: mode.requires_ollama(),
        }
    }
}

pub fn get_available_modes() -> Vec<ModeInfo> {
    TranscriptionMode::all_modes()
        .into_iter()
        .map(ModeInfo::from)
        .collect()
}
