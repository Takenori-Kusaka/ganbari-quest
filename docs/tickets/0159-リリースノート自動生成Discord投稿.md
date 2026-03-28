# #0159 リリースノート自動生成・Discord 投稿

## Status: Done
## 優先度: 中
## 種別: 開発者体験 / CI/CD 改善

---

## 概要

main ブランチへの push で本番デプロイが成功した際、
コミット内容を **ユーザー向けの日本語リリースノート** に変換して Discord `#アップデート情報` へ自動投稿する。

---

## 現状と問題

### 現在の `notify` ジョブ（`deploy.yml` 末尾）

```
Deploy Success / Deploy Failed のみ通知
- Version: dev-abc1234
- Commit: abc1234
- Author: kokor
```

→ **技術者向けの内容のみ**。Discord を見るユーザー（がんばりクエストの利用者）には意味がない。

### 現在の `release` ジョブ

- `refs/tags/v*` の push 時のみ実行（タグなし main push では動かない）
- `generate_release_notes: true` は GitHub が PR タイトルを自動収集するが、英語のコミットメッセージがそのまま出る

### 解決ゴール

```
[コミット（開発者向け）]
  feat: add avatar sound selection in shop
  fix: omikuji animation skip when prefers-reduced-motion
  chore: update CDK stack dependencies

        ↓ Gemini API で変換

[リリースノート（ユーザー向け・日本語）]
  🎵 ごほうびショップにサウンドの選択機能が追加されました
  ✨ モーション設定を使っているお子様でもおみくじ演出が正しく動くようになりました
  ※ インフラ改善のみのコミットは省略
```

---

## 設計

### 処理フロー

```
deploy ジョブ成功
  └── release-notes ジョブ（新規）
        ├── 1. 直前デプロイからのコミット差分を取得
        │       git log <前回SHA>..<今回SHA> --format="%s %b"
        ├── 2. Gemini API でユーザー向け日本語変換
        │       ユーザー向け変化がなければ "skip" を返させる
        ├── 3. スキップ判定
        │       変換結果が "skip" → 投稿なし（インフラ・テスト改善のみの場合）
        └── 4. Discord #アップデート情報 に Embed 投稿
```

### Discord への投稿フォーマット

```
🎉 アップデートのお知らせ（2026-03-28）

🆕 新機能・改善
  • ごほうびショップにサウンド選択機能が追加されました 🎵
  • おみくじ演出が「動きを減らす」設定でも正しく動くようになりました

🐛 不具合修正
  • ★評価とスコアの表示が一致しない問題を修正しました

ご意見・ご要望は #機能要望 チャンネルへどうぞ！
```

---

## 実装方法

### 新規ジョブ: `release-notes`

`deploy.yml` に `notify` ジョブの前に以下を追加する。

```yaml
release-notes:
  needs: [deploy, e2e-production]
  runs-on: ubuntu-latest
  if: needs.deploy.result == 'success' && needs.e2e-production.result != 'failure'
  steps:
    - uses: actions/checkout@v6
      with:
        fetch-depth: 50  # 差分取得に必要

    - name: Get commit messages since last deploy
      id: commits
      run: |
        # 直前のデプロイタグまたは直前コミットとの差分を取得
        PREV=$(git tag --sort=-creatordate | grep '^deploy-' | head -2 | tail -1 || echo "HEAD~10")
        MESSAGES=$(git log ${PREV}..HEAD --format="- %s" --no-merges | head -30)
        echo "messages<<EOF" >> "$GITHUB_OUTPUT"
        echo "$MESSAGES" >> "$GITHUB_OUTPUT"
        echo "EOF" >> "$GITHUB_OUTPUT"

    - name: Tag current deploy
      run: |
        git config user.name "github-actions[bot]"
        git config user.email "github-actions[bot]@users.noreply.github.com"
        git tag "deploy-$(date +%Y%m%d-%H%M%S)-$(echo ${{ github.sha }} | cut -c1-7)"
        git push origin --tags
      continue-on-error: true

    - name: Generate user-facing release notes (Gemini)
      id: release-notes
      env:
        GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
        COMMIT_MESSAGES: ${{ steps.commits.outputs.messages }}
        DEPLOY_DATE: ${{ github.event.head_commit.timestamp }}
      run: |
        PROMPT="以下は「がんばりクエスト」（子供の活動をゲーミフィケーションで動機付けする家庭内Webアプリ）の開発コミットメッセージです。
        これをアプリを使う保護者・家族向けに、やさしい日本語でリリースノートに変換してください。

        ルール:
        - ユーザーに見える変化（機能追加・UI改善・バグ修正）のみを記載する
        - インフラ・依存関係・テスト・リファクタリングのみの場合は「SKIP」とだけ返す
        - 「🆕 新機能・改善」「🐛 不具合修正」のカテゴリで分けて箇条書きにする
        - 各項目は「〜しました」「〜できるようになりました」で終わる文体にする
        - 技術用語（commit hash, CDK, Lambda等）は使わない
        - 最大 8 項目まで

        コミット:
        ${COMMIT_MESSAGES}"

        RESPONSE=$(curl -s \
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_API_KEY}" \
          -H "Content-Type: application/json" \
          -d "{\"contents\":[{\"parts\":[{\"text\":$(echo "$PROMPT" | jq -Rs .)}]}]}")

        NOTES=$(echo "$RESPONSE" | jq -r '.candidates[0].content.parts[0].text // "SKIP"')
        echo "notes<<EOF" >> "$GITHUB_OUTPUT"
        echo "$NOTES" >> "$GITHUB_OUTPUT"
        echo "EOF" >> "$GITHUB_OUTPUT"

    - name: Post release notes to Discord
      if: steps.release-notes.outputs.notes != 'SKIP'
      env:
        WEBHOOK_URL: ${{ vars.DISCORD_RELEASE_NOTES_WEBHOOK_URL }}
        NOTES: ${{ steps.release-notes.outputs.notes }}
        DATE: ${{ github.event.head_commit.timestamp }}
      run: |
        if [ -z "$WEBHOOK_URL" ]; then
          echo "DISCORD_RELEASE_NOTES_WEBHOOK_URL not set, skipping"
          exit 0
        fi
        DATE_JP=$(date -d "$DATE" +"%Y年%-m月%-d日" 2>/dev/null || date +"%Y年%-m月%-d日")
        BODY="🎉 アップデートのお知らせ（${DATE_JP}）\n\n${NOTES}\n\nご意見・ご要望は <#機能要望> チャンネルへどうぞ！"
        curl -s -X POST "$WEBHOOK_URL" \
          -H "Content-Type: application/json" \
          -d "{
            \"embeds\": [{
              \"title\": \"🎉 アップデートのお知らせ\",
              \"description\": $(echo "$NOTES\n\nご意見・ご要望は **#機能要望** チャンネルへどうぞ！" | jq -Rs .),
              \"color\": 5763719,
              \"footer\": {\"text\": \"がんばりクエスト • ${DATE_JP}\"}
            }]
          }"
```

