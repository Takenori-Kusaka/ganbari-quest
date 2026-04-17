---
name: Age Mode Check
description: Use when modifying child-facing UI to verify all 5 age modes (baby/preschool/elementary/junior/senior) are correctly handled. Checks font scale, tap size, and age-appropriate content.
---

# 年齢モード 5 重複検証

## 5 モード定義（age-tier.ts）

| コード | 日本語 | fontScale | tapSize | 特性 |
|--------|--------|-----------|---------|------|
| `baby` | 乳幼児 (0-2歳) | 1.5 | 120px | 大きなボタン、シンプルな色 |
| `preschool` | 幼児 (3-5歳) | 1.2 | 80px | 丸い形、ひらがなのみ |
| `elementary` | 小学生 (6-12歳) | 1.0 | 56px | 標準レイアウト、漢字最小限 |
| `junior` | 中学生 (13-15歳) | 1.0 | 48px | 情報密度やや高い |
| `senior` | 高校生 (16-18歳) | 1.0 | 44px | 情報密度高い、漢字 |

## チェックリスト

### レイアウト
- [ ] baby モードでボタンが十分に大きいか（120px以上）
- [ ] preschool モードで丸みのあるデザインか
- [ ] senior モードで情報が密集しすぎていないか

### テキスト
- [ ] baby/preschool でひらがなのみか（漢字なし）
- [ ] elementary で漢字が最小限か
- [ ] labels.ts 経由の表示テキストを使用しているか（内部コード露出禁止）

### インタラクション
- [ ] 各モードの tapSize 以上のタップ領域が確保されているか
- [ ] fontScale が正しく適用されているか

### ルーティング
- [ ] `src/routes/(child)/[uiMode=uiMode]/` 配下の統合ルートを使用しているか
- [ ] 年齢モード固有のハードコードがないか（age-tier.ts の設定を参照）

## 検証手順

```bash
# 5モード全てでアクセスして目視確認
npm run dev:cognito
# ブラウザで以下を順に確認:
# /baby/... /preschool/... /elementary/... /junior/... /senior/...
```
