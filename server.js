const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { createServer } = require('http');
const next = require('next');

// Load environment variables
require('dotenv').config();

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const PORT = process.env.PORT || 3000;

app.prepare().then(() => {
  const server = express();
  const httpServer = createServer(server);
  
  // Create WebSocket server for proxying Deepgram
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/deeptranscribe'
  });

  wss.on('connection', async (clientWs, req) => {
    console.log('🔌 Client connected to proxy');

    // Get the raw value and clean it
    let DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '';
    // Remove any quotes, whitespace, newlines
    DEEPGRAM_API_KEY = DEEPGRAM_API_KEY.replace(/['"]/g, '').trim();

    console.log('🔑 Raw env value length:', process.env.DEEPGRAM_API_KEY?.length);
    console.log('🔑 Cleaned key length:', DEEPGRAM_API_KEY.length);
    console.log('🔑 API Key:', DEEPGRAM_API_KEY.substring(0, 8) + '...' + DEEPGRAM_API_KEY.substring(DEEPGRAM_API_KEY.length - 4));

    if (!DEEPGRAM_API_KEY || DEEPGRAM_API_KEY.length < 10) {
      console.error('❌ No valid Deepgram API key configured');
      clientWs.close(1008, 'Server not configured');
      return;
    }

    // Extract query params from client request for configuration
    const url = new URL(req.url, `http://${req.headers.host}`);
    const params = url.searchParams;

    // Build Deepgram WebSocket URL
    const deepgramUrl = new URL('wss://api.deepgram.com/v1/listen');
    
    // Copy relevant params (note: Deepgram rejects utterance_end_ms with 400)
    ['model', 'encoding', 'sample_rate', 'channels', 'punctuate', 'interim_results',
     'endpointing', 'vad_events'].forEach(key => {
      if (params.has(key)) {
        deepgramUrl.searchParams.set(key, params.get(key));
      }
    });

    console.log('🎙️ Connecting to Deepgram:', deepgramUrl.toString());
    console.log('🔐 Auth header: Token ' + DEEPGRAM_API_KEY.substring(0, 8) + '...');

    // Create Deepgram WebSocket connection using raw ws with proper headers
    let deepgramWs;
    try {
      deepgramWs = new WebSocket(deepgramUrl.toString(), {
        headers: {
          'Authorization': `Token ${DEEPGRAM_API_KEY}`
        }
      });
    } catch (e) {
      console.error('❌ Failed to create WebSocket:', e);
      clientWs.send(JSON.stringify({ type: 'Error', message: 'Failed to connect to Deepgram' }));
      clientWs.close(1011, 'Deepgram connection failed');
      return;
    }

    let isConnected = false;

    deepgramWs.on('open', () => {
      console.log('✅ Connected to Deepgram!');
      isConnected = true;
      
      // Notify client that we're ready
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'Ready' }));
      }
    });

    deepgramWs.on('message', (data) => {
      // Forward Deepgram messages to client
      if (clientWs.readyState === WebSocket.OPEN) {
        // Data could be Buffer or string
        const message = data instanceof Buffer ? data.toString() : data;
        clientWs.send(message);
      }
    });

    deepgramWs.on('error', (error) => {
      console.error('❌ Deepgram WebSocket error:', error.message);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'Error',
          message: `Deepgram error: ${error.message}`
        }));
      }
    });

    deepgramWs.on('close', (code, reason) => {
      const reasonStr = reason ? reason.toString() : 'unknown';
      console.log('❌ Deepgram closed:', code, reasonStr);
      isConnected = false;
      if (clientWs.readyState === WebSocket.OPEN) {
        // 1006 is reserved and cannot be sent, use 1000 instead
        // Valid sendable codes are 1000 or 3000-4999
        let validCode = 1000;
        if (typeof code === 'number' && ((code >= 3000 && code <= 4999) || code === 1000)) {
          validCode = code;
        }
        try {
          clientWs.close(validCode, reasonStr.substring(0, 123)); // Max 123 bytes for reason
        } catch (e) {
          console.error('Error closing client:', e);
        }
      }
    });

    // Forward audio data from client to Deepgram
    clientWs.on('message', (data) => {
      if (isConnected && deepgramWs.readyState === WebSocket.OPEN) {
        deepgramWs.send(data);
      }
    });

    clientWs.on('close', () => {
      console.log('🔌 Client disconnected');
      if (deepgramWs.readyState === WebSocket.OPEN || deepgramWs.readyState === WebSocket.CONNECTING) {
        deepgramWs.close();
      }
    });

    clientWs.on('error', (error) => {
      console.error('❌ Client error:', error.message);
      if (deepgramWs.readyState === WebSocket.OPEN || deepgramWs.readyState === WebSocket.CONNECTING) {
        deepgramWs.close();
      }
    });
  });

  // Handle all other requests with Next.js
  server.use((req, res) => {
    return handle(req, res);
  });

  httpServer.listen(PORT, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://localhost:${PORT}`);
    console.log(`> WebSocket proxy on ws://localhost:${PORT}/deeptranscribe`);
  });
});
