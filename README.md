# YouTube Video Summarizer

A full-stack application that summarizes YouTube videos by first checking for existing transcripts, and if available, providing immediate summaries. Otherwise, it downloads the audio, transcribes it, and then summarizes it.

## Features

- **Smart Transcript Detection**: Automatically checks for existing YouTube transcripts before processing
- **Fast Processing**: If a transcript exists, skips audio download and transcription steps
- **Fallback Process**: If no transcript is available, downloads audio and transcribes using local Whisper (Python package)
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
2. **Check for existing transcript** (using `youtube-transcript-api`)
3. **If transcript exists**: Download transcript → Summarize immediately ✨
4. **If no transcript**: Download audio → Transcribe → Summarize (full process)

This upgrade significantly reduces processing time when transcripts are available on YouTube.

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Ollama installed and running (for summarization)
- Whisper (Python package) installed for transcription: `pip install openai-whisper`
- yt-dlp installed: `brew install yt-dlp ffmpeg`

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
OLLAMA_MODEL=llama2              # Model for summarization

# Whisper model (optional, defaults to 'base')
# Options: tiny, base, small, medium, large
WHISPER_MODEL=base

PORT=3001
```

**Note**: Make sure Ollama is running on your system. You can start it with:
```bash
ollama serve
```

And pull the summarization model:
```bash
# Pull summarization model
ollama pull llama2
# or any other model you prefer (llama3, mistral, etc.)
```

**Install Whisper for transcription:**
```bash
pip install openai-whisper
# or
pip3 install openai-whisper
```

**Important**: 
- Transcription uses local Whisper (Python package) - no API keys needed!
- Summarization uses local Ollama - no API keys needed!

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
- `youtube-transcript` - Fetch existing YouTube transcripts
- `ytdl-core` - Download YouTube audio
- `axios` - HTTP client for Ollama API
- `form-data` - Handle file uploads for transcription
- `cors` - Enable CORS
- `fs-extra` - File system utilities

### Client
- `react` - UI framework
- `vite` - Build tool

## Notes

- **Summarization**: Uses Ollama (local LLM) - no API costs!
- **Transcription**: Uses local Whisper (Python package) - only needed when no YouTube transcript exists
- **No API Keys Required**: Everything runs locally
- Summaries are saved in the `server/data/` directory
- Temporary audio files are stored in `server/tmp/` and automatically cleaned up
- The system will attempt to use the requested language for transcripts, but will fall back to English if the requested language is not available
- Make sure Ollama is running before starting the server
- You can change the models by setting `OLLAMA_MODEL` (summarization) and `OLLAMA_WHISPER_MODEL` (transcription) in your `.env` file

## License

MIT
