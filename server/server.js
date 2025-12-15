import express from 'express';
import cors from 'cors';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { YoutubeTranscript } from 'youtube-transcript';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Ensure directories exist
const dataDir = path.join(__dirname, 'data');
const tmpDir = path.join(__dirname, 'tmp');
fs.ensureDirSync(dataDir);
fs.ensureDirSync(tmpDir);

// Serve generated files so they can be opened from the UI
app.use('/data', express.static(dataDir));
app.use('/tmp', express.static(tmpDir));

// Ollama configuration (for summarization only)
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:latest'; // Model for summarization (default to qwen2.5:latest, or use llama3:latest, llama3.2:latest)
// Note: Transcription uses local Whisper (Python package), not Ollama

// Extract video ID from YouTube URL
function extractVideoId(url) {
  const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
  return match ? match[1] : null;
}

// Map language codes to YouTube language codes (YouTube uses different codes)
const youtubeLangMap = {
  'he': 'iw',  // Hebrew
  'en': 'en',
  'es': 'es',
  'fr': 'fr',
  'de': 'de',
  'it': 'it',
  'pt': 'pt',
  'ru': 'ru',
  'ja': 'ja',
  'ko': 'ko',
  'zh': 'zh',
  'ar': 'ar'
};

// Parse VTT subtitle file and extract plain text transcript (following Python implementation)
function vttToText(vtt) {
  try {
    // Remove WEBVTT header
    vtt = vtt.replace(/^WEBVTT.*?\n\n/ms, '');
    
    const out = [];
    const lines = vtt.split(/\r?\n/);
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Skip timestamps (format: 00:00:00.000 --> 00:00:00.000)
      if (/^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*/.test(trimmed)) continue;
      
      // Skip cue numbers (pure digits)
      if (/^\d+$/.test(trimmed)) continue;
      
      // Remove tags like <c>, <i>, etc.
      const cleaned = trimmed.replace(/<[^>]+>/g, '').trim();
      if (cleaned) {
        out.push(cleaned);
      }
    }
    
    // De-dupe consecutive duplicates (common in captions)
    const deduped = [];
    let prev = null;
    for (const l of out) {
      if (l !== prev) {
        deduped.push(l);
      }
      prev = l;
    }
    
    return deduped.join('\n').trim();
  } catch (error) {
    console.error('Error parsing VTT file:', error.message);
    return null;
  }
}

// Parse SRT subtitle file and extract plain text transcript
function parseSrtToText(srtContent) {
  try {
    // SRT format: sequence number, timestamp, text, blank line
    const lines = srtContent.split(/\r?\n/);
    const textLines = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (/^\d+$/.test(line)) continue; // Skip sequence numbers
      if (/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(line)) continue; // Skip timestamps
      if (line.length > 0) {
        textLines.push(line);
      }
    }
    
    return textLines.join(' ').trim();
  } catch (error) {
    console.error('Error parsing SRT file:', error.message);
    return null;
  }
}

// Find downloaded subtitle file (following Python glob pattern logic)
function findDownloadedSubtitle(tmpDirPath, lang, format) {
  try {
    const files = fs.readdirSync(tmpDirPath);
    // yt-dlp subtitle filenames can look like: transcript.iw.vtt or transcript.iw.iw.vtt
    // Find files matching the pattern
    const candidates = files
      .filter(f => {
        const pattern = new RegExp(`^transcript.*\\.${lang}.*\\.${format}$`);
        return pattern.test(f);
      })
      .map(f => ({
        name: f,
        path: path.join(tmpDirPath, f),
        stats: fs.statSync(path.join(tmpDirPath, f))
      }))
      .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs); // Sort by modification time, newest first
    
    return candidates.length > 0 ? candidates[0].path : null;
  } catch (error) {
    console.error('Error finding subtitle file:', error.message);
    return null;
  }
}

