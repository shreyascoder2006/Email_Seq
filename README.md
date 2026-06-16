# 📧 Email Sequencing Module

A production-ready **Node.js + Express + TypeScript** backend for building and automating email sequences, built with a scalable monorepo structure.

---

## 🗂️ Project Structure

```
Email_Sequencing_Module/
├── package.json                   # Monorepo root
├── .gitignore
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .eslintrc.json
│   ├── .prettierrc
│   ├── .env                       # ← your secrets (gitignored)
│   ├── .env.example               # ← copy & fill this
│   └── src/
│       ├── server.ts              # Express app + bootstrap
│       ├── config/
│       │   ├── env.ts             # Zod-validated env config
│       │   ├── db.ts              # Mongoose + retry logic
│       │   ├── redis.ts           # IORedis (primary / subscriber / bullmq)
│       │   ├── mailer.ts          # Nodemailer SMTP transporter
│       │   └── logger.ts          # Winston + daily rotating files
│       ├── middleware/
│       │   ├── auth.ts            # JWT authenticate + authorize RBAC
│       │   ├── validate.ts        # Zod validation middleware factory
│       │   ├── errorHandler.ts    # Global error + 404 handlers
│       │   ├── rateLimiter.ts     # API / auth / email rate limiters
│       │   └── requestLogger.ts   # Morgan → Winston HTTP logger
│       ├── routes/
│       │   ├── index.ts           # Central router
│       │   └── health.route.ts    # /api/health + /api/health/ping
│       ├── queues/
│       │   └── emailQueue.ts      # BullMQ queue + worker + addEmailJob()
│       ├── types/
│       │   └── index.ts           # All TS interfaces, enums, types
│       └── utils/
│           ├── AppError.ts        # Operational error class + factories
│           ├── response.ts        # sendSuccess / sendError / sendPaginated
│           └── crypto.ts          # AES-256-CBC encrypt/decrypt
└── frontend/                      # (Vite app — coming next)
```

---

## ⚡ Quick Start

### Prerequisites
| Tool | Version |
|------|---------|
| Node.js | ≥ 18.x |
| npm | ≥ 9.x |
| MongoDB | ≥ 6.x (local or Atlas) |
| Redis | ≥ 7.x (local or Upstash) |

### 1. Install dependencies
```bash
cd Email_Sequencing_Module/backend
npm install
```

### 2. Configure environment
```bash
# .env is already created from .env.example
# Open it and fill in your real values:
notepad .env        # Windows
```

**Minimum required values to change:**
```env
MONGO_URI=mongodb://localhost:27017/email_sequencing
REDIS_URL=redis://localhost:6379
JWT_SECRET=<any 32+ character random string>
JWT_REFRESH_SECRET=<any 32+ character random string>
ENCRYPTION_KEY=<exactly 32 characters>
```

### 3. Run in development
```bash
npm run dev
```

### 4. Verify the server
```bash
# Health check
curl http://localhost:5000/api/health

# Lightweight ping
curl http://localhost:5000/api/health/ping
```

---

## 🔧 Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot-reload (`ts-node-dev`) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm run start` | Run compiled production build |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix ESLint issues |

---

## 🌐 API Endpoints

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Full health report (MongoDB, Redis, BullMQ, memory) |
| GET | `/api/health/ping` | Lightweight liveness probe |

### Planned (scaffold-ready in `routes/index.ts`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login + get JWT pair |
| GET | `/api/sequences` | List sequences |
| POST | `/api/sequences` | Create sequence |
| GET | `/api/contacts` | List contacts |
| POST | `/api/contacts` | Add contact |
| POST | `/api/emails/enroll` | Enroll contact in sequence |

---

## 🏗️ Architecture Overview

```
Request
  │
  ▼
[Helmet + CORS]           Security headers
  │
[Rate Limiter]            express-rate-limit (3 tiers)
  │
[Request Logger]          Morgan → Winston
  │
[Routes]                  /api/...
  │
[Validate Middleware]     Zod schema validation
  │
[Auth Middleware]         JWT verify + RBAC
  │
[Controller]              Business logic
  │
[Mongoose]  [IORedis]     Data persistence
  │
[BullMQ Queue]            Async email jobs → Worker
  │
[Nodemailer]              SMTP send
  │
[Error Handler]           Global catch-all
```

---

## 🔒 Security Features

- **Helmet** — HTTP security headers
- **CORS** — Configurable per-origin allowlist
- **JWT** — Access + refresh token pair
- **bcryptjs** — Password hashing (rounds configurable)
- **AES-256-CBC** — Encryption for SMTP credentials stored in DB
- **Zod** — Runtime validation on all inputs
- **Rate limiting** — 3 tiers: API (100/15min), Auth (10/15min), Email (50/hr)

---

## 📋 Environment Variables Reference

See [`.env.example`](./backend/.env.example) for the full list with descriptions.

---

## 🚀 Production Deployment

```bash
# Build
npm run build

# Set NODE_ENV
$env:NODE_ENV = "production"

# Start
npm start
```

> In production, ensure `LOG_LEVEL=info`, `NODE_ENV=production`, and use a process manager like **PM2** or a container orchestrator.

---

## 📦 Tech Stack

| Package | Purpose |
|---------|---------|
| `express` | HTTP framework |
| `mongoose` | MongoDB ODM |
| `bullmq` | Job queue (email scheduling) |
| `ioredis` | Redis client |
| `nodemailer` | Email sending |
| `zod` | Schema validation |
| `winston` | Structured logging |
| `jsonwebtoken` | JWT auth |
| `bcryptjs` | Password hashing |
| `helmet` | Security headers |
| `cors` | Cross-origin requests |
| `express-rate-limit` | Rate limiting |
| `compression` | gzip responses |
| `morgan` | HTTP request logging |
| `dotenv` | Env file loading |

---

*Built with ❤️ — Email Sequencing Module v1.0.0*
