# RobinGPT

An AI chatbot demonstrating multi-stage security inspection through an integrated AI Firewall. Built for sales engineers, security teams, and developers who need to showcase how AI applications can be protected from data leakage, jailbreak attempts, and sensitive information exposure.

## Features

- **Multi-stage AI Firewall inspection** with 5 distinct security checkpoints (system call, user call, tool request, tool output, assistant response)
- **6 operating modes** optimized for sales engineering demos:
  - **Chat** — Standard conversation with AI Firewall toggle on/off
  - **Tool Test** — Side-by-side comparison of protected vs unprotected responses
  - **Analysis** — Intercept logs, flow visualization, and architecture diagrams
  - **Under the Hood** — SDK deployment examples and architecture walkthrough
  - **AI Concepts** — Educational section with business/technical view toggle
  - **Troubleshooting** — Session history browser, live diagnostics, connectivity checks
- **Internationalization** across 5 languages (English, French, Japanese, German, Spanish)
- **Multiple firewall endpoints**: Aim Security, Cato Networks AISEC (EU, US, India, Japan)
- **White-label branding**: Custom app name, logo upload, and primary color picker
- **Real-time streaming** via Server-Sent Events (SSE)
- **Local LLM support**: Connect to Ollama, LM Studio, or any OpenAI-compatible server
- **Dark/light mode** with system preference detection
- **Fail-closed security architecture**: Any inspection error blocks the response rather than allowing it through

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Tailwind CSS, Shadcn/ui, Radix UI |
| Backend | Express.js, TypeScript, Node.js (ES modules) |
| AI | OpenAI API (or any OpenAI-compatible LLM) |
| Security | Aim API / Cato AISEC for real-time message inspection |
| Build | Vite, esbuild |
| State | TanStack Query, Wouter (routing) |
| Validation | Zod, Drizzle ORM (PostgreSQL-ready schema) |

## Prerequisites

- Node.js 20+
- npm
- An OpenAI API key (or a local OpenAI-compatible LLM server) — can be supplied via the browser UI instead of an environment variable
- An AI Firewall account (Aim Security or Cato Networks AISEC)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Niborj/RobinGPT.git
cd RobinGPT
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` (optional — see below):

```env
# Optional: set as a server-side fallback. Users can also enter their
# OpenAI API key directly in the browser UI (Settings → LLM tab).
# OPENAI_API_KEY=sk-...
```

> **All credentials are optional in the environment file.** The AI Firewall credentials (API key, email, endpoint) and the OpenAI API key can all be entered through the browser UI on first launch and are stored in your browser's localStorage. Nothing sensitive is stored on the server.

### 4. Start the development server

```bash
npm run dev
```

The app will be available at `http://localhost:5000`.

### 5. Build for production

```bash
npm run build
npm start
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | No | OpenAI API key for LLM responses (can be entered in the browser UI instead) |
| `ALLOW_LOCAL_LLM` | No | Set to `true` to allow connecting to local/custom LLM servers (default: `false`) |

## Local LLM Configuration

To use a local LLM (Ollama, LM Studio, etc.) instead of OpenAI:

1. Set `ALLOW_LOCAL_LLM=true` in your `.env` file
2. Start your local LLM server (e.g., `ollama serve`)
3. Open the app, go to Settings, and select **Local / Custom LLM** as the provider
4. Enter your local server's base URL (e.g., `http://localhost:11434/v1`)

The server validates that only localhost and private network addresses are accepted when local LLM is enabled.

## AI Firewall Setup

RobinGPT supports two AI Firewall providers:

- **Aim Security** (`api.aim.security`) — the default provider
- **Cato Networks AISEC** — available in EU, US, India, and Japan regions

To configure on first launch:
1. Open the app — the setup dialog appears automatically
2. Select your AI Firewall provider
3. Enter your API key and email (found in your provider dashboard)
4. Choose your LLM provider (OpenAI or Local)

You can update credentials at any time via the settings icon in the header.

## Project Structure

```
robingpt/
├── client/                  # Frontend React application
│   └── src/
│       ├── components/      # Reusable UI components
│       ├── contexts/        # React contexts (credentials, language, branding, theme)
│       ├── hooks/           # Custom React hooks
│       ├── lib/             # Utilities, i18n translations, endpoint config
│       └── pages/           # Page components (chat.tsx is the main page)
├── server/                  # Backend Express application
│   ├── index.ts             # Server entry point
│   ├── routes.ts            # API route handlers
│   ├── openai.ts            # OpenAI integration with AI Firewall inspection
│   ├── storage.ts           # Storage interface (in-memory, PostgreSQL-ready)
│   └── vite.ts              # Vite dev server middleware
├── shared/                  # Shared types and schemas
│   └── schema.ts            # Drizzle ORM schema definitions
├── attached_assets/         # Static assets (images, logos)
├── .env.example             # Environment variable template
└── README.md
```

## Security Architecture

All messages flow through a multi-stage inspection pipeline before reaching the LLM or the user:

| Stage | Name | What It Inspects |
|-------|------|-----------------|
| 1 | System Call | Establishes security boundaries for the session |
| 2 | User Call | User input — PII, PHI, secrets, jailbreak attempts |
| 3 | Tool Request | The AI's decision to invoke an external tool |
| 4 | Tool Call | Tool output — indirect prompt injection, sensitive data |
| 5 | Assistant Call | Final response before it reaches the user |

The system uses a **fail-closed** architecture: if any stage encounters an inspection error (network issue, timeout, or policy violation), the response is blocked rather than allowed through.

## White-Label Branding

RobinGPT supports full white-label customization via the Settings dialog:

- **App Name** — replaces "RobinGPT" throughout the UI
- **Logo** — upload a PNG, JPG, or WebP image (max 2 MB)
- **Primary Color** — changes the accent color across the interface

All branding settings are stored in browser localStorage and can be reset to defaults at any time.

## Contributing

Contributions are welcome. To get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes and ensure the TypeScript build passes (`npm run check`)
4. Commit with a descriptive message
5. Open a pull request against `main`

Please keep pull requests focused — one feature or fix per PR.

## License

MIT
