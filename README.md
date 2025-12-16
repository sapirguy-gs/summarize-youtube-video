# YouTube Video Summarizer

A full-stack application that summarizes YouTube videos by first checking for existing transcripts, and if available, providing immediate summaries. Otherwise, it downloads the audio, transcribes it, and then summarizes it.

## Features

- **Smart Transcript Detection**: Automatically checks for existing YouTube transcripts before processing
- **Fast Processing**: If a transcript exists, skips audio download and transcription steps
- **Fallback Process**: If no transcript is available, downloads audio and transcribes using local Whisper.cpp (`whisper-cli`, C++ with Metal acceleration)
- **Multi-language Support**: Supports multiple languages for both transcription and summarization
- **Beautiful UI**: Modern, responsive React frontend

## Upgrade Details

The system has been upgraded to optimize the processing flow:

### Previous Flow:
1. Get YouTube link
2. Download audio
3. Transcribe in selected language
4. Summarize in selected language

### New Optimized Flow:
1. Get YouTube link
2. **Check for existing transcript**:
   - First via `yt-dlp` + VTT parsing (fast, robust, no API keys)
   - Then, as a fallback, via the `youtube-transcript` npm package
3. **If transcript exists**: Use YouTube transcript → Summarize immediately ✨
4. **If no transcript**: Download audio → Transcribe with whisper.cpp → Summarize (full process)

