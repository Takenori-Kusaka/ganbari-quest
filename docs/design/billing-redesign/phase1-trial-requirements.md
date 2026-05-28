# トライアル 要件定義 (#2533 / Epic #2525 Phase 1)

| 項目 | 内容 |
|------|------|
| 孫 issue | #2533 (トライアルの要件) |
| 親 | #2526 (Phase 1) / 上位 #2525 |
| ステータス | Phase 1 完了 (deep-research 完了 → PO 確定 2026-05-27、判断 3 論点も確定) |
| deep-research | Stripe 公式 / 競合 (Duolingo/Headspace/Slack/Notion) / ADR-0012 / 既存実装を primary source 確認 |

## trust but verify で精緻化した前提 (2 点)

- 「任意タイミング開始」= **無料プラン (サブスク非保有) からその時点で新規 trial サブスク作成**。既存サブスクへの trial 追加は Stripe 禁止だが本件は該当せず標準実装可 (Phase 5 で明示)
- `missing_payment_method` は Stripe 上 `cancel` (即キャンセル) / `pause` (一時停止→カード追加で同一サブスク再開) の 2 選択肢が存在する。deep-research 時点では転換 UX 観点で pause を有利と見ていたが、**OQ-A で `cancel` を採用 (二値完結・SSOT モデル整合、pause は三値化・滞留・リークで不採用)**。本要件は `cancel` で確定 (FR-5 / NFR-1 / OQ-A)

## 最重要論点: トライアルで試すプラン → 【確定 PO 2026-05-27】family 固定

**family 固定** — トライアルは常に最上位 family プランを 7 日体験させ、全機能を体験させる (loss aversion)。deep-research では「standard で足りる家庭への過剰 + 終了後 churn リスク」の懸念があったが、PO 判断で **family 固定 (最上位体験)** を採用。終了後の有料化時に standard / family を選択可とする (転換時にダウンセル経路を確保)。

## 機能要件 (FR)

| ID | 要件 | 設計意図 + 根拠 |
|----|------|----------------|
| FR-1 | トライアル = standard/family の 7 日試用。無料プラン (恒久) とは別概念 | reverse trial 構造。既存 TrialTier 整合 |
| FR-2 | 対象 tier は **family 固定** (PO 確定) | 最上位体験 (loss aversion)。churn 懸念は PO 承知。終了後の有料化で standard/family 選択可 |
| FR-3 | 期間 **7 日間** (PO 確定) | 既存・LP・Anti-engagement 整合 |
| FR-4 | **カード登録なし** で開始 (`payment_method_collection=if_required`) | 摩擦最小化。TRIAL_TERMS.noCreditCard 差別化 |
| FR-5 | 7 日後カード未登録 → **subscription cancel → 無料プランに復帰** (PO 確定 cancel) | 勝手に課金しない。cancel で二値完結 (非保有=free)、SSOT モデル整合。pause の三値化・滞留・リークを回避 |
| FR-6 | トライアル中は対象 tier の **全 capability 解放** | loss aversion (失うものを体験) |
| FR-7 | 終了後、無料上限超リソースは **アーカイブ (削除しない)** | データ保管ポジショニング。Slack/Notion 標準。既存 findArchivedChildren 実装済 |
| FR-8 | **1 回制限、family (tenant) 単位** | 乱用防止。既存 startTrial once-only gate。campaign/admin_grant は再付与可 |
| FR-9 | トライアル中→有料転換はカード追加で継続。**終了後 (cancel 済) の再加入は新規 Checkout** | account-first 整合。Notion/Linear/Slack の「無料=契約なし、有料化=新規契約」モデル。再 trial は 1 回制限で不可 |
| FR-10 | トライアル中のプラン変更 (standard→family) は **Pre-PMF 要件外** | ADR-0010。2プラン・短期7日で使用頻度低 (OQ-E) |
| FR-11 | 開始の主動線は **feature gate 到達時の contextual prompt** | moment of intent で転換最大。signup 時 trial 自動開始は撤去 (OQ-G、新規申込要件と一致) |
| FR-12 | 副動線は **プラン管理画面 (`/admin/license`) からの自発開始** | 既存 TrialBanner。管理画面=親側で ADR-0012 §3 例外 (OQ-F) |
| FR-13 | 提示頻度は **Anti-engagement 準拠** (連打しない、子供側 UI に露出しない) | ADR-0012 |
| FR-14 | 終了通知 **3 日前/1 日前/当日メール + 終了後初回ログインモーダル**、親宛のみ | 業界標準 (3-5通cap)。Stripe trial_will_end 3日前。既存 trial-notification-service 実装済。ADR-0012 §6 (子端末通知禁止) |