---

## GitHub Actions 変数・シークレットの追加

| 種別 | 名前 | 値 | 用途 |
|-----|-----|---|-----|
| **Secret** | `GEMINI_API_KEY` | Gemini API キー | リリースノート生成 |
| **Variable** | `DISCORD_RELEASE_NOTES_WEBHOOK_URL` | `#アップデート情報` の Webhook URL | ユーザー向け投稿 |

> 既存の `vars.DISCORD_WEBHOOK_URL`（内部 `#deploy-log`）とは**別チャンネルの別 URL** を使う。
> 既存の notify ジョブはそのまま維持し、内部ログとして機能させ続ける。

---

## Gemini モデルの選定

| モデル | 特徴 | 推奨度 |
|-------|-----|-------|
| `gemini-2.0-flash-lite` | 無料枠あり・高速・コスト最小 | **◎ 推奨** |
| `gemini-2.0-flash` | より高精度 | ○ 必要なら |

コミット変換は数百トークンの単純タスクのため `flash-lite` で十分。

---

## スキップ条件

以下のコミットのみで構成されるプッシュは **Discord 投稿をスキップ** する:

```
chore:    依存関係更新、ビルド設定
ci:       CI/CD 設定変更
infra:    CDK・インフラ変更
test:     テスト追加のみ
docs:     ドキュメントのみ
refactor: 内部リファクタリングのみ
style:    フォーマット・lint のみ
```

Gemini に「SKIPのみを返す」よう指示することで制御する。

---

## 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `.github/workflows/deploy.yml` | `release-notes` ジョブの追加 |

---

## 受け入れ条件

- [x] ユーザーに見える機能変更がある push で `#アップデート情報` に日本語投稿される
- [x] インフラ・テスト・リファクタリングのみの push では投稿されない（SKIP 判定）
- [x] デプロイ失敗時・E2E 失敗時には投稿されない
- [x] 既存の `notify` ジョブ（内部 `#deploy-log`）は従来通り動作し続ける
- [x] `DISCORD_RELEASE_NOTES_WEBHOOK_URL` が未設定でも他のジョブはエラーにならない
- [x] `GEMINI_API_KEY` が未設定でもジョブが graceful に失敗し、デプロイ自体はブロックされない

---

## 備考

- Gemini API の無料枠: `gemini-2.0-flash-lite` は分あたり 30 リクエスト・1分あたり 100万トークン（2025年現在）。  
  デプロイ頻度を考えると無料枠で十分。
- デプロイ差分の取得方法として `deploy-YYYYMMDD-HHMMSS-HASH` 形式の軽量タグを打つことで、  
  次回デプロイ時の差分取得基点にする。タグが存在しない場合は `HEAD~10` を fallback とする。
- Discord の `<#チャンネルID>` メンションはチャンネル ID が必要（チャンネル名では動作しない）。  
  セットアップ時に実際の ID に置換すること。