This upgrade significantly reduces processing time when transcripts are available on YouTube.

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- **Ollama** installed and running (for summarization)  
  - Install from the official site: [https://ollama.com](https://ollama.com) (macOS, Windows, Linux, WSL)
- **whisper.cpp** (C++ CLI) installed for transcription  
  - Build or install from: [https://github.com/ggerganov/whisper.cpp](https://github.com/ggerganov/whisper.cpp)
  - Ensure `whisper-cli` (or `whisper-cli.exe` on Windows) is available on PATH
- **yt-dlp** and **ffmpeg** installed (for transcript/audio download)
  - **macOS**: `brew install yt-dlp ffmpeg`
  - **Windows**: `choco install yt-dlp ffmpeg` (or download manually and add to PATH)

## Installation

### Server Setup

```bash
cd server
npm install
```

Create a `.env` file in the `server` directory (optional):

```
# Ollama configuration (defaults shown)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:latest      # Default summarization model (multi-language, via Ollama)

# You can also use a specific variant, e.g.:
# OLLAMA_MODEL=qwen2.5:7b-instruct
# or other models like llama3:latest, llama3.2:latest (update this value to match what you `ollama pull`)

# Whisper.cpp model (optional, defaults to 'base')
# Options: tiny, base, small, medium, large
WHISPER_MODEL=base

# Whisper model directory (optional, auto-detected if not set)
# The server automatically searches common locations (see below)
# WHISPER_MODEL_DIR=/path/to/whisper/models

PORT=3001
```

**Note**: Make sure Ollama is installed and running on your system.

Install Ollama from the official site:

```bash
# Visit the site and follow install instructions:
# https://ollama.com
```

Start the Ollama server:
```bash
ollama serve
```

And pull the summarization model used by this app:
```bash
# Pull summarization model (default used in code)
ollama pull qwen2.5:latest

# Or explicitly pull a size-variant with strong multilingual support:
ollama pull qwen2.5:7b-instruct

# You can also use other models (llama3, mistral, etc.) but then set OLLAMA_MODEL accordingly.
```

**Important**:
- **Transcription** uses local **whisper.cpp** via the `whisper-cli` binary (C++ with Metal acceleration on Apple Silicon) – no API keys needed.
- **Summarization** uses local **Ollama** – no API keys needed.

### Whisper Model Locations

The server automatically searches for Whisper models in the following locations (in order):

**Cross-platform:**
- Project-local models folder: `./server/models/`
- User cache directory: `<home>/.cache/whisper/`

**macOS-specific:**
- `/opt/homebrew/share/whisper-cpp/models/`
- `/usr/local/share/whisper-cpp/models/`

**Windows-specific:**
- `C:\Program Files\whisper-cpp\models\`
- `C:\Program Files (x86)\whisper-cpp\models\`

You can override this behavior by setting `WHISPER_MODEL_DIR` in your `.env` file.

Download Whisper models from: [https://huggingface.co/ggerganov/whisper.cpp/tree/main](https://huggingface.co/ggerganov/whisper.cpp/tree/main)

### Client Setup

```bash
cd client
npm install
```

## Running the Application

### Start the Server

```bash
cd server
npm start
```

The server will run on `http://localhost:3001`

### Start the Client

```bash
cd client
npm run dev
```

The client will run on `http://localhost:5173` (or another port if 5173 is busy)

## Usage

1. Open the web application in your browser
2. Enter a YouTube video URL
3. Select your preferred language
4. Click "Summarize Video"
5. The system will:
   - First check for an existing transcript
   - If found, use it directly (faster!)
   - If not found, download and transcribe audio
   - Generate and display the summary

## Supported Languages

- English (en)
- Hebrew (he)
- Spanish (es)
- French (fr)
- German (de)
- Italian (it)
- Portuguese (pt)
- Russian (ru)
- Japanese (ja)
- Korean (ko)
- Chinese (zh)
- Arabic (ar)

## API Endpoints

### POST `/api/summarize`

Summarize a YouTube video.

**Request Body:**
```json
{
  "youtubeUrl": "https://www.youtube.com/watch?v=...",
  "language": "en"
}
```

**Response:**
```json
{
  "success": true,
  "videoId": "abc123",
  "language": "en",
  "usedExistingTranscript": true,
  "transcript": "...",
  "summary": "...",
  "savedTo": "2025-01-01T00-00-00-000Z-summary.txt"
}
```

### GET `/api/health`

Health check endpoint.

## Project Structure

```
summarizeYouTube/
├── server/
│   ├── server.js          # Main server file with optimized flow
│   ├── package.json       # Server dependencies
│   ├── data/              # Saved summaries
│   └── tmp/               # Temporary audio files
└── client/
    ├── src/
    │   ├── App.jsx        # Main React component
    │   ├── App.css        # Styles
    │   └── main.jsx       # React entry point
    └── package.json       # Client dependencies
```

## Dependencies

### Server
- `express` - Web framework
- `youtube-transcript` - Fallback method to fetch existing YouTube transcripts
- `axios` - HTTP client for Ollama API
- `form-data` - Handle file uploads for transcription
- `cors` - Enable CORS
- `fs-extra` - File system utilities
- **System tools (external)**:
  - `yt-dlp` – primary method to fetch subtitles/transcripts and to download audio
  - `ffmpeg` – audio conversion for whisper.cpp
  - `whisper-cli` (from **whisper.cpp**) – C++/Metal-accelerated transcription

### Client
- `react` - UI framework
- `vite` - Build tool

## Platform-Specific Installation

### macOS

1. **Install Homebrew** (if not already installed):
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. **Install dependencies**:
   ```bash
   brew install whisper-cpp yt-dlp ffmpeg
   ```

3. **Install Ollama**:
   - Visit [https://ollama.com](https://ollama.com) and download for macOS
   - Or use Homebrew: `brew install ollama`

4. **Verify installations**:
   ```bash
   whisper-cli --help
   yt-dlp --version
   ffmpeg -version
   ollama --version
   ```

### Windows

1. **Install Node.js** (if not already installed):
   - Download from [https://nodejs.org](https://nodejs.org) (v18+ recommended)
   - Verify: `node -v` and `npm -v`

2. **Install Chocolatey** (recommended package manager for Windows):
   - Visit [https://chocolatey.org/install](https://chocolatey.org/install)
   - Or run in PowerShell (as Administrator):
     ```powershell
     Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
     ```

3. **Install dependencies via Chocolatey**:
   ```powershell
   choco install yt-dlp ffmpeg -y
   ```

4. **Install whisper.cpp**:
   - Build from source: [https://github.com/ggerganov/whisper.cpp](https://github.com/ggerganov/whisper.cpp)
   - Or download pre-built binaries if available
   - Ensure `whisper-cli.exe` is in your PATH

5. **Install Ollama**:
   - Visit [https://ollama.com/download](https://ollama.com/download) and download for Windows
   - Run the installer

6. **Verify installations**:
   ```powershell
   whisper-cli --help
   yt-dlp --version
   ffmpeg -version
   ollama --version
   ```

7. **Download Whisper models**:
   - Download from [https://huggingface.co/ggerganov/whisper.cpp/tree/main](https://huggingface.co/ggerganov/whisper.cpp/tree/main)
   - Place `ggml-base.bin` (or other model) in one of the locations listed above
   - Or set `WHISPER_MODEL_DIR` in your `.env` file

## Cross-Platform Behavior

This project is designed to run on **macOS** and **Windows**. The Node.js server automatically:
- Detects the user home directory using cross-platform methods
- Resolves OS-specific paths for Whisper models
- Provides platform-aware error messages when dependencies are missing

No code changes are required per-OS - the same codebase works on both platforms.

## Notes

- **Summarization**: Uses Ollama (local LLM) - no API costs!
- **Transcription**: Uses **whisper.cpp** via `whisper-cli` (C++ / Metal-optimized on Apple Silicon) – only needed when no YouTube transcript exists
- **No API Keys Required**: Everything runs locally
- Summaries are saved in the `server/data/` directory
- Temporary audio files are stored in `server/tmp/` and automatically cleaned up
- The system will attempt to use the requested language for transcripts, but will fall back to English if the requested language is not available
- Make sure Ollama is running before starting the server
- You can change the models by setting `OLLAMA_MODEL` (summarization) and `WHISPER_MODEL` (transcription model size for whisper.cpp) in your `.env` file
- If required tools are missing, the server provides platform-specific installation guidance (macOS → Homebrew, Windows → Chocolatey or manual install)

## License

MIT
