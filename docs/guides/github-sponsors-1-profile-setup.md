# GitHub Sponsors 設定ガイド (1/4) — プロフィール作成

## 概要

GitHub Sponsors のプロフィールページを作成します。ここで設定した内容が `https://github.com/sponsors/Takenori-Kusaka` に表示されます。

**所要時間**: 約15分

---

## 前提条件

- [ ] GitHub アカウントで **2FA（二要素認証）が有効** であること
  - 確認: https://github.com/settings/security
  - 未設定の場合は先に有効化してください

---

## Step 1: Sponsors ダッシュボードにアクセス

1. https://github.com/sponsors/Takenori-Kusaka/dashboard にアクセス
2. 初回の場合は「Join the waitlist」や「Get started」が表示されるのでクリック
3. 左サイドバーに「Profile」「Sponsor tiers」「Your goals」等のメニューが表示されれば OK

> **もし Sponsors ダッシュボードが表示されない場合**: https://github.com/sponsors にアクセスし「Get started」から申請を開始してください。

---

## Step 2: Short bio（一行紹介文）の設定

1. 左サイドバー → **「Profile」** → **「Profile details」**
2. **Short bio** 欄に以下を入力:

```
子供の成長をゲーミフィケーションで支援するOSS「がんばりクエスト」を開発しています
```

> **ポイント**: Short bio はスポンサーページの最上部に表示されます。何をしている人かが一目で分かる文を書いてください。

---

## Step 3: Introduction（詳細紹介文）の設定

同じページの **Introduction** 欄に以下のMarkdownを入力:

```markdown
## がんばりクエストについて

子供たちの日々の活動（お手伝い、勉強、運動など）をRPGのクエストに見立て、
ゲーミフィケーションで楽しく動機付けする家庭内専用Webアプリです。

0歳から18歳まで年齢に応じてUIが自動で変わり、きょうだいでも公平に使えます。

### なぜスポンサーが必要か
- AWS（Lambda / CloudFront / DynamoDB）のサーバー運用費
- ドメイン・SSL証明書の維持費
- 新機能の開発・品質向上に充てる時間の確保

### 技術スタック
SvelteKit 2 + Svelte 5 + Ark UI + SQLite + Drizzle ORM

完全オープンソースで開発しています。
セルフホスト版も提供しており、プライバシーを重視するご家庭でも安心してお使いいただけます。

### リンク
- 🌐 [がんばりクエスト公式サイト](https://ganbari-quest.com)
- 🎮 [デモを試す](https://ganbari-quest.com/demo)
- 💬 [Discord コミュニティ](https://discord.gg/5pWkf4Z5)
```

> **ポイント**: 「何のプロジェクトか」「なぜ支援が必要か」「支援金の使い道」の3点が含まれていると、スポンサーの判断材料になります。

---

## Step 4: Featured work（注目プロジェクト）の設定

1. 同じページの **Featured work** セクション
2. **「Add a repository」** をクリック
3. **`ganbari-quest`** を選択
4. 他に公開リポジトリがあれば追加（最大6つまで）

---

## Step 5: 設定の保存

ページ下部の **「Save」** または **「Update profile」** をクリック。

---

## 確認

- https://github.com/sponsors/Takenori-Kusaka にアクセス
- Short bio、Introduction、Featured work が正しく表示されていることを確認
- （この時点ではまだ Tier 未作成のため、スポンサーの受付はできません → ガイド 2/4 へ）

---

## 次のステップ

→ [ガイド 2/4: Sponsor Tier の作成](github-sponsors-2-tier-setup.md)
