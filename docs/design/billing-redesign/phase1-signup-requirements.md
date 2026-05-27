# 新規申込 要件定義 (#2532 / Epic #2525 Phase 1)

| 項目 | 内容 |
|------|------|
| 孫 issue | #2532 (新規申込の要件) |
| 親 | #2526 (Phase 1 要件定義) / 上位 #2525 |
| ステータス | Phase 1 完了 (deep-research 完了 → PO 確定 2026-05-27) |
| deep-research | Cognito / Stripe / PIPC / COPPA / 競合 UX を primary source 確認済 |

## 主要な設計判断 (3 根拠が同方向)

- **signup 時は無料プラン開始のみ** (プラン選択・trial・有料を押し付けない)。誘導は feature gate (無料上限到達時) でのみ。根拠: ① no-credit-card 業界標準 (まず無料で価値体験) ② ADR-0012 Anti-engagement (押し付け禁止) ③ 既存 `startTrial` は once-only gate 済で任意タイミング開始が技術的に成立 → signup に結合する必要なし
- 現状の `?plan=X → trial 自動開始` (signup/+page.server.ts:365-401) は**撤去対象**
- ライセンスキー入力欄は撤去
- 子供プロファイルは signup フォームでなく**オンボーディング (`/setup` 系) に委譲** (連続 2 アカウント作成の離脱要因回避)

## 機能要件 (FR)

| ID | 要件 | 設計意図 + 根拠 |
|----|------|----------------|
| FR-1 | signup は **email / password / passwordConfirm** のみ必須。ライセンスキー欄撤去 | license key 撤廃 / フィールド最小化 (1 フィールド=7% conversion 減) |
| FR-2 | **Cognito SignUp → メール確認コード → ConfirmSignUp → 自動ログイン** (メール確認必須) | AWS 公式フロー。verified email なし=forgot-password 不能=ロックアウト |
| FR-3 | Confirm 後 **tenant provisioning → consent 記録 → /admin**。子供プロファイルは作らない | 子供プロファイル作成は離脱要因、deferred collection 標準 |
| FR-4 | signup 時 **Stripe を呼ばず tenant を恒久無料プランで作成**。`?plan=X` trial 自動開始を撤去 | 恒久無料=Stripe サブスク非保有 / 任意タイミングトライアル + ADR-0012 |
| FR-5 | 規約 / プライバシー / 越境移転 (PIPC §28) の **3 同意必須**、版数・IP・UA 記録 | PIPC §28 越境移転本人同意 + 既存 consent-service |
| FR-6 | signup 主体は **保護者 (法定代理人)** であることを UI・規約で明示 | PIPC「12〜15 歳以下は法定代理人同意」 |
| FR-7 | signup 完了後、無料プランで **コア機能 (子供 2 人 / 活動 / レベル・ポイント) 即利用可** | no-credit-card「まず無料で価値体験」。free 上限は plan-features.ts 既定義 |
| FR-8 | trial / 有料への誘導は **feature gate (無料上限到達時) でのみ**、signup 動線では行わない | feature gate が最高 intent + ADR-0012 押し付け禁止 |
| FR-9 | 確認コードは **再送可能 (クールダウン付き)**、24 時間有効 | AWS: コード 24h 有効。既存 60 秒クールダウン |
| FR-10 | Google OAuth signup も提供 (既存) | account-first の摩擦低減 |

## 非機能要件 (NFR)

| ID | 要件 | 根拠 |
|----|------|------|
| NFR-1 | signup 完了まで **2-3 ステップ / 体感 2 分以内** | B2C signup 標準 |
| NFR-2 | confirm 失敗時 **/auth/login?registered=true へ安全フォールバック**、consent 未記録なら /consent | 既存堅牢性維持 |
| NFR-3 | パスワード **8 文字以上** | Cognito ポリシー整合 |
| NFR-4 | consent 記録は **同期実行** (失敗時 /consent、無限リダイレクト防止) | 既存 #589 教訓 |
| NFR-5 | signup を **アクティベーションファネル Step1 計測** | 既存 trackActivationSignupCompleted |
| NFR-6 | 文言は terms.ts/labels.ts SSOT 経由 (ハードコード回避、ADR-0045)、**将来 i18n の素地を残す** | 将来海外展開を見据えるが多言語実装は Pre-PMF スコープ外 (日本ローカライズ要素多く片手間にやらない)。i18n 機構選定は海外展開時に ADR-0014 で。Phase 3 UI / Phase 5 アーキで全機能領域横断の方針として扱う |

## ユーザーストーリー

- US-1: 保護者として、メールとパスワードだけで素早く登録し、すぐ無料で試したい。カード登録や有料選択を最初に求められたくない
- US-2: 確認コードを入れるだけで自動ログインして管理画面に入りたい
- US-3: 子供情報は登録フローでなく、落ち着いてオンボーディングで登録したい
- US-4: 無料で十分使い、本当に必要になった時に自分のタイミングで trial/有料を検討したい
- US-5: 規約・プライバシー・データ越境移転に明示同意して使い始めたい

## Open question (PO 確認が必要)

1. **【確定 2026-05-27】対象市場は日本国内のみ (Pre-PMF の定義)** — PIPC「保護者同意」モデルで足りる。現行メール確認 + 3 同意で整合。COPPA は適用外 (将来海外展開時に別途)。将来海外展開は視野にあるが日本ローカライズ要素が多く片手間にやらない。i18n は NFR-6 の通り「素地のみ」
2. PIPC 3 年見直し (子供データ責務強化、閾値 16 歳案) の将来対応 (要件に「保護者同意を明示記録」と織り込み済)
3. 越境移転同意文言が PIPC §28 を満たすかの法務レビュー (法務孫 #2541 で扱う)

## 根拠 (primary source)

- AWS Cognito signup: docs.aws.amazon.com/cognito/latest/developerguide/signing-up-users-in-your-app.html
- PIPC FAQ Q1-62 (12〜15 歳は法定代理人同意): ppc.go.jp/all_faq_index/faq1-q1-62/
- Stripe trials (payment method なし可): docs.stripe.com/billing/subscriptions/trials
- COPPA FAQ (米国子供対象時): ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
- no-credit-card 業界ベンチ (Chargebee) / feature gate (ProductLed) / 競合 UX (Wallet.ly, Kinfo) / B2C onboarding (Flowjam)