// Get transcript using yt-dlp (following Python implementation - more reliable)
async function getTranscriptWithYtDlp(videoIdOrUrl, language = 'en') {
  try {
    const videoId = extractVideoId(videoIdOrUrl);
    if (!videoId) {
      console.error('Error: Invalid video ID or URL');
      return null;
    }
    
    // Map language code to YouTube's language code
    const youtubeLang = youtubeLangMap[language] || language;
    const subFormat = 'vtt'; // Use VTT format as per Python implementation
    
    // Use simple output base name so files start with "transcript..."
    // This produces transcript.iw.vtt OR transcript.iw.iw.vtt depending on yt-dlp
    // Use proper quoting for the output template with placeholder
    const outputTemplate = path.join(tmpDir, 'transcript.%(language)s');
    
    // Build command array - each argument as separate element for proper escaping
    const cmdParts = [
      'yt-dlp',
      '--skip-download',
      '--write-subs',
      '--sub-langs', youtubeLang,
      '--sub-format', subFormat,
      '-o', outputTemplate,
      videoIdOrUrl
    ];
    
    // Join with spaces and properly quote arguments that might have special chars
    const cmd = cmdParts.map(arg => {
      // If arg contains spaces or special chars, quote it
      if (arg.includes(' ') || arg.includes('(') || arg.includes(')')) {
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    }).join(' ');
    
    console.log(`Attempting to fetch transcript using yt-dlp with language: ${youtubeLang}`);
    console.log(`Command: ${cmd}`);
    
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        timeout: 60000, // 60 seconds timeout
        cwd: tmpDir // Run in tmpDir so output files are created there
      });
      
      if (stdout) {
        console.log('yt-dlp stdout:', stdout);
      }
      if (stderr && !stderr.includes('WARNING') && !stderr.includes('Downloading')) {
        console.log('yt-dlp stderr:', stderr);
      }
      
      // Find the downloaded VTT file (following Python glob pattern)
      const subtitlePath = findDownloadedSubtitle(tmpDir, youtubeLang, subFormat);
      
      if (subtitlePath && fs.existsSync(subtitlePath)) {
        console.log(`Found subtitle file: ${path.basename(subtitlePath)}`);
        const vttContent = fs.readFileSync(subtitlePath, 'utf-8');
        
        // Parse VTT to get plain text
        const transcriptText = vttToText(vttContent);
        
        // Clean up the subtitle file
        try {
          fs.removeSync(subtitlePath);
        } catch (err) {
          // Ignore cleanup errors
        }
        
        if (transcriptText && transcriptText.length > 0) {
          console.log(`✓ Transcript retrieved using yt-dlp (${transcriptText.length} characters)`);
          return transcriptText;
        } else {
          console.log('VTT file found but transcript text is empty after parsing');
        }
      } else {
        console.log(`No ${subFormat} file found matching transcript*.${youtubeLang}*.${subFormat}`);
        // List files for debugging
        const files = fs.readdirSync(tmpDir);
        const matchingFiles = files.filter(f => f.includes('transcript') && f.includes(youtubeLang));
        console.log('Files matching pattern:', matchingFiles);
      }
    } catch (error) {
      // Check if yt-dlp is installed
      if (error.message.includes('yt-dlp: command not found') || error.message.includes('yt-dlp') && error.code === 'ENOENT') {
        console.log('yt-dlp is not installed or not in PATH. Install with: brew install yt-dlp');
        return null;
      }
      // Check if it's a real error or just a warning
      if (error.stdout && error.stdout.includes('Writing video subtitles')) {
        // This might still succeed, continue to check for file
        console.log('yt-dlp may have succeeded despite error message, checking for output file...');
      } else {
        console.log(`yt-dlp error: ${error.message}`);
        if (error.stdout) console.log('stdout:', error.stdout);
        if (error.stderr) console.log('stderr:', error.stderr);
        return null;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error in getTranscriptWithYtDlp:', error.message);
    return null;
  }
}

