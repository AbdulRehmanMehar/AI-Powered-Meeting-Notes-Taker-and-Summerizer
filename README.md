# AI Meeting Assistant

Transform conversations into actionable insights.

AI Meeting Assistant records meetings, transcribes conversations in real time, and uses AI to generate concise summaries, action items, decisions, and follow-up notes automatically.

## Features

### 🎙 Real-Time Audio Capture

* Microphone recording
* System audio recording
* Simultaneous multi-source capture

### 📝 AI Transcription

* OpenAI Whisper-powered speech recognition
* High-accuracy meeting transcripts
* Timestamped conversations

### 🤖 Intelligent Summaries

* Executive summaries
* Key discussion points
* Action item extraction
* Decision tracking
* Follow-up recommendations

### 🎥 Screen Recording

* Capture screen activity alongside audio
* Useful for demos, walkthroughs, and presentations

### 🔍 Searchable Knowledge Base

* Search historical meetings
* Retrieve decisions and action items instantly

---

## Architecture

```text
Audio Sources
├── Microphone
├── System Audio
└── Screen Recording
        │
        ▼
Audio Processing Layer
        │
        ▼
OpenAI Whisper
        │
        ▼
Transcript Generation
        │
        ▼
GPT Analysis Engine
        │
        ├── Summary
        ├── Action Items
        ├── Decisions
        └── Insights
```

## Technology Stack

| Layer            | Technology                 |
| ---------------- | -------------------------- |
| Frontend         | Next.js, React, TypeScript |
| AI               | OpenAI Whisper, GPT        |
| Audio Processing | Web Audio API              |
| Recording        | MediaRecorder API          |
| Styling          | Tailwind CSS               |
| Backend          | Node.js                    |

## Getting Started

```bash
git clone <repository-url>

npm install

npm run dev
```

Open:

```bash
http://localhost:3000
```

## Future Roadmap

* Speaker identification
* Calendar integrations
* Slack integration
* Zoom integration
* Google Meet integration
* Multi-language transcription
* Team workspaces
* AI meeting coach
* Sentiment analysis

## License

MIT

---

Built by Abdul Rehman.
