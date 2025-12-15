import { useState } from 'react';

function App() {
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [language, setLanguage] = useState('en');
  const [forceAudioDownload, setForceAudioDownload] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({
    download: 'grey', // grey, orange, green, skipped
    transcribe: 'grey',
    summarize: 'grey'
  });
  const [progressMessages, setProgressMessages] = useState({
    download: '',
    transcribe: '',
    summarize: ''
  });

  const languages = [
    { code: 'en', name: 'English' },
    { code: 'he', name: 'Hebrew', rtl: true },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'ru', name: 'Russian' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'zh', name: 'Chinese' },
    { code: 'ar', name: 'Arabic', rtl: true }
  ];

  // Check if current language is RTL
  const isRTL = languages.find(l => l.code === language)?.rtl || false;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult({}); // Initialize as empty object to allow incremental updates
    
    // Reset progress
    setProgress({
      download: 'grey',
      transcribe: 'grey',
      summarize: 'grey'
    });
    setProgressMessages({
      download: '',
      transcribe: '',
      summarize: ''
    });

    try {
      // Use EventSource for Server-Sent Events (SSE) to get real-time progress
      const response = await fetch('http://localhost:3001/api/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          youtubeUrl,
          language,
          forceAudioDownload
        })
      });

      if (!response.ok) {
        throw new Error('Failed to start processing');
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          // Stream ended - check if we have a complete result
          if (result && Object.keys(result).length > 0 && result.summary) {
            // We have a complete result, ensure loading is false
            setLoading(false);
          } else if (!error) {
            // Stream ended unexpectedly - might be an error
            console.warn('Stream ended unexpectedly');
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.stage === 'error' || data.status === 'error') {
                setError(data.error || data.message || 'Failed to process video');
                setLoading(false);
                // Don't break - keep processing to show error
                continue;
              }
              
              if (data.stage === 'complete' && data.status === 'success') {
                // Final result - merge with existing result to preserve incremental updates
                setResult(prev => ({ ...prev, ...data }));
                setProgress({
                  download: 'green',
                  transcribe: 'green',
                  summarize: 'green'
                });
                setLoading(false);
                // Don't return - let the loop finish naturally
                continue;
              }
              
              // Update progress based on stage
              if (data.stage === 'download') {
                const status = data.status === 'completed' ? 'green' : 
                              data.status === 'processing' ? 'orange' : 
                              data.status === 'skipped' ? 'skipped' : 'grey';
                setProgress(prev => ({
                  ...prev,
                  download: status
                }));
                setProgressMessages(prev => ({
                  ...prev,
                  download: data.message || ''
                }));
                if (data.audioPath) {
                  setResult(prev => ({ ...prev, audioPath: data.audioPath }));
                }
              } else if (data.stage === 'transcribe') {
                const status = data.status === 'completed' ? 'green' : 
                              data.status === 'processing' ? 'orange' : 
                              data.status === 'skipped' ? 'skipped' : 'grey';
                setProgress(prev => ({
                  ...prev,
                  transcribe: status
                }));
                setProgressMessages(prev => ({
                  ...prev,
                  transcribe: data.message || ''
                }));
                if (data.transcriptFilePath) {
                  setResult(prev => ({ ...prev, transcriptFilePath: data.transcriptFilePath }));
                }
                if (data.usedYouTubeTranscript) {
                  setResult(prev => ({ ...prev, usedYouTubeTranscript: true }));
                }
              } else if (data.stage === 'summarize') {
                setProgress(prev => ({
                  ...prev,
                  summarize: data.status === 'completed' ? 'green' : data.status === 'processing' ? 'orange' : 'grey'
                }));
                setProgressMessages(prev => ({
                  ...prev,
                  summarize: data.message || ''
                }));
                if (data.summaryFilePath) {
                  setResult(prev => ({ ...prev, summaryFilePath: data.summaryFilePath }));
                }
                // Update summary if provided in progress update
                if (data.summary) {
                  setResult(prev => ({ ...prev, summary: data.summary }));
                }
              }
            } catch (parseError) {
              console.error('Error parsing SSE data:', parseError, line);
            }
          }
        }
      }
    } catch (err) {
      // Display the actual error message
      let errorMessage = 'Failed to process video';
      
      if (err.message) {
        errorMessage = err.message;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
      console.error('Error details:', err);
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
}

.app {
  min-height: 100vh;
  padding: 2rem;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.container {
  background: white;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  padding: 2.5rem;
  width: 100%;
  max-width: 1200px;
  margin: 2rem auto;
}

h1 {
  color: #333;
  margin-bottom: 0.5rem;
  font-size: 2.5rem;
  text-align: center;
}

.subtitle {
  color: #666;
  text-align: center;
  margin-bottom: 2rem;
  line-height: 1.6;
  font-size: 0.95rem;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-weight: 600;
  color: #333;
  font-size: 0.95rem;
}

.form-group input,
.form-group select {
  padding: 0.75rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 1rem;
  transition: border-color 0.3s;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #667eea;
}

.form-group input:disabled,
.form-group select:disabled {
  background-color: #f5f5f5;
  cursor: not-allowed;
}

.submit-button {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  padding: 1rem 2rem;
  border-radius: 8px;
  font-size: 1.1rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  margin-top: 0.5rem;
}

.submit-button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 10px 20px rgba(102, 126, 234, 0.4);
}

.submit-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.loading {
  margin-top: 2rem;
  text-align: center;
}

.spinner {
  border: 4px solid #f3f3f3;
  border-top: 4px solid #667eea;
  border-radius: 50%;
  width: 50px;
  height: 50px;
  animation: spin 1s linear infinite;
  margin: 0 auto 1rem;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.error {
  background: #fee;
  border: 2px solid #fcc;
  border-radius: 8px;
  padding: 1.5rem;
  margin-top: 2rem;
  color: #c33;
}

.error h3 {
  margin-bottom: 0.5rem;
  color: #a00;
}

.result {
  margin-top: 2rem;
  padding: 2rem;
  background: #f8f9fa;
  border-radius: 12px;
  border: 1px solid #e0e0e0;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #e0e0e0;
}

.result-header h2 {
  color: #333;
  font-size: 1.8rem;
}

.result-info {
  margin-bottom: 2rem;
  padding: 1rem;
  background: white;
  border-radius: 8px;
}

.result-info p {
  margin-bottom: 0.5rem;
  color: #666;
  font-size: 0.95rem;
}

.result-info strong {
  color: #333;
  margin-right: 0.5rem;
}

.result-section {
  margin-bottom: 2rem;
}

.result-section h3 {
  color: #333;
  margin-bottom: 1rem;
  font-size: 1.3rem;
}

.summary-content {
  background-color: #f8f9fa;
  padding: 1.5rem;
  border-radius: 8px;
  line-height: 1.8;
  color: #333;
}

.summary-content p {
  margin-bottom: 1rem;
}

/* RTL text support for Hebrew and Arabic */
.rtl-text {
  direction: rtl;
  text-align: right;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Arial Hebrew', 'Noto Sans Hebrew', sans-serif;
}

.rtl-text p {
  text-align: right;
  direction: rtl;
}

.transcript-preview {
  background-color: #f8f9fa;
  padding: 1.5rem;
  border-radius: 8px;
  color: #666;
  font-size: 0.9rem;
  line-height: 1.6;
  max-height: 200px;
  overflow-y: auto;
}

.transcript-preview.rtl-text {
  direction: rtl;
  text-align: right;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Arial Hebrew', 'Noto Sans Hebrew', sans-serif;
}

/* Progress Stages - Horizontal Layout */
.progress-stages-horizontal {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 16px;
  margin-top: 2rem;
  width: 100%;
  max-width: 1000px;
  margin-left: auto;
  margin-right: auto;
  flex-wrap: nowrap;
}

.progress-stage-horizontal {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  border-radius: 12px;
  min-width: 0;
  flex: 1 1 0;
  transition: all 0.3s ease-in-out;
  position: relative;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.stage-indicator-horizontal {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: all 0.3s ease-in-out;
}

.stage-content-horizontal {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.stage-label-horizontal {
  font-weight: 600;
  font-size: 0.95rem;
}

.stage-file-horizontal {
  font-size: 0.8rem;
  color: #666;
  font-weight: normal;
  word-break: break-all;
}

.stage-message-horizontal {
  font-size: 0.75rem;
  color: #888;
  font-weight: normal;
  font-style: italic;
}

.progress-connector {
  width: 32px;
  height: 3px;
  margin: 0 8px;
  transition: all 0.3s ease-in-out;
  flex-shrink: 0;
}

/* Stage States - Grey (not started) */
.progress-stage-horizontal.grey .stage-indicator-horizontal {
  background-color: #e0e0e0;
  border: 2px solid #ccc;
}

.progress-stage-horizontal.grey {
  background-color: #f5f5f5;
  color: #888;
  border: 2px solid #ddd;
}

.progress-connector.grey {
  background-color: #e0e0e0;
}

/* Stage States - Orange (processing) */
.progress-stage-horizontal.orange .stage-indicator-horizontal {
  background-color: #ff9800;
  border: 2px solid #f57c00;
  animation: pulse-orange 1.5s infinite ease-in-out;
}

.progress-stage-horizontal.orange {
  background-color: #fff3e0;
  color: #e65100;
  border: 2px solid #ffb74d;
  animation: pulse-orange-bg 1.5s infinite ease-in-out;
}

.progress-connector.orange {
  background-color: #ff9800;
  animation: pulse-orange 1.5s infinite ease-in-out;
}

@keyframes pulse-orange {
  0% { 
    transform: scale(1); 
    box-shadow: 0 0 0 rgba(255, 152, 0, 0.7); 
  }
  50% { 
    transform: scale(1.1); 
    box-shadow: 0 0 15px rgba(255, 152, 0, 0.9); 
  }
  100% { 
    transform: scale(1); 
    box-shadow: 0 0 0 rgba(255, 152, 0, 0.7); 
  }
}

@keyframes pulse-orange-bg {
  0%, 100% { 
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); 
  }
  50% { 
    box-shadow: 0 4px 16px rgba(255, 152, 0, 0.3); 
  }
}

/* Stage States - Green (completed) */
.progress-stage-horizontal.green .stage-indicator-horizontal {
  background-color: #4caf50;
  border: 2px solid #388e3c;
}

.progress-stage-horizontal.green .stage-indicator-horizontal::after {
  content: '✓';
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 14px;
  font-weight: bold;
  width: 100%;
  height: 100%;
}

.progress-stage-horizontal.green {
  background-color: #e8f5e9;
  color: #2e7d32;
  border: 2px solid #81c784;
}

.progress-connector.green {
  background-color: #4caf50;
}

/* Stage States - Skipped */
.progress-stage-horizontal.skipped .stage-indicator-horizontal {
  background-color: #9e9e9e;
  border: 2px solid #757575;
}

.progress-stage-horizontal.skipped .stage-indicator-horizontal::after {
  content: '⊘';
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 14px;
  font-weight: bold;
  width: 100%;
  height: 100%;
}

.progress-stage-horizontal.skipped {
  background-color: #f5f5f5;
  color: #757575;
  border: 2px solid #bdbdbd;
  opacity: 0.7;
}

.progress-connector.skipped {
  background-color: #9e9e9e;
}

@media (max-width: 768px) {
  .container {
    padding: 1.5rem;
    margin-top: 1rem;
  }

  h1 {
    font-size: 2rem;
  }

  .result-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .progress-stages-horizontal {
    flex-direction: column;
    gap: 16px;
  }

  .progress-connector {
    width: 3px;
    height: 40px;
    margin: 0;
  }

  .progress-stage-horizontal {
    width: 100%;
    min-width: unset;
  }
}
      `}</style>
      <div className="app">
      <div className="container">
        <h1>YouTube Video Summarizer</h1>
        <p className="subtitle">
          Get instant summaries of YouTube videos. Downloads audio, transcribes, and summarizes using local Ollama models.
        </p>

        <form onSubmit={handleSubmit} className="form">
          <div className="form-group">
            <label htmlFor="youtubeUrl">YouTube URL</label>
            <input
              type="text"
              id="youtubeUrl"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="language">Language</label>
            <select
              id="language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={loading}
            >
              {languages.map(lang => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={forceAudioDownload}
                onChange={(e) => setForceAudioDownload(e.target.checked)}
                disabled={loading}
                style={{ cursor: 'pointer' }}
              />
              <span>Force audio download (even if YouTube transcript is available)</span>
            </label>
          </div>

          <button 
            type="submit" 
            disabled={loading || !youtubeUrl}
            className="submit-button"
          >
            {loading ? 'Processing...' : 'Summarize Video'}
          </button>
        </form>

        {(loading || (result && Object.keys(result).length > 0 && progress.summarize !== 'green') || error) && (
          <div className="loading">
            <div className="progress-stages-horizontal">
              <div className={`progress-stage-horizontal ${progress.download}`}>
                <div className="stage-indicator-horizontal"></div>
                <div className="stage-content-horizontal">
                  <span className="stage-label-horizontal">1. Download Audio</span>
                  {progressMessages.download && (
                    <span className="stage-message-horizontal">{progressMessages.download}</span>
                  )}
                  {result && result.audioPath && (
                    <span className="stage-file-horizontal">✓ {result.audioPath}</span>
                  )}
                </div>
              </div>
              
              <div className="progress-connector"></div>
              
              <div className={`progress-stage-horizontal ${progress.transcribe}`}>
                <div className="stage-indicator-horizontal"></div>
                <div className="stage-content-horizontal">
                  <span className="stage-label-horizontal">2. Transcribe</span>
                  {progressMessages.transcribe && (
                    <span className="stage-message-horizontal">{progressMessages.transcribe}</span>
                  )}
                  {result && result.transcriptFilePath && (
                    <span className="stage-file-horizontal">✓ {result.transcriptFilePath}</span>
                  )}
                </div>
              </div>
              
              <div className="progress-connector"></div>
              
              <div className={`progress-stage-horizontal ${progress.summarize}`}>
                <div className="stage-indicator-horizontal"></div>
                <div className="stage-content-horizontal">
                  <span className="stage-label-horizontal">3. Summarize</span>
                  {result && result.summaryFilePath && (
                    <span className="stage-file-horizontal">✓ {result.summaryFilePath}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="error">
            <h3>Error</h3>
            <p>{error}</p>
          </div>
        )}

        {result && Object.keys(result).length > 0 && (() => {
          // Use result language for RTL detection (more accurate than current selection)
          const resultLanguage = result.language || language;
          const resultIsRTL = languages.find(l => l.code === resultLanguage)?.rtl || false;
          
          return (
            <div className="result" dir={resultIsRTL ? 'rtl' : 'ltr'}>
              <div className="result-header">
                <h2>Summary Result</h2>
              </div>

              <div className="result-info">
                <p><strong>Video ID:</strong> {result.videoId}</p>
                <p><strong>Language:</strong> {languages.find(l => l.code === resultLanguage)?.name || resultLanguage}</p>
                {result.audioPath && (
                  <p>
                    <strong>Audio File:</strong>{' '}
                    <a 
                      href={`http://localhost:3001/tmp/${result.audioPath}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                    >
                      {result.audioPath}
                    </a>
                  </p>
                )}
                {result.transcriptFilePath && (
                  <p>
                    <strong>Transcript File:</strong>{' '}
                    <a 
                      href={`http://localhost:3001/data/${result.transcriptFilePath}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                    >
                      {result.transcriptFilePath}
                    </a>
                  </p>
                )}
                {result.summaryFilePath && (
                  <p>
                    <strong>Summary File:</strong>{' '}
                    <a 
                      href={`http://localhost:3001/data/${result.summaryFilePath}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                    >
                      {result.summaryFilePath}
                    </a>
                  </p>
                )}
              </div>

              {result.summary && (
                <div className="result-section">
                  <h3>Summary</h3>
                  <div className={`summary-content ${resultIsRTL ? 'rtl-text' : ''}`} dir={resultIsRTL ? 'rtl' : 'ltr'}>
                    {result.summary.split('\n').map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </div>
                </div>
              )}

              {result.transcript && (
                <div className="result-section">
                  <h3>Transcript Preview</h3>
                  <div className={`transcript-preview ${resultIsRTL ? 'rtl-text' : ''}`} dir={resultIsRTL ? 'rtl' : 'ltr'}>
                    {result.transcript}...
                  </div>
                </div>
              )}
            </div>
          );
        })(        )}
      </div>
    </div>
    </>
  );
}

export default App;