// Check if YouTube transcript is available and fetch it
async function getYouTubeTranscript(videoIdOrUrl, language = 'en') {
  // First, try using yt-dlp (more reliable)
  console.log('Trying yt-dlp method first...');
  const ytDlpTranscript = await getTranscriptWithYtDlp(videoIdOrUrl, language);
  if (ytDlpTranscript && ytDlpTranscript.length > 0) {
    return ytDlpTranscript;
  }
  
  // Fallback to youtube-transcript package
  try {
    // Map language code to YouTube's language code
    const youtubeLang = youtubeLangMap[language] || language;
    
    // Try to fetch transcript with the requested language first
    let transcriptData;
    
    try {
      // Try with the mapped language code
      console.log(`Attempting to fetch YouTube transcript with youtube-transcript package (language: ${youtubeLang})`);
      transcriptData = await YoutubeTranscript.fetchTranscript(videoIdOrUrl, {
        lang: youtubeLang
      });
      console.log(`Successfully fetched transcript with language: ${youtubeLang}`);
    } catch (langError) {
      console.log(`Failed to fetch with language ${youtubeLang}: ${langError.message}`);
      
      // If specific language fails, try without language option (gets default/available transcript)
      try {
        console.log('Trying to fetch default/available transcript...');
        transcriptData = await YoutubeTranscript.fetchTranscript(videoIdOrUrl);
        console.log('Successfully fetched default transcript');
      } catch (error) {
        console.log(`Failed to fetch default transcript: ${error.message}`);
        // No transcript available
        return null;
      }
    }
    
    if (!transcriptData || transcriptData.length === 0) {
      console.log('No transcript data returned (empty array)');
      return null;
    }

    // Combine transcript text into a single string
    // The package returns: [{ text: '...', offset: 0, duration: 123 }, ...]
    const transcriptText = transcriptData
      .map(entry => {
        // Handle different possible structures
        if (typeof entry === 'string') {
          return entry;
        } else if (entry && entry.text) {
          return entry.text;
        } else if (entry && entry.transcript) {
          return entry.transcript;
        }
        return '';
      })
      .filter(text => text.trim().length > 0)
      .join(' ')
      .trim();

    if (transcriptText.length === 0) {
      console.log('Transcript text is empty after processing');
      return null;
    }

    console.log(`YouTube transcript retrieved successfully (${transcriptText.length} characters)`);
    return transcriptText;
  } catch (error) {
    // Transcript not available for this video
    console.log('YouTube transcript not available:', error.message);
    return null;
  }
}

// Download audio from YouTube using yt-dlp (audio only, not video)
async function downloadAudio(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const outputPath = path.join(tmpDir, `audio-${Date.now()}-${Math.random().toString(36).substring(7)}`);
  
  try {
    // Use yt-dlp to download audio only and convert to m4a
    // -x: extract audio only
    // --audio-format m4a: convert to m4a format
    // --no-write-playlist: don't write playlist files
    // --no-write-info-json: don't write info JSON files
    // --no-write-subs: don't write subtitles
    // --no-write-auto-subs: don't write auto-generated subtitles
    // -o: output file path
    const command = `yt-dlp -x --audio-format m4a --no-write-playlist --no-write-info-json --no-write-subs --no-write-auto-subs -o "${outputPath}.%(ext)s" "${url}"`;
    
    console.log('Running yt-dlp command:', command);
    
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });
    
    if (stderr && !stderr.includes('WARNING')) {
      console.log('yt-dlp stderr:', stderr);
    }
    
    // Clean up any extra files yt-dlp might have created (player scripts, etc.)
    const tmpFiles = fs.readdirSync(tmpDir);
    tmpFiles.forEach(file => {
      if (file.includes('player-script') || file.endsWith('.js') || file.endsWith('.json')) {
        const filePath = path.join(tmpDir, file);
        try {
          fs.removeSync(filePath);
          console.log('Cleaned up extra file:', file);
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    });
    
    // Find the actual output file (yt-dlp might add extension)
    const possiblePaths = [
      `${outputPath}.m4a`,
      `${outputPath}.mp3`,
      `${outputPath}.opus`,
      `${outputPath}.webm`
    ];
    
    let actualPath = null;
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        actualPath = possiblePath;
        break;
      }
    }
    
    // If not found, try to find any file starting with the output path
    if (!actualPath) {
      const files = fs.readdirSync(tmpDir);
      const matchingFile = files.find(f => f.startsWith(path.basename(outputPath)));
      if (matchingFile) {
        actualPath = path.join(tmpDir, matchingFile);
      }
    }
    
    if (!actualPath || !fs.existsSync(actualPath)) {
      throw new Error('Downloaded file not found. yt-dlp output: ' + stdout);
    }
    
    // Rename to .m4a if needed for consistency
    const finalPath = actualPath.endsWith('.m4a') ? actualPath : `${outputPath}.m4a`;
    if (actualPath !== finalPath) {
      fs.moveSync(actualPath, finalPath);
    }
    
    return finalPath;
  } catch (error) {
    // Check if yt-dlp is installed
    if (error.message.includes('yt-dlp: command not found') || error.code === 'ENOENT') {
      throw new Error('yt-dlp is not installed. Please install it with: brew install yt-dlp ffmpeg');
    }
    throw new Error(`Failed to download audio: ${error.message}`);
  }
}

