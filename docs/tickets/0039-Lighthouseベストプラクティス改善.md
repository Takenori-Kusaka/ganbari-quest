# Lighthouseベストプラクティス改善（HTTPS対応基盤）

### ステータス

`Send off`

---

### 概要

Docker化（#0040）と合わせてHTTPS対応の基盤を整備する。LAN内運用ではHTTPを許容しつつ、OSSとして外部公開する利用者がドメイン+Let's Encryptで即座にHTTPS化できる構成を提供する。

### 背景・動機

本番環境（NUCサーバー LAN内HTTP）でのLighthouse測定でBest Practicesが78点。内訳:
- `is-on-https` (weight 5): HTTPS未使用 → score 0（-18.5pt相当）
- `redirects-http` (weight 1): HTTP→HTTPSリダイレクトなし → score 0（-3.7pt相当）

他の全項目は満点（合計27weight中21earned）。HTTPS対応すれば100点になる。

**ただし現時点では対応しない。** 理由:
- 日下家のNUC環境はLAN内専用でドメインがなく、自己署名証明書しか使えない
- 自己署名証明書ではブラウザ警告が出て実用上のメリットが薄い
- 各端末へのCA証明書配布の運用コストが高い

**将来対応として**: OSSとして一般公開した際に、外部サービスとして運用する利用者がドメインを取得してLet's Encryptで自動HTTPS化できるよう、Docker Compose内にリバースプロキシの構成を用意しておく。

### ゴール

- [ ] Docker Compose にCaddyリバースプロキシのサービスを含める（#0040と統合）
- [ ] Caddyfile を用意し、環境変数でHTTP/HTTPS切り替え可能にする
  - `ENABLE_HTTPS=false`（デフォルト）: HTTP のみ（LAN内運用向け）
  - `ENABLE_HTTPS=true` + `DOMAIN=example.com`: Let's Encrypt 自動HTTPS
- [ ] INSTALLATION.md にHTTPS有効化手順を記載
- [ ] HTTP運用時もセキュリティヘッダ（X-Frame-Options, X-Content-Type-Options等）を付与

### 技術方針

**Caddy リバースプロキシ（#0040のdocker-compose.ymlに統合）**

```
# Caddyfile（HTTP モード: デフォルト）
:80 {
    reverse_proxy app:3000
    header X-Frame-Options DENY
    header X-Content-Type-Options nosniff
}

# Caddyfile（HTTPS モード: ドメイン設定時）
{$DOMAIN} {
    reverse_proxy app:3000
    header X-Frame-Options DENY
    header X-Content-Type-Options nosniff
}
```

環境変数 `ENABLE_HTTPS` に応じてCaddyfileを切り替えるentrypointスクリプトを用意する。

### 依存

- #0040 Docker化・CI/CD改善（統合して実装）

### 作業メモ

- 2026-03-03: Lighthouse分析の結果、減点はHTTPS関連2項目のみと判明
- 2026-03-03: LAN内運用では対応不要と判断。OSS公開時の基盤として将来対応に変更
- セキュリティヘッダの付与はHTTPでも有効なので、Caddy導入と同時に設定する

### 成果・結果

### 残課題・次のアクション

- LAN内でもHTTPS化したい場合のmkcert手順をドキュメント化（オプショナル）
- Lighthouse CI（定期測定・スコア監視）の導入検討
