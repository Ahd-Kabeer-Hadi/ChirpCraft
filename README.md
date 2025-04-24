
# ChirpCraft 🐦

[![Build Status](https://github.com/your-username/ChirpCraft/actions/workflows/twitter-bot.yml/badge.svg)](https://github.com/your-username/ChirpCraft/actions)  
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **ChirpCraft** is a TypeScript-powered, AI-driven Twitter automation toolkit for busy founders.  
> It uses Google’s Generative AI (Gemini) to draft, schedule, and publish Tweets & Threads automatically via GitHub Actions.

---

## 📌 Table of Contents

1. [Features](#features)  
2. [Prerequisites](#prerequisites)  
3. [Getting Started](#getting-started)  
   - [Clone & Install](#clone--install)  
   - [Environment Variables](#environment-variables)  
   - [Content Database](#content-database)  
   - [State Initialization](#state-initialization)  
   - [Build & Compile](#build--compile)  
4. [Usage](#usage)  
   - [Local Manual Run](#local-manual-run)  
   - [GitHub Actions Automation](#github-actions-automation)  
5. [Configuration (`contentDB.json`)](#configuration-contentdbjson)  
6. [Project Structure](#project-structure)  
7. [Contributing](#contributing)  
8. [License & Credits](#license--credits)

---

## Features

- **Automated Posting**  
  Schedule Tweets & Threads around your goals & posting cadence.  
- **AI-Powered Generation**  
  Leverage Google Gemini to craft founder-voice content from your prompts, pillars & values.  
- **Content Strategy Driven**  
  Centralize audience, pillars, voice, cadence & goals in a single JSON (`contentDB.json`).  
- **Interactive Setup**  
  Use the built-in CLI generator (`contentDbGenerator.ts`) to bootstrap your strategy file.(coming soon)  
- **GitHub Actions**  
  Cron-driven workflow to build, run & push state updates every 30 minutes.  
- **State Persistence**  
  Track daily posts in `state.json` and auto-commit progress.  
- **Optional Mentions Listener**  
  (Separate setup) AI replies to @mentions via Twitter API event listener.

---

## Prerequisites

- **Node.js** ≥ v18 (check `.github/workflows/auto-tweet.yml` for exact version)  
- **npm** or **yarn**  
- **Git**  
- **Twitter Developer Account** (Elevated v2 + App credentials)  
- **Google AI API Key** (Gemini access)

---

## Getting Started

### Clone & Install

```bash
git clone https://github.com/your-username/ChirpCraft.git
cd ChirpCraft
npm install
# or
yarn install
```

### Environment Variables

1. Copy example:

   ```bash
   cp .env.example .env
   ```

2. Open `.env` and set:

   ```dotenv
   TW_APP_KEY=…
   TW_APP_SECRET=…
   TW_ACCESS_TOKEN=…
   TW_ACCESS_SECRET=…
   BOT_HANDLE=…
   BOT_USER_ID=…
   GEMINI_API_KEY=…
   ```

3. **Do not** commit your `.env`.

### Content Database

Generate or edit `contentDB.json`:

- **Interactive**:

  ```bash
  npx ts-node src/contentDbGenerator.ts
  ```

  Follow prompts → copy JSON → save as `contentDB.json`.

- **Manual**:  
  Create/modify `contentDB.json` per schema in `src/types.ts`.

### State Initialization

```bash
echo "{}" > state.json
git add state.json
git commit -m "Initialize state.json"
```

### Build & Compile

Ensure your **package.json** scripts include:

```jsonc
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/indexed.js",
    "dev": "ts-node src/indexed.ts",
    "generate-db": "ts-node src/contentDbGenerator.ts"
  },
  "main": "dist/indexed.js"
}
```

Compile:

```bash
npm run build
```

---

## Usage

### Local Manual Run

```bash
npm run start
# or
node dist/indexed.js
```

> Reads `.env`, `contentDB.json`, and `state.json` → decides on post → generates via AI → posts → updates `state.json`.

### GitHub Actions Automation

1. **GitHub Secrets**  
   In **Settings → Secrets & variables → Actions**, add keys matching `.env.example`.

2. **Enable Workflow**  
   Visit **Actions → Auto Tweet Using AI** → enable & approve on first run.

> Workflow steps:
>
> 1. Checkout & install  
> 2. Build & run `dist/indexed.js`  
> 3. Commit updated `state.json` back to repo

---

## Configuration (`contentDB.json`)

Your strategy file contains:

| Section            | Purpose                                           |
| ------------------ | ------------------------------------------------- |
| `founderProfile`   | Persona name, title, bio, voice & values          |
| `audience`         | Target audience & their interests                 |
| `contentPillars`   | Main topics & sub-themes                          |
| `contentGoals`     | Posting cadence & long-term objectives            |
| `contentStrategies`| Daily prompts & thread formats                    |
| `externalSources`  | Optional links & resources                        |

Use `npm run generate-db` or follow schema in `src/types.ts`.

---

## Project Structure

```text
ChirpCraft/
├── .github/
│   └── workflows/auto-tweet.yml
├── dist/                   # Compiled output
├── src/                    # TypeScript sources
│   ├── aiClient.ts
│   ├── contentDbGenerator.ts
│   ├── indexed.ts
│   ├── twitterClient.ts
│   └── types.ts
├── .env.example            # Env var template
├── contentDB.json          # Content strategy
├── state.json              # Posting state
├── package.json
├── tsconfig.json
└── README.md
```

---

## Contributing

Contributions, issues & feature requests welcome!  

1. Fork the repo  
2. Create a feature branch  
3. Submit a Pull Request  
4. Ensure lint/tests pass

---

## License & Credits

**Open Source – MIT License**  
© Ahd. Kabeer Hadi, Founder, Mirrorfolio Idea Labs Pvt. Ltd.  
See [`LICENSE`](LICENSE) for full details.  