## 非機能要件 (NFR)

- NFR-1 (信頼): カード未登録で勝手に課金しない (Stripe `payment_method_collection=if_required` + `trial_settings.end_behavior.missing_payment_method=cancel`)。end_behavior は **cancel に固定** (FR-5 / OQ-A 確定の二値モデル整合)。`pause` は OQ-A で不採用 (三値化・滞留・リーク回避)
- NFR-2 (Anti-engagement / ADR-0012): trial 導線は親管理画面のみ、子供側 UI 非露出、通知は親宛 3 通 cap
- NFR-3 (LP truth / ADR-0013): LP の 7日間/カード登録不要 訴求は実装と一致 (TRIAL_TERMS SSOT)
- NFR-4 (Pre-PMF / ADR-0010): trial 中プラン変更・複数回 trial・複雑分岐は実装しない

## ユーザーストーリー

1. 無料利用中、子供3人目追加で「standard を7日無料で試す(カード不要)」提示 → 1タップ開始
2. family 機能 (Viewer招待) 到達で「family を7日試す」提示
3. 終了3日前メール「残り3日、終了後は無料に戻る(データ保管)」→ 続けたければ Portal でカード追加
4. 何もしなければ7日後に無料へ、上限超はアーカイブ表示
5. 2回目試行時「トライアルは利用済み(ご家族で1回)」+ 有料案内

## Open question (PO 判断)

| # | 論点 | 結論 | 状態 |
|---|------|------|------|
| A | trial 終了挙動 | **cancel** (二値完結・モデル整合) | ✅ PO 確定 2026-05-27 (pause は無期限だが三値化・滞留・リークで不採用) |
| B | 自発開始時の既定 tier | family 固定 | ✅ 確定 (試すプラン family 固定に統一) |
| C | trial 期間 | **7 日** | ✅ PO 確定 |
| D | 2回目試行の文言 | 「ご家族で1回」 | 推奨で確定、文言は法務孫 #2541 |
| E | trial 中 tier 変更 | 要件外 (Pre-PMF) | 推奨で確定 (FR-10) |
| F | 未使用 free 全員へのバナー | 管理画面なので許容 | 推奨で確定 (FR-12) |
| G | signup `?plan=X` trial 自動開始撤去 | 撤去 | 新規申込要件で確定済 |

## 関連 (2026-05-28 補強)

- [URL/命名/用語の意味的整合性](phase1-naming-url-integrity-requirements.md) — Phase 1 補強 (#2526)。`/admin/license` → `/admin/subscription` rename / コンポーネント / atom 影響範囲 308+218+450 件

## 根拠 (primary source)

- Stripe trials / free-trials / webhooks (trial_will_end 3日前 / cancel・pause / Customer Portal 転換)
- 競合: Duolingo・Headspace (7日trial)、Slack・Notion (downgrade データ保持)
- contextual paywall (stackmatix) / reverse trial (thegood) / 終了通知 (sequenzy 3日前1日前当日)
- ADR-0012 (Anti-engagement) / ADR-0013 (LP truth) / ADR-0010 (Pre-PMF)
- 既存: trial-service.ts (once-only gate) / trial-notification-service.ts (3通+モーダル) / プライシング戦略書 §4 (§4.3「signup時全機能解放」は前提と矛盾、更新要)
