# 🎤 yap-to-text

> *"I used to be an adventurer like you, then I took a subscription fee to the knee."*
>
> — Every voice-to-text user before discovering this app

**A 100% free, 100% local, 100% "your-voice-never-leaves-your-Mac" speech-to-text app.** Like Wispr Flow, but without the monthly fee that costs more than your Netflix subscription.

![macOS](https://img.shields.io/badge/macOS-000000?style=flat&logo=apple&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=flat&logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React-000000?style=flat&logo=react&logoColor=61DAFB)
![License](https://img.shields.io/badge/License-MIT-green.svg)

---

## 🤔 What is this sorcery?

You know how you have brilliant thoughts in the shower but forget them by the time you find a keyboard? Or how you write emails that sound like a robot because typing kills your vibe?

**yap-to-text** lets you just... talk. Hold a hotkey, yap away, release, and boom — your words appear as text, cleaned up and ready to paste. No cloud. No subscription. No "we're sending your voice to our servers for *totally not suspicious* reasons."

### Features

- 🎙️ **Hold-to-record** — Press your hotkey, speak, release. That's it. Even your cat could do it.
- 🧠 **AI cleanup** — Removes your "umms", "uhhs", and "like, you know" moments (we all have them)
- 🎨 **7 Output Modes** — Transform your speech into different formats:
  - **Default** — Clean up grammar and filler words
  - **Email** — Format as a professional email
  - **Bullets** — Convert to organized bullet points
  - **Summary** — Condense into a brief summary
  - **Slack** — Short, casual chat message
  - **Meeting Notes** — Structure with key points and action items
  - **Code Comment** — Format as code documentation
- 🌍 **99+ languages** — Parlez-vous français? Sprechen Sie Deutsch? 日本語? We got you.
- 🔒 **100% offline** — Your voice stays on your Mac. The NSA will have to find another hobby.
- 📋 **Auto-copy & paste** — Text is copied and auto-pasted faster than you can blink
- 🖥️ **Sleek overlay** — Shows mode, animated waveform, and status at the bottom of your screen
- 📌 **Menu bar app** — Lives quietly in your menu bar, ready when you need it
- 🎚️ **Microphone selection** — Choose your input device from settings, no more "wrong mic" moments
- 📜 **Persistent history** — Your transcripts survive app restarts, because memory shouldn't be optional
- 📊 **Session stats** — Track your transcription count and word count

---

## 🛠️ Prerequisites (One-time Setup)

Before we begin, you'll need to sacrifice some disk space to the dependency gods:

### 1. Install Rust 🦀

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Follow the prompts. When it asks about installation options, just hit Enter like you're accepting terms and conditions you didn't read.

### 2. Install Node.js 📦

```bash
brew install node
```

Don't have Homebrew? First, question your life choices. Then install it:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 3. Install Ollama 🦙 (Optional, for AI cleanup)

```bash
brew install ollama
```

Then pull the smol brain model:
```bash
ollama pull gemma2:2b
```

This 1.6GB model will clean up your transcripts. Skip this if you want raw, unfiltered yapping.

### 4. Download a Whisper Model 🤫

Create the models directory and download a model:

```bash
mkdir -p ~/Library/Application\ Support/yap-to-text/models
cd ~/Library/Application\ Support/yap-to-text/models

# Choose your fighter:

# Tiny (75MB) - Fast but accuracy go brrr
curl -L -o ggml-tiny.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin

# Base (142MB) - The Goldilocks zone (recommended)
curl -L -o ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin

# Small (466MB) - For when you want accuracy but still have places to be
curl -L -o ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin

# Medium (1.5GB) - Maximum accuracy, "I have time" energy
curl -L -o ggml-medium.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin
```

---

## 🚀 Installation

### Option 1: Build from source (for the brave)

```bash
# Clone this bad boy
git clone https://github.com/Bilal-Bjo/yap-to-text.git
cd yap-to-text

# Install frontend dependencies
npm install

# Build the app (grab a coffee, this takes a minute)
npm run tauri build

# The app will be at:
# src-tauri/target/release/bundle/macos/yap-to-text.app
```

### Option 2: Download release (for the wise)

Check the [Releases](https://github.com/Bilal-Bjo/yap-to-text/releases) page and download the `.dmg` file. Double-click, drag to Applications, done. You've peaked.

---

## 🎮 How to Use

### First Launch

1. **Open the app** — It'll appear in your menu bar (look for the icon up top)
2. **Load a Whisper model** — Click the settings gear, enter your model path:
   ```
   /Users/YOUR_USERNAME/Library/Application Support/yap-to-text/models/ggml-base.bin
   ```
3. **Select your microphone** — Choose your preferred input device from the dropdown (or leave as "System Default")
4. **Choose your output mode** — Pick from 7 different modes in the visual card grid
5. **Set your hotkey** — Default is `⌘⇧Space`, but you do you
6. **(Optional) Start Ollama** — Run `ollama serve` in a terminal for AI cleanup and modes

### Daily Usage

1. **Select a mode** — Click a mode card (Email, Bullets, Summary, etc.)
2. **Hold your hotkey** — A sleek pill overlay appears showing your selected mode
3. **Talk** — Say whatever's on your mind
4. **Release** — Watch the magic happen:
   - 🎤 Recording (waveform animation) → ⚙️ Processing → ✅ Copied & Pasted!
5. **Done** — Your text is auto-pasted where your cursor is

### Pro Tips

- The app auto-loads your model on startup after the first time
- Enable "Launch at Login" in settings for maximum laziness
- Your transcript history persists across app restarts — your last result is always there
- Click the refresh button next to the microphone dropdown if you plug in a new device
- Works in any language Whisper supports (which is basically all of them)
- The overlay shows your current mode with a colored icon — no guessing which mode you're in
- Modes other than Default require Ollama to be running

---

## 🏗️ How It Works (for the nerds)

```
┌─────────────────────────────────────────────────────────┐
│                    Your Beautiful Voice                  │
└─────────────────────────┬───────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│                 Audio Capture (cpal)                     │
│           Records your voice locally via mic             │
└─────────────────────────┬───────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Whisper.cpp (via whisper-rs)                │
│     Transcribes audio to text, detects language          │
│              All running on YOUR machine                 │
└─────────────────────────┬───────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│                 Ollama (gemma2:2b)                       │
│    Transforms text based on selected mode:               │
│    Email, Bullets, Summary, Slack, Meeting Notes, etc.   │
│              Still on YOUR machine, paranoid friend      │
└─────────────────────────┬───────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│                      Clipboard                           │
│              Ready to paste anywhere                     │
└─────────────────────────────────────────────────────────┘
```

### Tech Stack

| Component | Technology | Why |
|-----------|------------|-----|
| Framework | Tauri 2.0 | Tiny bundle (~10MB), native performance, Rust backend |
| Frontend | React + TypeScript | It's 2025, we're not savages |
| Speech-to-Text | whisper.cpp (whisper-rs) | Fastest on Apple Silicon, Metal acceleration |
| AI Cleanup | Ollama + gemma2:2b | Free, local, actually good |
| Audio | cpal | Cross-platform audio capture |
| Styling | Tailwind CSS | For that premium dark mode aesthetic |

---

## 🐛 Troubleshooting

### "Ollama is not running"
```bash
ollama serve
```
Leave this terminal open or Ollama takes a nap.

### "Please load a Whisper model first"
Go to settings, enter the full path to your model file. Yes, the full path. Yes, including your username.

### Audio not recording
Go to **System Settings → Privacy & Security → Microphone** and make sure yap-to-text is allowed. Apple is protective like that.

### The app won't open (macOS Gatekeeper)
Right-click the app → Open → Open anyway. Or:
```bash
xattr -cr /Applications/yap-to-text.app
```

---

## 🤝 Contributing

Found a bug? Want a feature? Think my code is trash?

1. Fork it
2. Branch it (`git checkout -b feature/amazing-feature`)
3. Commit it (`git commit -m 'Add some amazing feature'`)
4. Push it (`git push origin feature/amazing-feature`)
5. PR it

---

## 📜 License

MIT License — Do whatever you want with it. Start a company. Print it out and make origami. I don't care, I'm not your mom.

---

## 🙏 Acknowledgments

- [OpenAI Whisper](https://github.com/openai/whisper) — For the actual magic
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) — For making it fast
- [Tauri](https://tauri.app/) — For not being Electron
- [Ollama](https://ollama.ai/) — For local LLMs that don't phone home
- [Wispr Flow](https://wisprflow.ai/) — For the inspiration (and the motivation to not pay $10/month)
- Coffee — For everything else

---

<p align="center">
  <i>Made with 🎤 and mass amounts of mass</i>
</p>

<p align="center">
  <i>"Talk is cheap. Transcription shouldn't be."</i>
</p>
