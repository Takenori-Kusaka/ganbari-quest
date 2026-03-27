# 0062 GitHub Sponsors・支援者募集基盤

## Status: Done

### メタ情報

| 項目 | 値 |
|------|-----|
| フェーズ | Phase 1: 事前調査・プロトタイプ |
| 難易度 | 低 |
| 優先度 | 中 |
| 要件番号 | 2 |
| 依存チケット | #0061 |
| 規定書対応 | 第4章 販売戦略書（資金調達） |

---

### 概要

GitHub SponsorsおよびPatreonを設定し、OSSとしての支援者を募る基盤を構築する。

### 背景・動機

SaaS展開前の段階でも、OSSプロジェクトとして支援を受けることで開発モチベーションと持続性を確保できる。Cal.com, Plausible等の成功事例では、OSS段階からSponsorsで収益化している。

### ゴール

- [ ] GitHub Sponsorsプロフィール設定 — ユーザーが https://github.com/sponsors/Takenori-Kusaka で設定
- [x] FUNDING.yml作成 → `.github/FUNDING.yml`
- [ ] Sponsor Tier設計（3段階程度） — GitHub Sponsors管理画面で設定
- [ ] Patreonページ作成（任意） — 将来対応
- [x] READMEにSponsorsバッジ追加 → `README.md` Sponsorバッジ + サポートセクション

### 対応方針

#### GitHub Sponsors設定
1. `.github/FUNDING.yml` を作成
```yaml
github: [your-username]
patreon: ganbari-quest
custom: ["https://www.buymeacoffee.com/ganbari-quest"]
```

2. Sponsors Tier設計
| Tier | 月額 | 特典 |
|------|------|------|
| コーヒー | $3 | READMEにお名前掲載 |
| サポーター | $10 | 上記 + 優先Issue対応 |
| スポンサー | $25 | 上記 + Discordプライベートチャンネル |

#### Patreon（補助）
- GitHub Sponsorsがメイン
- Patreonは日本ユーザー向け補助（クレカ決済対応）

#### 注意事項
- GitHub Sponsorsは日本在住でも利用可能（Stripe Connect経由）
- 確定申告が必要（雑所得 or 事業所得）
- 年間20万円超で申告義務

### 残課題・次のアクション

- Sponsors収益が安定したらSaaS開発に着手
- 支援者向けのロードマップ公開

### 成果・結果

- **FUNDING.yml**: `.github/FUNDING.yml` に `github: [Takenori-Kusaka]` を設定
- **README**: Sponsorバッジ追加 + 「サポート」セクション追加
- **注意**: GitHub Sponsorsプロフィール設定・Tier設計はGitHub管理画面での手動設定が必要
