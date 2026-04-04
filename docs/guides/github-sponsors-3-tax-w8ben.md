# GitHub Sponsors 設定ガイド (3/4) — W-8BEN 税務書類の提出

## 概要

日本居住者として GitHub Sponsors で収益を受け取るために、W-8BEN（米国非居住者の所得税免除申告書）を提出します。

**所要時間**: 約15分
**必要なもの**: マイナンバー（個人番号）、パスポートと同じローマ字氏名

---

## 前提条件

- [ ] ガイド 1/4（プロフィール作成）が完了していること
- [ ] ガイド 2/4（Tier 作成）が完了していること
- [ ] Stripe Connect アカウントが作成済みであること

---

## なぜ W-8BEN が必要か

GitHub はアメリカの企業です。日本居住者がアメリカ企業から収益を受け取る場合、**米国側で最大30%の源泉徴収**が発生する可能性があります。

W-8BEN を提出し、**日米租税条約**の適用を申請することで、源泉徴収率を **0%** にできます。

| 状態 | 源泉徴収率 |
|------|-----------|
| W-8BEN **未提出** | **最大30%** |
| W-8BEN 提出（マイナンバーなし） | **最大30%**（条約適用不可の場合あり） |
| W-8BEN 提出（マイナンバーあり） | **0%**（日米租税条約適用） |

---

## Step 1: 税務フォームにアクセス

1. https://github.com/sponsors/Takenori-Kusaka/dashboard にアクセス
2. 左サイドバー上部 → **「Overview」**
3. ページ内の **「Tax forms」** セクション、または左サイドバーの **「Tax information」** をクリック
4. **「Submit W-8BEN」** のリンクまたはボタンをクリック
5. DocuSign の画面が開きます

---

## Step 2: W-8BEN フォームの記入

DocuSign 上で以下のフィールドを記入します。

### Part I: Identification of Beneficial Owner

| フィールド | 記入内容 | 例 |
|-----------|---------|-----|
| **1. Name of individual** | パスポートと同じローマ字氏名 | `Takenori Kusaka` |
| **2. Country of citizenship** | `Japan` | |
| **3. Permanent residence address** | 日本の住所（英語表記） | `1-2-3 Shibuya, Shibuya-ku, Tokyo, Japan` |
| **4. Mailing address** | 同上（同じなら空欄でOK） | |
| **5. U.S. taxpayer identification number (SSN or ITIN)** | **空欄のまま**（持っていない場合） | |
| **6. Foreign tax identifying number** | **マイナンバー（個人番号12桁）** | `123456789012` |
| **7. Reference number(s)** | **空欄でOK** | |
| **8. Date of birth** | 生年月日（MM-DD-YYYY形式） | `01-15-1990` |

> **重要**: フィールド6の **マイナンバーは必ず入力**してください。未入力だと日米租税条約が適用されず、30%源泉徴収される可能性があります。

### 住所の英語表記について

日本語住所を英語に変換する際の順序:

```
日本語: 〒150-0002 東京都渋谷区渋谷1-2-3 マンション名 101号室

英語:   Room 101, Mansion Name
        1-2-3 Shibuya, Shibuya-ku
        Tokyo 150-0002
        Japan
```

フォーム上で複数行に分かれている場合:
- **Street**: `1-2-3 Shibuya, Shibuya-ku`（番地・区）
- **City**: `Tokyo`（都道府県）
- **Country**: `Japan`
- **Postal code**: `150-0002`

---

### Part II: Claim of Tax Treaty Benefits

| フィールド | 記入内容 |
|-----------|---------|
| **9. Country** | `Japan` を選択 |
| **Article number** | `7`（Business Profits） |
| **Withholding rate** | `0`%（0%を入力） |
| **Type of income** | `Services` または `Royalties`（選択肢による） |

> **解説**: 日米租税条約の第7条（事業利得）により、日本居住者のオンラインサービス収入は米国での源泉徴収が免除されます。

---

### Part III: Certification（署名）

1. **署名**（DocuSign上での電子署名）
2. **日付**（自動入力される場合が多い）
3. **Capacity**（個人の場合は空欄、または `Individual`）

→ **「Finish」** または **「Submit」** をクリック

---

## Step 3: 提出完了の確認

1. DocuSign の画面が閉じ、GitHub の税務ページに戻る
2. ステータスが **「Submitted」** または **「Verified」** になっていることを確認
3. 問題がある場合は GitHub からメールで通知が届きます

---

## よくある質問

### Q: マイナンバーカードは必要？
**A**: カード自体は不要です。通知カードやマイナンバーが記載された住民票で確認できる **12桁の個人番号** がわかれば OK です。

### Q: W-8BEN の有効期限は？
**A**: **提出日から3年間**有効です。期限切れ前に GitHub から再提出の通知が届きます。カレンダーにリマインダーを設定しておくことを推奨します。

### Q: 確定申告は必要？
**A**: GitHub Sponsors の収入は**雑所得**（または事業所得）として確定申告が必要です。年間20万円を超えると申告義務が発生します。GitHub は源泉徴収や税務書類（支払調書等）を発行しないため、自分で収支を記録してください。

### Q: 記入を間違えた場合は？
**A**: 提出後に修正が必要な場合は、GitHub Support に連絡してW-8BENの再提出をリクエストしてください。

---

## 次のステップ

→ [ガイド 4/4: 審査提出とスポンサーボタンの有効化](github-sponsors-4-review-and-activate.md)
