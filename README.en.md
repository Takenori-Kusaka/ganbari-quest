<h1 align="center">
  Ganbari Quest
</h1>

<p align="center">
  <strong>Turn your child's efforts into an RPG adventure — A family gamification web app</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <img src="https://img.shields.io/badge/SvelteKit-2-FF3E00?logo=svelte&logoColor=white" alt="SvelteKit 2">
  <img src="https://img.shields.io/badge/Svelte-5_(Runes)-FF3E00?logo=svelte&logoColor=white" alt="Svelte 5">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/tests-606_passing-brightgreen" alt="Tests">
</p>

<p align="center">
  English | <a href="./README.md">日本語</a>
</p>

---

## What is Ganbari Quest?

Ganbari Quest is an open-source web app that motivates children through RPG-style gamification. Kids earn points, level up, and collect titles by completing daily activities — from homework and chores to sports and creative work.

Designed for **Japanese families** but adaptable to any culture. Runs entirely on your home network with zero cloud dependency.

## Features

- **RPG Gamification** — Levels, 5 status categories, title collection, combo bonuses
- **Age-Adaptive UI** — Automatically adjusts from baby (0-3) to kinder (4-9) to teen (10+)
- **2-Tap Recording** — Simple activity logging with daily missions and checklists
- **Benchmark Comparison** — Developmental psychology-based percentile rankings
- **Privacy First** — Runs on your LAN, no external data transmission
- **Avatar Customization** — Spend points on backgrounds, frames, and effects
- **Career Planning** — Mandala chart goal-setting (inspired by Shohei Ohtani)
- **Self-Hostable** — One-command Docker deploy. Fully open source

## Quick Start

### Docker (Recommended)

```bash
git clone https://github.com/Takenori-Kusaka/ganbari-quest.git
cd ganbari-quest
docker compose up -d
```

Open `http://localhost:3000`. The setup wizard will guide you through initial configuration.

### Local Development

```bash
git clone https://github.com/Takenori-Kusaka/ganbari-quest.git
cd ganbari-quest
npm install
cp .env.example .env
npm run dev
```

## Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | SvelteKit 2 + Svelte 5 (Runes) |
| UI | Ark UI Svelte (Headless) + Custom Design System |
| Database | SQLite (WAL mode) + Drizzle ORM |
| Testing | Vitest (606 tests) + Playwright |
| Lint/Format | Biome |
| Language | TypeScript (strict) |
| Infrastructure | Docker + Node.js 22 |

## Contributing

Bug reports, feature requests, and PRs are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

> Note: The UI is currently in Japanese only. Internationalization (i18n) is planned for future releases.

## License

[AGPL-3.0](./LICENSE) — Free to use, self-host, and modify.
