<h1 align="center">
  Ganbari Quest
</h1>

<p align="center">
  <strong>Turn your child's efforts into an RPG adventure -- A family gamification web app</strong>
</p>

<p align="center">
  <a href="https://github.com/sponsors/Takenori-Kusaka"><img src="https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?logo=github" alt="Sponsor"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <img src="https://img.shields.io/badge/SvelteKit-2-FF3E00?logo=svelte&logoColor=white" alt="SvelteKit 2">
  <img src="https://img.shields.io/badge/Svelte-5_(Runes)-FF3E00?logo=svelte&logoColor=white" alt="Svelte 5">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker">
</p>

<p align="center">
  English | <a href="./README.md">Japanese (日本語)</a>
</p>

---

## What is Ganbari Quest?

Ganbari Quest is an open-source web app that motivates children (ages 0--18) through RPG-style gamification. Kids earn points, level up, collect titles, and customize avatars by completing daily activities -- from homework and chores to sports and creative work.

Designed for **Japanese families** but adaptable to any culture. Runs entirely on your home network with **zero cloud dependency** -- your children's data stays in your home.

## Features

- **RPG Gamification** -- Levels, 5 status categories, title collection, combo bonuses, and daily missions
- **Age-Adaptive UI** -- 5 modes (baby / preschool / elementary / junior / senior) that automatically adjust font size, tap targets, and information density
- **2-Tap Recording** -- Simple activity logging with daily missions and checklists
- **Benchmark Comparison** -- Developmental psychology-based percentile rankings to visualize your child's strengths
- **Privacy First** -- Runs on your LAN, no external data transmission required
- **Avatar Customization** -- Spend earned points on backgrounds, frames, and effects
- **Career Planning** -- Mandala chart goal-setting (inspired by Shohei Ohtani's method)
- **Self-Hostable** -- One-command Docker deployment, fully open source

## Quick Start

### Prerequisites

| Requirement | Version |
|-------------|---------|
| Docker & Docker Compose | 20.10+ / v2+ |
| **-- OR --** | |
| Node.js | 22+ |
| npm | 10+ |

### Option 1: Docker (Recommended for self-hosting)

```bash
git clone https://github.com/Takenori-Kusaka/ganbari-quest.git
cd ganbari-quest
docker compose up -d
```

Open `http://localhost:3000`. The setup wizard will guide you through initial configuration.

**What happens on first boot:**
1. The Docker image is built (multi-stage, Node.js 22 Alpine-based)
2. SQLite database is automatically created in `./data/`
3. Schema is applied and seed data is loaded
4. The app starts on port 3000

### Option 2: Local Development

```bash
git clone https://github.com/Takenori-Kusaka/ganbari-quest.git
cd ganbari-quest
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173` for the development server with hot reload.

## Configuration

Copy `.env.example` to `.env` and configure as needed. All variables have sensible defaults -- the app works out of the box with zero configuration.

### Core Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `./data/ganbari-quest.db` | Path to SQLite database file |
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `3000` | HTTP port |
| `ORIGIN` | Auto-detected | Full app URL (set explicitly when behind a reverse proxy) |

### Optional Integrations

| Variable | Description |
|----------|-------------|
| `AI_PROVIDER` | AI provider: `gemini` or `bedrock` (for AI-generated avatar images) |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/) API key (when `AI_PROVIDER=gemini`) |
| `GDRIVE_CLIENT_ID` | Google Drive backup -- OAuth client ID |
| `GDRIVE_CLIENT_SECRET` | Google Drive backup -- OAuth client secret |
| `GDRIVE_REFRESH_TOKEN` | Google Drive backup -- OAuth refresh token |
| `GDRIVE_FOLDER_ID` | Google Drive backup -- target folder ID |
| `DISCORD_ALERT_WEBHOOK_URL` | Discord webhook for 500 error notifications |
| `LOG_LEVEL` | Logging level (default: `info`) |

### Backup Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_DIR` | `./data/backups` | Local backup directory |
| `BACKUP_RETENTION` | `10` | Number of backup files to keep |
| `BACKUP_POST_HOOK` | -- | Post-backup script (e.g., `node scripts/hooks/gdrive-upload.cjs`) |

> **Note:** Production SaaS settings (`AWS_LICENSE_SECRET`, `STRIPE_*`, `CRON_SECRET`, etc.) are not needed for self-hosting. Self-hosted instances run with all core features available. See `.env.example` for the full list.

## Self-Hosting Guide

### Minimum System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 core | 2 cores |
| RAM | 512 MB | 1 GB |
| Storage | 500 MB | 2 GB (with backups) |
| OS | Any Docker-compatible OS | Linux |

