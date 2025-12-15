import { fileURLToPath } from 'url';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const tmpDir = join(__dirname, 'tmp');

// Map language codes
const youtubeLangMap = {
  'he': 'iw',
  'en': 'en'
};

// Parse SRT to text
function parseSrtToText(srtContent) {
  try {
    const lines = srtContent.split(/\r?\n/);
    const textLines = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (/^\d+$/.test(line)) continue;
      if (/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(line)) continue;
      if (line.length > 0) {
        textLines.push(line);
      }
    }
    
    return textLines.join(' ').trim();
  } catch (error) {
    console.error('Error parsing SRT:', error.message);
    return null;
  }
}

// Extract video ID
function extractVideoId(url) {
  const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
  return match ? match[1] : null;
}

async function testYtDlpTranscript(videoIdOrUrl, language = 'en') {
  const videoId = extractVideoId(videoIdOrUrl);
  if (!videoId) {
    console.error('Invalid video ID or URL');
    return null;
  }
  
  const youtubeLang = youtubeLangMap[language] || language;
  const outputPath = join(tmpDir, `test-subtitle-${Date.now()}`);
  const command = `yt-dlp --skip-download --write-subs --sub-langs "${youtubeLang}" --sub-format "srt" --output "${outputPath}.%(ext)s" "${videoIdOrUrl}"`;
  
  console.log(`\nTesting yt-dlp transcript fetch for: ${videoId}`);
  console.log(`Language: ${youtubeLang} (original: ${language})`);
  console.log(`Command: ${command}\n`);
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000
    });
    
    if (stderr && !stderr.includes('WARNING')) {
      console.log('yt-dlp stderr:', stderr);
    }
    
    // Find SRT file
    const files = readdirSync(tmpDir);
    const srtFile = files.find(f => 
      f.startsWith(basename(outputPath)) && 
      (f.endsWith(`.${youtubeLang}.srt`) || f.endsWith('.srt'))
    );
    
    if (srtFile) {
      const srtPath = join(tmpDir, srtFile);
      const srtContent = readFileSync(srtPath, 'utf-8');
      const transcriptText = parseSrtToText(srtContent);
      
      console.log(`✓ SRT file found: ${srtFile}`);
      console.log(`✓ Transcript length: ${transcriptText ? transcriptText.length : 0} characters`);
      
      if (transcriptText) {
        console.log(`\nPreview (first 500 chars):\n${transcriptText.substring(0, 500)}...`);
        return transcriptText;
      }
    } else {
      console.log('✗ No SRT file found');
      console.log('Files in tmp dir:', files.filter(f => f.includes(basename(outputPath))));
    }
    
    return null;
  } catch (error) {
    console.error(`✗ Error: ${error.message}`);
    return null;
  }
}

// Test with the provided video
const testVideo = 'https://www.youtube.com/watch?v=IY2ZfZpmSfI';
testYtDlpTranscript(testVideo, 'he').then(result => {
  if (result) {
    console.log('\n✓ SUCCESS: Transcript retrieved!');
  } else {
    console.log('\n✗ FAILED: Could not retrieve transcript');
  }
  process.exit(result ? 0 : 1);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});