// Transcribe audio using whisper.cpp (C++ implementation - faster on Apple Silicon with Metal GPU acceleration)
async function transcribeAudio(audioPath, language = 'en') {
  let audioFileToTranscribe = audioPath; // Track converted file for cleanup
  
  try {
    // Language mapping for whisper-cli (Hebrew is 'he' in Whisper)
    const whisperLanguageMap = {
      'en': 'en',
      'he': 'he',  // Hebrew
      'es': 'es',
      'fr': 'fr',
      'de': 'de',
      'it': 'it',
      'pt': 'pt',
      'ru': 'ru',
      'ja': 'ja',
      'ko': 'ko',
      'zh': 'zh',
      'ar': 'ar'
    };
    
    const whisperLang = whisperLanguageMap[language] || 'auto'; // Use 'auto' if language not in map
    
    // Use whisper.cpp (C++ implementation) for faster transcription on Apple Silicon with Metal acceleration
    // Model path - check common locations
    const whisperModel = process.env.WHISPER_MODEL || 'base'; // base, small, medium, large
    const modelDir = process.env.WHISPER_MODEL_DIR || path.join(process.env.HOME || '/tmp', '.cache', 'whisper');
    let modelPath = path.join(modelDir, `ggml-${whisperModel}.bin`);
    
    // Check if model exists, if not, try alternative locations
    if (!fs.existsSync(modelPath)) {
      console.log(`Model not found at ${modelPath}, checking alternative locations...`);
      // Try common model locations
      const alternativePaths = [
        `/opt/homebrew/share/whisper-cpp/models/ggml-${whisperModel}.bin`,
        `/usr/local/share/whisper-cpp/models/ggml-${whisperModel}.bin`,
        path.join(__dirname, 'models', `ggml-${whisperModel}.bin`),
        path.join(process.env.HOME || '/tmp', '.cache', 'whisper', `ggml-${whisperModel}.bin`)
      ];
      
      let foundModel = false;
      for (const altPath of alternativePaths) {
        if (fs.existsSync(altPath)) {
          modelPath = altPath;
          foundModel = true;
          console.log(`Found model at: ${modelPath}`);
          break;
        }
      }
      
      if (!foundModel) {
        throw new Error(`Whisper model not found. Please download ggml-${whisperModel}.bin from https://huggingface.co/ggerganov/whisper.cpp/tree/main and place it in ${modelDir} or set WHISPER_MODEL_DIR environment variable.`);
      }
    }
    
    // whisper-cli only supports: flac, mp3, ogg, wav
    // Convert m4a to wav if needed using ffmpeg
    const outputDir = path.dirname(audioPath);
    const outputBase = path.basename(audioPath, path.extname(audioPath));
    const audioExt = path.extname(audioPath).toLowerCase();
    let audioFileToTranscribe = audioPath;
    
    // Convert to wav if not already in a supported format
    if (audioExt === '.m4a' || audioExt === '.aac' || audioExt === '.webm') {
      const wavPath = path.join(outputDir, `${outputBase}.wav`);
      console.log(`Converting ${audioExt} to WAV format for whisper-cli...`);
      const convertCommand = `ffmpeg -i "${audioPath}" -ar 16000 -ac 1 -f wav "${wavPath}" -y`;
      
      try {
        await execAsync(convertCommand, {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 300000 // 5 minutes for conversion
        });
        audioFileToTranscribe = wavPath;
        console.log('Audio converted to WAV:', wavPath);
      } catch (convertError) {
        throw new Error(`Failed to convert audio to WAV format: ${convertError.message}`);
      }
    }
    
    // whisper-cli command format: whisper-cli -m model.bin audiofile -otxt -of outputfile -l language
    // Metal acceleration is automatically enabled on Apple Silicon (M3 Pro) for much faster transcription
    const outputFile = path.join(outputDir, outputBase);
    const command = `whisper-cli -m "${modelPath}" "${audioFileToTranscribe}" -otxt -of "${outputFile}" -l ${whisperLang}`;
    
    console.log(`Running whisper.cpp (C++ with Metal acceleration) command with language ${whisperLang}:`, command);
    
    // Run Whisper command - it may output warnings to stderr but still succeed
    // We'll check for the output file rather than relying on exit code
    let stdout = '';
    let stderr = '';
    
    try {
      const result = await execAsync(command, {
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for long transcriptions
        timeout: 600000 // 10 minutes timeout for transcription
      });
      stdout = result.stdout || '';
      stderr = result.stderr || '';
    } catch (execError) {
      // execAsync throws an error if exit code is non-zero
      // But Whisper might output warnings to stderr and still succeed
      stdout = execError.stdout || '';
      stderr = execError.stderr || '';
      
      console.log('whisper-cli command output (exit code may be non-zero due to warnings):');
      if (stdout) console.log('stdout:', stdout);
      if (stderr) console.log('stderr:', stderr);
      
      // Check if it's an actual error (not just warnings)
      // whisper-cli may output initialization messages to stderr but still succeed
      const hasRealError = stderr.includes('Error:') && 
                          !stderr.includes('UserWarning') &&
                          !stderr.includes('FP16 is not supported') &&
                          !stderr.includes('whisper_init') && // whisper-cli initialization messages
                          !stderr.includes('ggml_metal'); // Metal GPU initialization messages
      
      if (hasRealError || stderr.includes('Traceback') || stderr.includes('Exception:')) {
        console.error('whisper-cli encountered a real error:', stderr);
        // Still continue to check if file was created - sometimes whisper-cli creates the file despite errors
      } else {
        console.log('whisper-cli output (may include Metal GPU initialization messages - normal)');
      }
    }
    
    // whisper-cli creates a .txt file with the specified output name (-of flag)
    let transcriptPath = path.join(outputDir, `${outputBase}.txt`);
    
    // Wait for file to be written (Whisper might take time to finish writing)
    // Check every second for up to 30 seconds
    let attempts = 0;
    const maxAttempts = 30;
    while (!fs.existsSync(transcriptPath) && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
      if (attempts % 5 === 0) {
        console.log(`Waiting for Whisper output file... (${attempts}/${maxAttempts} seconds)`);
      }
    }
    
    if (!fs.existsSync(transcriptPath)) {
      // List files in the directory to debug
      const dir = path.dirname(audioPath);
      const files = fs.readdirSync(dir);
      const audioBaseName = path.basename(audioPath, path.extname(audioPath));
      const matchingFiles = files.filter(f => f.includes(audioBaseName));
      
      console.error('Expected transcript file not found:', transcriptPath);
      console.error('Audio file:', audioPath);
      console.error('Audio base name:', audioBaseName);
      console.error('All files in directory:', files);
      console.error('Files matching audio name:', matchingFiles);
      
      // Check if there's a file with a different extension
      const possibleFiles = matchingFiles.filter(f => 
        f.endsWith('.txt') || f.endsWith('.srt') || f.endsWith('.vtt')
      );
      
      if (possibleFiles.length > 0) {
        console.log('Found possible transcript files:', possibleFiles);
        // Use the first matching file
        transcriptPath = path.join(dir, possibleFiles[0]);
        console.log('Using found transcript file:', transcriptPath);
      } else {
        throw new Error(`whisper-cli did not create transcript file after ${attempts} seconds. Check if whisper-cpp is installed: brew install whisper-cpp. Also ensure the model file (ggml-${whisperModel}.bin) is downloaded. Files in directory: ${files.join(', ')}`);
      }
    }
    
    // Read the transcript
    const transcription = fs.readFileSync(transcriptPath, 'utf-8').trim();
    
    // Clean up temporary files
    fs.removeSync(audioPath);
    // Clean up converted WAV file if it was created
    if (audioFileToTranscribe !== audioPath && fs.existsSync(audioFileToTranscribe)) {
      fs.removeSync(audioFileToTranscribe);
    }
    if (fs.existsSync(transcriptPath)) {
      fs.removeSync(transcriptPath);
    }
    
    // Also clean up any other Whisper output files (srt, vtt, json, etc.)
    const basePath = audioPath.replace(/\.[^/.]+$/, '');
    const possibleExtensions = ['.srt', '.vtt', '.json'];
    possibleExtensions.forEach(ext => {
      const extraFile = basePath + ext;
      if (fs.existsSync(extraFile)) {
        fs.removeSync(extraFile);
      }
    });
    
    if (!transcription || transcription.length === 0) {
      throw new Error('Transcription returned empty result. The audio file might be corrupted or too short.');
    }
    
    return transcription;
  } catch (error) {
    // Clean up temporary audio file even on error
    if (audioPath && fs.existsSync(audioPath)) {
      fs.removeSync(audioPath);
    }
    
    // Clean up converted WAV file if it was created
    if (audioFileToTranscribe !== audioPath && fs.existsSync(audioFileToTranscribe)) {
      fs.removeSync(audioFileToTranscribe);
    }
    
    // Check if whisper-cli is installed
    if (error.message.includes('whisper-cli: command not found') || error.code === 'ENOENT') {
      throw new Error('whisper-cli is not installed. Please install it with: brew install whisper-cpp');
    }
    
    // Check if ffmpeg is installed (needed for audio conversion)
    if (error.message.includes('ffmpeg: command not found') || error.message.includes('Failed to convert audio')) {
      throw new Error('ffmpeg is not installed. Please install it with: brew install ffmpeg');
    }
    
    throw new Error(`Failed to transcribe audio: ${error.message}`);
  }
}