### Basic Deployment

```bash
# Clone and start
git clone https://github.com/Takenori-Kusaka/ganbari-quest.git
cd ganbari-quest
docker compose up -d

# View logs
docker compose logs -f app

# Stop
docker compose down

# Update to latest version
git pull
docker compose up -d --build
```

### Data Persistence

The following directories are mounted as Docker volumes and persist across container restarts:

| Directory | Contents |
|-----------|----------|
| `./data/` | SQLite database and backups |
| `./uploads/` | User-uploaded files (avatars, etc.) |
| `./generated/` | AI-generated images |
| `./tenants/` | Tenant-specific data |

### Automated Backups

Enable the backup sidecar to run daily backups at 3:00 AM (JST):

```bash
docker compose --profile backup up -d
```

To enable Google Drive cloud backup, set the `GDRIVE_*` variables in your `.env` file. See `.env.example` for details.

### HTTPS with Reverse Proxy

For production deployments with HTTPS, uncomment the Caddy section in `docker-compose.yml` and create a `Caddyfile`:

```
your-domain.example.com {
    reverse_proxy app:3000
}
```

Then update your `.env`:

```bash
ORIGIN=https://your-domain.example.com
```

Alternatively, use any reverse proxy (nginx, Traefik, etc.) that terminates TLS and forwards to port 3000.

### Accessing from Other Devices on LAN

To access from phones and tablets on your home network:

1. Find your server's local IP (e.g., `192.168.1.100`)
2. Set `ORIGIN=http://192.168.1.100:3000` in `.env`
3. Restart: `docker compose up -d`
4. Access from any device at `http://192.168.1.100:3000`

### Health Check

The app exposes a health endpoint at `GET /api/health`, used by Docker's built-in `HEALTHCHECK`.

## Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | SvelteKit 2 + Svelte 5 (Runes) |
| UI | Ark UI Svelte (Headless) + Custom Design System |
| Database | SQLite (WAL mode) + Drizzle ORM |
| Testing | Vitest + Playwright |
| Lint/Format | Biome + ESLint + Stylelint |
| Language | TypeScript (strict) |
| Infrastructure | Docker + Node.js 22 |

## Development

### Commands

```bash
npm run dev              # Dev server (http://localhost:5173)
npm run build            # Production build
npx vitest run           # Unit tests
npx playwright test      # E2E tests
npx biome check .        # Lint & format
npx svelte-check         # Type checking
npx drizzle-kit push     # Apply DB migrations
```

### Project Structure

```
ganbari-quest/
├── src/
│   ├── routes/              # SvelteKit file-based routing
│   │   ├── (child)/         # Child-facing pages (age-adaptive)
│   │   ├── (parent)/        # Parent admin panel (PIN-protected)
│   │   └── api/             # REST API endpoints
│   └── lib/
│       ├── ui/              # Ark UI wrappers + shared components
│       ├── features/        # Feature modules (career, avatar, etc.)
│       ├── domain/          # Domain models & validation
│       └── server/          # DB & service layer (server-only)
├── docs/design/             # Design documents
├── tests/                   # Unit & E2E tests
├── scripts/                 # Migration, backup, CI scripts
├── infra/                   # AWS CDK infrastructure (SaaS)
├── docker-compose.yml       # Docker deployment config
└── Dockerfile               # Multi-stage production build
```

## SaaS vs Self-Hosted

| | Self-Hosted (this repo) | SaaS |
|---|---|---|
| **Cost** | Free (your hardware) | Free tier + paid plans |
| **Data location** | Your server | Cloud (AWS) |
| **Setup** | `docker compose up -d` | Sign up at website |
| **Updates** | `git pull && docker compose up -d --build` | Automatic |
| **Auth** | Local PIN-based | AWS Cognito (Google SSO) |
| **AI features** | Bring your own API key | Included |
| **Backups** | Manual or cron | Automatic |
| **Support** | Community (GitHub Issues) | Email support |

## Contributing

Bug reports, feature requests, and PRs are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

> **Note:** The UI is currently in Japanese only. Internationalization (i18n) contributions are especially welcome.

## Community & Support

- **Issues & Discussions**: [GitHub Issues](https://github.com/Takenori-Kusaka/ganbari-quest/issues)
- **Email**: [ganbari.quest.support@gmail.com](mailto:ganbari.quest.support@gmail.com)
- **Sponsor**: [GitHub Sponsors](https://github.com/sponsors/Takenori-Kusaka)

## License

[AGPL-3.0](./LICENSE) -- Free to use, self-host, and modify. If you distribute a modified version as a network service, you must share your source code under the same license.
