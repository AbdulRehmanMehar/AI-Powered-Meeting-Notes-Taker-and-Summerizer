'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface TranscriptEntry {
  id: string;
  source: 'mic' | 'system' | 'combined';
  text: string;
  timestamp: Date;
  isFinal: boolean;
}

interface AISummary {
  keyPoints: string[];
  actionItems: string[];
  coachingInsights: string[];
}

export default function MeetingNotetaker() {
  const [isCapturing, setIsCapturing] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [systemAudioEnabled, setSystemAudioEnabled] = useState(true);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [aiSummary, setAiSummary] = useState<AISummary | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [interimText, setInterimText] = useState('');

  const micStreamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const combinedStreamRef = useRef<MediaStream | null>(null);
  const mixAudioContextRef = useRef<AudioContext | null>(null);
  const pcmAudioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);
  const mockIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcript, interimText]);

  // Combine audio streams
  const combineAudioStreams = (streams: MediaStream[]): MediaStream => {
    const audioContext = new AudioContext();
    mixAudioContextRef.current = audioContext;
    
    const destination = audioContext.createMediaStreamDestination();
    
    streams.forEach(stream => {
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(destination);
    });
    
    return destination.stream;
  };

  const startPcmStreaming = useCallback((stream: MediaStream, ws: WebSocket) => {
    if (pcmAudioContextRef.current) {
      pcmAudioContextRef.current.close();
      pcmAudioContextRef.current = null;
    }

    const audioContext = new AudioContext({ sampleRate: 16000 });
    pcmAudioContextRef.current = audioContext;
    audioContext.resume().catch(() => undefined);

    const source = audioContext.createMediaStreamSource(stream);
    sourceNodeRef.current = source;

    const processor = audioContext.createScriptProcessor(1024, 1, 1);
    processorRef.current = processor;

    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0;

    processor.onaudioprocess = (event) => {
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const inputBuffer = event.inputBuffer;
      const channels = inputBuffer.numberOfChannels;
      const length = inputBuffer.length;

      const buffer = new Int16Array(length);

      for (let i = 0; i < length; i++) {
        let sample = 0;
        for (let c = 0; c < channels; c++) {
          sample += inputBuffer.getChannelData(c)[i];
        }
        sample /= channels;
        sample = Math.max(-1, Math.min(1, sample));
        buffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }

      ws.send(buffer.buffer);
    };

    source.connect(processor);
    processor.connect(gainNode);
    gainNode.connect(audioContext.destination);
  }, []);

  // Mock transcription for demo without API key
  const startMockTranscription = useCallback(() => {
    setIsTranscribing(true);
    const mockPhrases = [
      "Hello, thanks for joining the meeting today.",
      "Let's go over the project timeline.",
      "I think we should focus on the core features first.",
      "What's the status on the deliverables?",
      "We need to schedule a follow-up next week.",
      "Can you share your screen?",
      "That's a great point, let me make a note of that.",
      "The deadline is approaching, we need to prioritize.",
    ];
    
    let index = 0;
    mockIntervalRef.current = setInterval(() => {
      if (index < mockPhrases.length) {
        setTranscript(prev => [
          ...prev,
          {
            id: `mock-${Date.now()}`,
            source: 'combined',
            text: mockPhrases[index],
            timestamp: new Date(),
            isFinal: true
          }
        ]);
        index++;
      }
    }, 3000);
  }, []);

  const stopMockTranscription = useCallback(() => {
    if (mockIntervalRef.current) {
      clearInterval(mockIntervalRef.current);
      mockIntervalRef.current = null;
    }
  }, []);

  // Connect to Deepgram WebSocket for real-time transcription
  const connectToDeepgram = useCallback(async (stream: MediaStream) => {
    try {
      // Check if we should use mock mode
      const keyResponse = await fetch('/api/transcribe/key');
      if (!keyResponse.ok) {
        throw new Error('Failed to get API key');
      }
      const { useMock } = await keyResponse.json();

      if (useMock) {
        console.log('Using mock transcription (no API key configured)');
        startMockTranscription();
        return;
      }

      console.log('🔌 Connecting via Express proxy to Deepgram...');

      // Connect to our Express WebSocket proxy
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = new URL(`${protocol}//${window.location.host}/deeptranscribe`);
      
      // Add Deepgram parameters
      wsUrl.searchParams.set('model', 'nova-2');
      wsUrl.searchParams.set('punctuate', 'true');
      wsUrl.searchParams.set('interim_results', 'true');
      wsUrl.searchParams.set('endpointing', '100');
      wsUrl.searchParams.set('vad_events', 'true');
      wsUrl.searchParams.set('encoding', 'linear16');
      wsUrl.searchParams.set('sample_rate', '16000');
      wsUrl.searchParams.set('channels', '1');

      const ws = new WebSocket(wsUrl.toString());
      ws.binaryType = 'arraybuffer';

      wsRef.current = ws;

      ws.onopen = () => {
        console.log('✅ Connected to Deepgram proxy');
        setIsTranscribing(true);
        setError(null);

        // Start streaming audio immediately
        startPcmStreaming(stream, ws);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle transcription results
          if (data.type === 'Results' && data.channel?.alternatives?.[0]) {
            const alternative = data.channel.alternatives[0];
            const transcript = alternative.transcript;
            
            if (transcript && transcript.trim()) {
              const isFinal = data.is_final || false;
              
              if (isFinal) {
                console.log('📝 Final:', transcript);
                setTranscript(prev => [
                  ...prev,
                  {
                    id: `deepgram-${Date.now()}`,
                    source: 'combined',
                    text: transcript,
                    timestamp: new Date(),
                    isFinal: true
                  }
                ]);
                setInterimText('');
              } else {
                setInterimText(transcript);
              }
            }
          }

          // Handle errors
          if (data.type === 'Error') {
            console.error('❌ Deepgram error:', data.message);
            setError('Deepgram error: ' + (data.message || 'Unknown error'));
          }
        } catch (err) {
          // Binary data (keep alive) - ignore
        }
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        setError('Connection error');
        setIsTranscribing(false);
      };

      ws.onclose = (event) => {
        console.log('❌ WebSocket closed - Code:', event.code, 'Reason:', event.reason || 'none');
        
        if (event.code === 1008) {
          setError('Server not configured - check API key');
        } else if (event.code !== 1000) {
          setError(`Connection closed (code: ${event.code})`);
        }
        setIsTranscribing(false);
      };

    } catch (e) {
      console.error('Failed to connect:', e);
      setError('Failed to start transcription. Using mock mode.');
      startMockTranscription();
    }
  }, [startMockTranscription, startPcmStreaming]);

  // Start capturing
  const startCapture = async () => {
    setError(null);
    const streams: MediaStream[] = [];

    try {
      // Request system audio via screen share
      if (systemAudioEnabled) {
        try {
          const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            }
          });

          const audioTracks = displayStream.getAudioTracks();
          if (audioTracks.length === 0) {
            setError('No audio track captured. Make sure to check "Share audio" when sharing.');
          } else {
            // Stop video track - we only need audio
            displayStream.getVideoTracks().forEach(track => track.stop());
            
            // Create audio-only stream
            const audioOnlyStream = new MediaStream(audioTracks);
            systemStreamRef.current = audioOnlyStream;
            streams.push(audioOnlyStream);
          }
        } catch (e) {
          console.error('System audio capture failed:', e);
          setError('System audio capture cancelled or failed. Continuing with mic only.');
        }
      }

      // Request microphone
      if (micEnabled) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
          });
          micStreamRef.current = micStream;
          streams.push(micStream);
        } catch (e) {
          console.error('Microphone capture failed:', e);
          setError('Microphone access denied.');
        }
      }

      if (streams.length === 0) {
        setError('No audio sources available.');
        return;
      }

      // Combine streams if we have multiple
      let finalStream: MediaStream;
      if (streams.length > 1) {
        finalStream = combineAudioStreams(streams);
      } else {
        finalStream = streams[0];
      }
      combinedStreamRef.current = finalStream;

      // Connect to transcription service
      await connectToDeepgram(finalStream);

      setIsCapturing(true);
    } catch (e) {
      console.error('Capture failed:', e);
      setError('Failed to start capture. Please try again.');
    }
  };

  // Stop capturing
  const stopCapture = useCallback(() => {
    // Stop WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Stop mock transcription
    stopMockTranscription();

    // Stop microphone
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }

    // Stop system audio
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach(track => track.stop());
      systemStreamRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    // Close audio contexts
    if (mixAudioContextRef.current) {
      mixAudioContextRef.current.close();
      mixAudioContextRef.current = null;
    }

    if (pcmAudioContextRef.current) {
      pcmAudioContextRef.current.close();
      pcmAudioContextRef.current = null;
    }

    setIsCapturing(false);
    setIsTranscribing(false);
    setInterimText('');
  }, [stopMockTranscription]);

  // Process transcript with AI
  const processWithAI = async () => {
    const finalTranscript = transcript
      .filter(e => e.isFinal)
      .map(e => e.text)
      .join('\n');

    if (!finalTranscript.trim()) {
      setError('No transcript to process.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const response = await fetch('/api/meeting-coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: finalTranscript }),
      });

      if (!response.ok) {
        throw new Error('AI processing failed');
      }

      const data = await response.json();
      setAiSummary(data);
    } catch (e) {
      console.error('AI processing error:', e);
      setError('Failed to process with AI. Check if the API is configured.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, [stopCapture]);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">🎙️ Meeting Notetaker POC</h1>
          <p className="text-gray-400">
            Capture meeting audio from Zoom/Hangouts and get AI coaching insights.
          </p>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-900/50 border border-red-500 rounded-lg">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {/* Controls */}
        <div className="mb-8 p-6 bg-gray-900 rounded-xl border border-gray-800">
          <h2 className="text-lg font-semibold mb-4">Audio Sources</h2>
          
          <div className="flex flex-wrap gap-4 mb-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={micEnabled}
                onChange={(e) => setMicEnabled(e.target.checked)}
                disabled={isCapturing}
                className="w-5 h-5 rounded"
              />
              <span>🎤 Microphone (Your voice)</span>
            </label>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={systemAudioEnabled}
                onChange={(e) => setSystemAudioEnabled(e.target.checked)}
                disabled={isCapturing}
                className="w-5 h-5 rounded"
              />
              <span>🔊 System Audio (Meeting participants)</span>
            </label>
          </div>

          <div className="flex flex-wrap gap-4">
            {!isCapturing ? (
              <button
                onClick={startCapture}
                disabled={!micEnabled && !systemAudioEnabled}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded-lg font-semibold transition-colors"
              >
                ▶️ Start Capture
              </button>
            ) : (
              <button
                onClick={stopCapture}
                className="px-6 py-3 bg-red-600 hover:bg-red-700 rounded-lg font-semibold transition-colors"
              >
                ⏹️ Stop Capture
              </button>
            )}

            <button
              onClick={processWithAI}
              disabled={isProcessing || transcript.filter(e => e.isFinal).length === 0}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 rounded-lg font-semibold transition-colors"
            >
              {isProcessing ? '🔄 Processing...' : '🤖 Get AI Coaching'}
            </button>

            <button
              onClick={() => {
                setTranscript([]);
                setAiSummary(null);
                setInterimText('');
              }}
              className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-semibold transition-colors"
            >
              🗑️ Clear
            </button>
          </div>

          {isCapturing && (
            <div className="mt-4 flex items-center gap-2">
              <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></span>
              <span className="text-red-400">
                {isTranscribing ? 'Recording & Transcribing...' : 'Connecting...'}
              </span>
            </div>
          )}
        </div>

        {/* Live Transcript */}
        <div className="mb-8 p-6 bg-gray-900 rounded-xl border border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">📝 Live Transcript</h2>
            {transcript.length > 0 && (
              <span className="text-xs text-gray-500">
                {transcript.filter(e => e.isFinal).length} entries
              </span>
            )}
          </div>
          
          <div 
            ref={transcriptContainerRef}
            className="max-h-96 overflow-y-auto space-y-2"
          >
            {transcript.length === 0 && !interimText ? (
              <p className="text-gray-500 italic">
                Transcript will appear here when you start capturing...
              </p>
            ) : (
              <>
                {transcript.filter(e => e.isFinal).map((entry) => (
                  <div
                    key={entry.id}
                    className="p-3 rounded-lg bg-blue-900/30 border-l-4 border-blue-500"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold uppercase text-blue-400">
                        🎤 Transcript
                      </span>
                      <span className="text-xs text-gray-500">
                        {entry.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-gray-200">{entry.text}</p>
                  </div>
                ))}
                
                {/* Interim (live) text */}
                {interimText && (
                  <div className="p-3 rounded-lg bg-yellow-900/20 border-l-4 border-yellow-500 animate-pulse">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold uppercase text-yellow-400">
                        ✏️ Listening...
                      </span>
                    </div>
                    <p className="text-gray-400 italic">{interimText}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* AI Summary */}
        {aiSummary && (
          <div className="p-6 bg-gray-900 rounded-xl border border-purple-800">
            <h2 className="text-lg font-semibold mb-4">🤖 AI Coach Summary</h2>
            
            <div className="space-y-6">
              <div>
                <h3 className="text-md font-semibold text-purple-400 mb-2">📌 Key Points</h3>
                <ul className="list-disc list-inside space-y-1">
                  {aiSummary.keyPoints.map((point, i) => (
                    <li key={i} className="text-gray-300">{point}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-md font-semibold text-orange-400 mb-2">✅ Action Items</h3>
                <ul className="list-disc list-inside space-y-1">
                  {aiSummary.actionItems.map((item, i) => (
                    <li key={i} className="text-gray-300">{item}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-md font-semibold text-green-400 mb-2">💡 Coaching Insights</h3>
                <ul className="list-disc list-inside space-y-1">
                  {aiSummary.coachingInsights.map((insight, i) => (
                    <li key={i} className="text-gray-300">{insight}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="mt-8 p-6 bg-gray-900/50 rounded-xl border border-gray-800">
          <h2 className="text-lg font-semibold mb-4">📖 How to Use</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-400">
            <li>Join your Zoom or Google Meet call in a <strong className="text-white">browser tab</strong></li>
            <li>Click <strong className="text-white">Start Capture</strong> above</li>
            <li>Select the <strong className="text-white">tab</strong> with your meeting and check <strong className="text-white">&quot;Share tab audio&quot;</strong></li>
            <li>Allow microphone access when prompted</li>
            <li>Have your meeting - transcript appears in <strong className="text-white">real-time</strong></li>
            <li>Click <strong className="text-white">Stop Capture</strong> when done</li>
            <li>Click <strong className="text-white">Get AI Coaching</strong> for insights</li>
          </ol>
          
          {/* <div className="mt-4 p-4 bg-blue-900/30 border border-blue-700 rounded-lg">
            <p className="text-blue-300 text-sm">
              <strong>🔑 API Setup:</strong> For real transcription, add <code className="bg-gray-800 px-1 rounded">DEEPGRAM_API_KEY</code> to your <code className="bg-gray-800 px-1 rounded">.env</code> file. 
              Get a free key at <a href="https://deepgram.com" target="_blank" rel="noopener noreferrer" className="underline">deepgram.com</a>.
              Without it, mock transcription is used for demo.
            </p>
          </div> */}
          
          <div className="mt-4 p-4 bg-yellow-900/30 border border-yellow-700 rounded-lg">
            <p className="text-yellow-300 text-sm">
              <strong>💡 Tip:</strong> For best results, use Chrome and share the specific <strong>tab</strong> where your meeting is running.
              Make sure to enable &quot;Share tab audio&quot; in the share dialog.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