// Summarize text using Ollama
async function summarizeText(text, language = 'en') {
  const languageNames = {
    'en': 'English',
    'he': 'Hebrew',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'pt': 'Portuguese',
    'ru': 'Russian',
    'ja': 'Japanese',
    'ko': 'Korean',
    'zh': 'Chinese',
    'ar': 'Arabic'
  };
  
  const langName = languageNames[language] || 'English';
  
  // Clean the transcript - remove metadata lines and keep only actual speech
  const cleanedText = text.split('\n')
    .filter(line => {
      // Remove lines that are just metadata or timestamps
      const trimmed = line.trim();
      return trimmed.length > 0 && 
             !trimmed.match(/^\([^)]*\)$/) && // Remove lines like "(speaking in foreign language)"
             !trimmed.match(/^\[.*\]$/) && // Remove lines like "[timestamp]"
             !trimmed.match(/^[0-9]{2}:[0-9]{2}$/) && // Remove time stamps
             !trimmed.match(/^[0-9]+\s*$/); // Remove just numbers
    })
    .join('\n')
    .trim();
  
  // If cleaned text is too short or empty, use original
  const textToSummarize = cleanedText.length > 50 ? cleanedText : text;
  
  // Improved prompt - works better with qwen2.5 for Hebrew
  let prompt;
  if (language === 'he') {
    // Hebrew-specific prompt - very explicit about Hebrew only
    prompt = `אתה עוזר AI. התמלול הבא הוא בעברית. אתה חייב לסכם אותו בעברית בלבד.

חשוב מאוד: כתוב את הסיכום בעברית בלבד. אל תכתוב באנגלית, יפנית, סינית, ספרדית, גרמנית או שפה אחרת. רק עברית.

הסיכום צריך להיות מפורט ומקיף, לכסות את כל הנושאים העיקריים שנדונו בראיון.

התמלול:
${textToSummarize.substring(0, 12000)}${textToSummarize.length > 12000 ? '...' : ''}

סיכום בעברית בלבד:`;
  } else {
    // English and other languages
    prompt = `Please provide a comprehensive summary of the following transcript in ${langName}. 
The summary should be well-structured, cover all main points, and be written entirely in ${langName}.
Do not include timestamps, metadata, or technical details. Focus on the actual content and meaning.

Transcript:
${textToSummarize.substring(0, 8000)}${textToSummarize.length > 8000 ? '...' : ''}

Summary in ${langName}:`;
  }

  try {
    const response = await axios.post(`${OLLAMA_BASE_URL}/api/generate`, {
      model: OLLAMA_MODEL,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.3, // Lower temperature for more focused, consistent summaries (especially for Hebrew)
        num_predict: 5000, // Increased for longer, more detailed summaries
        top_p: 0.9, // Better quality with qwen2.5
        repeat_penalty: 1.1 // Reduce repetition
      }
    }, {
      timeout: 180000 // 3 minutes timeout for longer transcripts
    });
    
    let summaryText = response.data.response || '';
    
    // Clean up the summary - remove any metadata or unwanted prefixes
    summaryText = summaryText.trim();
    
    // Remove common prefixes that models sometimes add
    const prefixesToRemove = [
      'Summary:',
      'Summary in',
      'Here is the summary:',
      'Here\'s the summary:',
      'The summary is:',
      'תקציר:',
      'סיכום:',
      'סיכום בעברית:',
      'סיכום בעברית בלבד:'
    ];
    
    for (const prefix of prefixesToRemove) {
      if (summaryText.startsWith(prefix)) {
        summaryText = summaryText.substring(prefix.length).trim();
      }
    }
    
    // For Hebrew, filter out non-Hebrew content (Chinese, Japanese, etc.)
    if (language === 'he') {
      // Split by lines and filter out lines with too many non-Hebrew characters
      const lines = summaryText.split('\n');
      const cleanedLines = lines.filter(line => {
        const trimmed = line.trim();
        if (trimmed.length === 0) return false;
        
        // Count Hebrew characters
        const hebrewChars = (trimmed.match(/[\u0590-\u05FF]/g) || []).length;
        // Count non-Hebrew, non-English, non-punctuation characters (likely Chinese/Japanese)
        const foreignChars = (trimmed.match(/[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
        
        // Keep line if it has Hebrew characters and not too many foreign characters
        return hebrewChars > 0 && foreignChars < trimmed.length * 0.3;
      });
      
      summaryText = cleanedLines.join('\n').trim();
      
      // If we filtered out too much, use original but log warning
      if (summaryText.length < response.data.response.length * 0.5) {
        console.warn('Warning: Filtered summary is much shorter, may contain mixed languages');
      }
    }
    
    // If summary is too short or looks like it might be metadata, try to extract better content
    if (summaryText.length < 50) {
      console.warn('Summary seems too short, using original response');
      summaryText = response.data.response || '';
    }
    
    return summaryText;
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error(`Failed to connect to Ollama at ${OLLAMA_BASE_URL}. Make sure Ollama is running.`);
    }
    if (error.response?.status === 404) {
      throw new Error(`Ollama model "${OLLAMA_MODEL}" not found. Available models: qwen2.5:latest, llama3:latest, llama3.2:latest. Install with: ollama pull ${OLLAMA_MODEL}`);
    }
    throw new Error(`Failed to generate summary: ${error.message}`);
  }
}

