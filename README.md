<div align="center">

# 📝 Vi-Notes

### Authenticity Verification Platform for Writing

*Distinguish natural human composition from AI-generated content through behavioral analysis*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.2-61dafb?logo=react)](https://reactjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-9.3-47A248?logo=mongodb)](https://www.mongodb.com/)
[![License](https://img.shields.io/badge/License-Proprietary-red)]()

</div>

---

## 🎯 Vision

**Vi-Notes** is built on a simple yet powerful principle: **authenticity is stronger when content and behavior agree.**

Human writing naturally includes:
- ⏸️ Pauses and hesitations
- ✏️ Rewrites and corrections
- ⚡ Bursts of typing activity
- 🔄 Natural editing patterns

AI-assisted or pasted content often shows **mismatches** between the text and how it was produced. Vi-Notes captures behavioral metadata in real-time and pairs it with session analytics to provide **verifiable authorship evidence**.

---

## ✨ Key Features

### 🔐 **Authentication & Security**
- Email/password registration and login
- JWT access tokens with HTTP-only refresh cookies
- Automatic token refresh during active sessions
- Refresh token rotation with server-side revocation
- Rate limiting on auth endpoints
- Hashed refresh token persistence (SHA-256)

### ✍️ **Rich Text Editor**
- Distraction-free writing environment
- Full formatting support (bold, italic, underline, headings)
- Multiple font families and sizes
- Text and highlight color customization
- List support (ordered and unordered)
- Text alignment options
- Per-file formatting persistence
- Auto-save scroll position

### 📊 **Behavioral Tracking**
- **Keystroke timing capture** (down/up timestamps, press duration)
- **Paste detection** with length and selection metadata
- **Edit tracking** for pasted content modifications
- **Pause detection** (3-second inactivity threshold)
- **WPM (Words Per Minute)** real-time calculation
- Privacy-first: Only metadata stored, never actual keystrokes

### 💾 **Session Management**
- Create and incrementally update writing sessions
- Automatic session analytics on close
- Session history with detailed metrics
- Resume previous sessions
- Offline-first architecture with IndexedDB buffering

### 📈 **Analytics & Insights**
- **Advanced WPM profiling** - Rolling velocity analysis with 10-keystroke windows
- **WPM variance & coefficient of variation** - Typing rhythm consistency detection
- **Intelligent pause modeling** - Micro-pause (300-2000ms) vs macro-pause (≥2000ms) classification
- **Pause entropy calculation** - Natural vs robotic pattern detection
- **Edit ratio** - Revision behavior analysis
- **Paste ratio** - External content detection
- **Character statistics** - Insertions, deletions, final count
- **Duration tracking** - Total writing time
- **Behavioral consistency scoring** - Multi-factor authenticity analysis
- **Distribution-based stability metrics** - Inter-keystroke interval analysis

### 🌐 **Offline Resilience**
- Durable client-side keystroke queue in IndexedDB
- Automatic replay on reconnect
- Exponential backoff retry logic
- User-facing error notifications
- Deferred session close when unsynced data remains

### 🎨 **Modern UI/UX**
- Light and dark theme support
- Responsive design (mobile, tablet, desktop)
- Real-time status badges
- Session visualization with charts
- Overview dashboard with key metrics
- Protected and guest route guards

---

## 🏗️ Architecture

Vi-Notes is built as a **TypeScript monorepo** with three main packages:

```
vi-notes/
├── client/          # React frontend (Vite)
├── server/          # Express backend (Node.js)
└── shared/          # Shared TypeScript types
```

### Tech Stack

| Layer | Technologies | Purpose |
|-------|-------------|---------|
| **Frontend** | React 19, TypeScript, Vite, Axios, Tailwind CSS | Editor UI, event capture, auth, sync scheduling |
| **Backend** | Node.js, Express, TypeScript, Mongoose, Zod | Auth, session APIs, validation, analytics |
| **Shared** | TypeScript workspace package | Cross-package type contracts |
| **Database** | MongoDB | Users, refresh tokens, documents, sessions |
| **Security** | bcrypt, JWT, express-rate-limit | Password hashing, token management, rate limiting |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 20+ and **npm** 10+
- **MongoDB** (local or cloud instance)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd vi-notes
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**

   Create `server/.env` from the example:
   ```bash
   cp server/.env.example server/.env
   ```

   Update the following required variables:
   ```env
   MONGODB_URI=mongodb://localhost:27017/vi-notes
   JWT_SECRET=your_super_secret_key_here
   JWT_REFRESH_SECRET=your_refresh_secret_key_here
   ```

   Optional variables (with defaults):
   ```env
   JWT_ACCESS_EXPIRES_IN=15m
   REFRESH_TOKEN_TTL_DAYS=7
   REFRESH_COOKIE_NAME=refreshToken
   CLIENT_ORIGIN=http://127.0.0.1:5173
   NODE_ENV=development
   PORT=3001
   ```

4. **Start development servers**
   ```bash
   npm run dev
   ```

   This starts:
   - **Client**: http://127.0.0.1:5173 (Vite dev server)
   - **Server**: http://127.0.0.1:3001 (Express API)

---

## 📡 API Reference

### Base URL
```
http://127.0.0.1:3001
```

### Authentication Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/auth/register` | None | Create user account |
| `POST` | `/api/auth/login` | None | Login and issue tokens |
| `POST` | `/api/auth/refresh` | Refresh cookie | Rotate refresh token and issue new access token |
| `POST` | `/api/auth/logout` | Optional refresh cookie | Revoke token and clear cookie |

### Document Endpoints

All require `Authorization: Bearer <accessToken>`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/documents` | List user's documents |
| `POST` | `/api/documents` | Create new document |
| `GET` | `/api/documents/:id` | Get document details |
| `PATCH` | `/api/documents/:id` | Rename document |
| `PATCH` | `/api/documents/:id/content` | Update document content |
| `DELETE` | `/api/documents/:id` | Delete document |

### Session Endpoints

All require `Authorization: Bearer <accessToken>`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sessions` | Create new session |
| `PATCH` | `/api/sessions/:id` | Append keystrokes to session |
| `GET` | `/api/sessions` | List sessions (with optional documentId filter) |
| `GET` | `/api/sessions/:id` | Get session details |
| `POST` | `/api/sessions/:id/close` | Close session and compute analytics |

### Analytics Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/analytics/:documentId` | Bearer token | Get document analytics |

---

## 📊 Event Model

### Captured Event Types

- **`down`** - Key press start
- **`up`** - Key release
- **`paste`** - Paste operation
- **`edit`** - Text modification

### Session Analytics (Computed on Close)

```typescript
{
  version: number;
  approximateWpmVariance: number;  // Average WPM
  pauseFrequency: number;           // Macro-pause count
  editRatio: number;                // Deletions / final chars
  pasteRatio: number;               // Pasted / total inserted
  totalInsertedChars: number;
  totalDeletedChars: number;
  finalChars: number;
  totalPastedChars: number;
  pauseCount: number;               // Macro-pauses (≥2000ms)
  microPauseCount: number;          // Micro-pauses (300-2000ms)
  durationMs: number;
  wpm: number;                      // Rolling window WPM
  wpmVariance: number;              // WPM standard deviation
  coefficientOfVariation: number;   // Normalized typing consistency
  textAnalysis: {
    avgSentenceLength: number;
    sentenceVariance: number;
    lexicalDiversity: number;
    totalWords: number;
    totalSentences: number;
  };
  authenticity: {
    score: number;
    label: string;
    behavioralScore: number;
    textualScore: number;
    crossCheckScore: number;
  };
  flags: string[];                  // Anomaly detection flags
}
```

---

## 🔧 Development

### Available Scripts

```bash
# Run both client and server in development mode
npm run dev

# Type-check all packages
npm run typecheck

# Build client for production
npm run build

# Lint client code
npm run lint -w client
```

### Project Structure

```
vi-notes/
├── client/
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── contexts/        # React context providers
│   │   ├── hooks/           # Custom React hooks
│   │   ├── lib/             # Utility functions
│   │   ├── offline/         # IndexedDB queue management
│   │   ├── pages/           # Route pages
│   │   ├── routes/          # Route guards
│   │   ├── api.ts           # Axios instance & auth helpers
│   │   ├── App.tsx          # Main app component
│   │   └── styles.css       # Global styles
│   ├── package.json
│   └── vite.config.ts
├── server/
│   ├── src/
│   │   ├── controllers/     # Request handlers
│   │   ├── middleware/      # Express middleware
│   │   ├── models/          # Mongoose schemas
│   │   ├── routes/          # API routes
│   │   ├── services/        # Business logic
│   │   ├── types/           # TypeScript definitions
│   │   ├── app.ts           # Express app setup
│   │   ├── config.ts        # Environment config
│   │   └── server.ts        # Server entry point
│   ├── .env.example
│   └── package.json
├── shared/
│   ├── src/
│   │   ├── auth.ts          # Auth types
│   │   ├── document.ts      # Document types
│   │   ├── keystroke.ts     # Keystroke types
│   │   ├── session.ts       # Session types
│   │   └── index.ts         # Barrel export
│   └── package.json
└── package.json             # Root workspace config
```

---

## 🔒 Privacy & Security

### Data Protection
- **Keystroke sanitization middleware** strips content fields from payloads
- Event model stores **structural and timing metadata only**, not raw text
- Cookie security defaults: `httpOnly`, `sameSite` protections
- Access tokens stored in `sessionStorage` (tab-scoped, cleared on close)

### Authentication Security
- Passwords hashed with **bcrypt** (10 rounds)
- JWT tokens with short expiration (15 minutes default)
- Refresh token rotation prevents token reuse
- Server-side token revocation tracking
- Rate limiting on login/register endpoints

### Data Integrity
- **3-Layer NaN Protection**:
  - Layer 1: Safe math functions (`safeNumber`, `safeDivide`, `safeLog`)
  - Layer 2: Protected calculations in all analytics services
  - Layer 3: Deep sanitization before MongoDB persistence
- All numeric fields have default values (0) in database schema
- Division-by-zero prevention across all calculations
- Automatic fallback to safe values for invalid inputs

---

## 🎨 UI Themes

### Light Mode
- Base background: `#F8F8F6`
- Clean, minimal aesthetic
- High contrast for readability

### Dark Mode (Default)
- Base background: `#22221F`
- Reduced eye strain
- Modern, professional appearance

Theme preference persists across sessions.

---

## 🚧 Current Limitations

- No automated test suite configured
- Root build script targets client only
- Web-first implementation (no native desktop capture)

---

## 🗺️ Roadmap

### Recently Completed ✅
- ✅ Advanced velocity profiling with rolling WPM windows
- ✅ Intelligent pause modeling (micro/macro + entropy)
- ✅ Distribution-based behavioral consistency analysis
- ✅ Enhanced authenticity scoring with multi-factor analysis
- ✅ **NaN Protection System** - 3-layer validation preventing invalid numeric values in analytics

### Upcoming Features
- 🧪 Comprehensive test suite (unit, integration, e2e)
- 📊 Richer authenticity reports with visual evidence
- 🤖 Machine learning-based anomaly detection
- 🔄 Progressive adaptation to evolving AI patterns
- 💻 Native desktop packaging with OS-level telemetry
- 📱 Mobile app with native keyboard tracking
- 🌍 Multi-language support
- 🔗 Integration with learning management systems (LMS)

---

## 👥 Team

**Mentor**: Jinal Gupta

---

## 📄 License

This project is proprietary software. No license file is currently present.

---

## 🤝 Contributing

This is a private project. Contributions are currently not accepted.

---

## 📞 Support

For questions or issues, please contact the project maintainer.

---

<div align="center">

**Built with ❤️ for authentic writing**

</div>
