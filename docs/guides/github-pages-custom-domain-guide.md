# GitHub Pages カスタムドメイン設定ガイド — がんばりクエスト

## 概要

LP（`site/`）を `www.ganbari-quest.com` でアクセスできるようにするための設定手順です。
CDK デプロイ（AWS 操作）と GitHub Settings の GUI 操作が必要です。

> **前提**: `site/CNAME` ファイルは既にコミット済みです。CDK コード修正と GitHub 設定のみ必要です。

---

## Step 1: CDK で Route53 の www レコードを変更

現在 `www.ganbari-quest.com` は CloudFront（SaaS アプリ）に向いています。
これを GitHub Pages に向けるため、CDK コードを修正してデプロイします。

### 1-1: CDK コードの確認

```bash
cd C:\Users\kokor\OneDrive\Document\GitHub\ganbari-quest\infra
```

`infra/lib/network-stack.ts` の `WwwRecord` を確認:

```typescript
// 変更前（CloudFront に向けている）
new route53.CnameRecord(this, 'WwwRecord', {
  zone: hostedZone,
  recordName: 'www',
  domainName: props.domainName,  // CloudFront alias
});

// ↓ 変更後（GitHub Pages に向ける）
new route53.CnameRecord(this, 'WwwRecord', {
  zone: hostedZone,
  recordName: 'www',
  domainName: 'kokor.github.io',  // GitHub Pages
});
```

### 1-2: CDK デプロイ

```bash
cd infra
npx cdk diff NetworkStack   # 変更内容を事前確認
npx cdk deploy NetworkStack  # Route53 レコードのみ変更
```

> **注意**: デプロイ後、Step 3 が完了するまで `www.ganbari-quest.com` は一時的に 404 になります。

---

## Step 2: DNS 反映の確認

```bash
# Windows
nslookup www.ganbari-quest.com

# 結果が kokor.github.io を指していれば OK
```

反映に数分〜30分程度かかる場合があります。

---

## Step 3: GitHub リポジトリの Pages 設定

1. https://github.com/kokor/ganbari-quest/settings/pages を開く
2. **Custom domain** 欄に `www.ganbari-quest.com` を入力
3. **Save** をクリック
4. DNS チェックが走り、**「DNS check successful」** と表示されるまで待つ（通常数分）
5. **「Enforce HTTPS」** チェックボックスを有効化

> HTTPS は GitHub が Let's Encrypt 証明書を自動発行します。
> 発行に最大30分かかることがあります。

---

## Step 4: 動作確認

以下を全てブラウザで確認してください:

- [ ] `https://www.ganbari-quest.com` で LP が表示される
- [ ] `http://www.ganbari-quest.com` が `https://` にリダイレクトされる
- [ ] `https://ganbari-quest.com` で SaaS アプリが引き続き正常表示される（影響なし）

---

## Step 5: OGP URL の更新（任意）

LP の canonical URL を `www` に統一する場合、`site/index.html` の OGP を更新:

```html
<!-- 現在 -->
<meta property="og:url" content="https://ganbari-quest.com">

<!-- www に統一する場合 -->
<meta property="og:url" content="https://www.ganbari-quest.com">
```

> これは SEO に影響するため、更新するかどうかは任意です。

---

## トラブルシューティング

### DNS check が失敗する

- CDK デプロイが完了しているか確認（`nslookup www.ganbari-quest.com`）
- DNS 反映待ち（最大48時間、通常30分以内）
- `site/CNAME` ファイルが main ブランチに存在するか確認

### HTTPS が有効にならない

- DNS check successful が表示されてから「Enforce HTTPS」を有効化
- Let's Encrypt 証明書の発行に最大30分待つ
- それでも失敗する場合は一度 Custom domain を削除→再設定

### CDK デプロイでエラー

```bash
# まずは diff で変更内容を確認
npx cdk diff NetworkStack

# スタックの状態確認
npx cdk list
```

---

## 完了チェックリスト

- [ ] CDK コード修正（`WwwRecord` → `kokor.github.io`）
- [ ] `npx cdk deploy NetworkStack` 成功
- [ ] DNS 反映確認（`nslookup www.ganbari-quest.com` → `kokor.github.io`）
- [ ] GitHub Settings → Pages → Custom domain 設定
- [ ] DNS check successful 表示
- [ ] Enforce HTTPS 有効化
- [ ] `https://www.ganbari-quest.com` で LP 表示確認
- [ ] `https://ganbari-quest.com` で SaaS アプリ影響なし確認