// Main endpoint with Server-Sent Events for progress updates
app.post('/api/summarize', async (req, res) => {
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const sendProgress = (stage, status, data = {}) => {
    const message = JSON.stringify({ stage, status, ...data });
    res.write(`data: ${message}\n\n`);
  };
  
  try {
    const { youtubeUrl, language = 'en', forceAudioDownload = false } = req.body;
    
    if (!youtubeUrl) {
      sendProgress('error', 'error', { error: 'YouTube URL is required' });
      return res.end();
    }
    
    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      sendProgress('error', 'error', { error: 'Invalid YouTube URL' });
      return res.end();
    }
    
    console.log(`Processing video: ${videoId} in language: ${language}, forceAudioDownload: ${forceAudioDownload}`);
    
    let audioPath = null;
    let transcript = null;
    let summary = null;
    let transcriptFilePath = null;
    let summaryFilePath = null;
    let usedYouTubeTranscript = false;
    
    try {
      // Step 0: Check if YouTube transcript is available (unless forced to download audio)
      if (!forceAudioDownload) {
        console.log('Step 0: Checking for YouTube transcript...');
        sendProgress('download', 'processing', { message: 'Checking for YouTube transcript...' });
        transcript = await getYouTubeTranscript(youtubeUrl, language);
        
        if (transcript && transcript.trim().length > 0) {
          // YouTube transcript is available - skip download and transcription
          usedYouTubeTranscript = true;
          console.log('YouTube transcript found! Skipping download and transcription.');
          sendProgress('download', 'skipped', { 
            message: 'Skipped - Using YouTube transcript'
          });
          sendProgress('transcribe', 'skipped', { 
            message: 'Skipped - Using YouTube transcript'
          });
        
          // Save transcript to file
          const transcriptTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const transcriptFilename = `${transcriptTimestamp}-transcript.txt`;
          transcriptFilePath = path.join(dataDir, transcriptFilename);
          fs.writeFileSync(transcriptFilePath, transcript, 'utf-8');
          console.log('YouTube transcript saved to:', transcriptFilename);
          sendProgress('transcribe', 'completed', { 
            message: 'YouTube transcript retrieved',
            transcriptFilePath: transcriptFilename,
            usedYouTubeTranscript: true
          });
        } else {
          // No YouTube transcript available - proceed with download and transcription
          console.log('No YouTube transcript available. Proceeding with audio download and transcription.');
          sendProgress('download', 'processing', { message: 'No YouTube transcript found. Downloading audio...' });
        }
      } else {
        // Force audio download - skip transcript check
        console.log('Force audio download enabled. Skipping YouTube transcript check.');
        sendProgress('download', 'processing', { message: 'Downloading audio (forced)...' });
      }
      
      // If we don't have a transcript yet, proceed with download and transcription
      if (!transcript || transcript.trim().length === 0) {
        // Step 1: Download audio
        console.log('Step 1: Downloading audio...');
        audioPath = await downloadAudio(videoId);
        console.log('Audio downloaded to:', audioPath);
        sendProgress('download', 'completed', { 
          message: 'Audio downloaded',
          audioPath: path.basename(audioPath)
        });
        
        // Step 2: Transcribe audio
        console.log('Step 2: Transcribing audio...');
        sendProgress('transcribe', 'processing', { message: 'Transcribing audio...' });
        transcript = await transcribeAudio(audioPath, language);
        
        if (!transcript || transcript.trim().length === 0) {
          sendProgress('error', 'error', { error: 'Failed to get transcript' });
          return res.end();
        }
        
        // Save transcript to file
        const transcriptTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const transcriptFilename = `${transcriptTimestamp}-transcript.txt`;
        transcriptFilePath = path.join(dataDir, transcriptFilename);
        fs.writeFileSync(transcriptFilePath, transcript, 'utf-8');
        console.log('Transcript saved to:', transcriptFilename);
        sendProgress('transcribe', 'completed', { 
          message: 'Audio transcribed',
          transcriptFilePath: transcriptFilename
        });
      }
      
      // Step 3: Summarize the transcript
      console.log('Step 3: Summarizing transcript...');
      sendProgress('summarize', 'processing', { message: 'Summarizing transcript...' });
      summary = await summarizeText(transcript, language);
      
      // Step 4: Save summary to file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}-summary.txt`;
      summaryFilePath = path.join(dataDir, filename);
      
      const output = `YouTube URL: ${youtubeUrl}
Language: ${language}
Timestamp: ${new Date().toISOString()}

=== TRANSCRIPT ===
${transcript}

=== SUMMARY ===
${summary}
`;
      
      fs.writeFileSync(summaryFilePath, output, 'utf-8');
      console.log(`Summary saved to: ${filename}`);
      sendProgress('summarize', 'completed', { 
        message: 'Transcript summarized',
        summaryFilePath: filename,
        summary: summary // Include summary in progress update
      });
      
      // Send final result - include all data
      sendProgress('complete', 'success', {
        success: true,
        videoId,
        language,
        usedYouTubeTranscript,
        audioPath: audioPath ? path.basename(audioPath) : null,
        transcript: transcript.substring(0, 500) + '...',
        transcriptFilePath: transcriptFilePath ? path.basename(transcriptFilePath) : null,
        summary,
        summaryFilePath: filename,
        savedTo: filename,
        // Include all previous data to ensure nothing is lost
        ...(audioPath ? { audioPath: path.basename(audioPath) } : {}),
        ...(transcriptFilePath ? { transcriptFilePath: path.basename(transcriptFilePath) } : {}),
        ...(filename ? { summaryFilePath: filename } : {})
      });
      
      res.end();
      
    } catch (error) {
      console.error('Error processing video:', error);
      console.error('Error stack:', error.stack);
      sendProgress('error', 'error', {
        error: 'Failed to process video',
        message: error.message || 'Unknown error occurred',
        progress: {
          audioDownloaded: !!audioPath,
          transcribed: !!transcript,
          summarized: !!summary
        }
      });
      res.end();
    }
  } catch (error) {
    console.error('Error processing video:', error);
    console.error('Error stack:', error.stack);
    sendProgress('error', 'error', {
      error: 'Failed to process video',
      message: error.message || 'Unknown error occurred'
    });
    res.end();
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Ollama URL: ${OLLAMA_BASE_URL}`);
  console.log(`Ollama Model (Summarization): ${OLLAMA_MODEL}`);
  console.log(`Transcription: Using local Whisper (Python package)`);
  console.log(`Summarization: Using local Ollama - no API keys needed!`);
});
