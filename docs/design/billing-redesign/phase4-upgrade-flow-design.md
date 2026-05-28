# アップグレード動線統一設計 (gate → CTA → /confirm → Checkout、Phase 4 #2624)

| 項目 | 内容 |
|------|------|
| 孫 issue | #2624 (Phase 4 グループ C、アップグレード動線統一: feature gate → CTA → `/admin/subscription/confirm` → Stripe Checkout) |
| 親 | #2529 (Phase 4 動線) / Epic #2525 |
| 起点 | Phase 2 #2549 (Tier Change ジャーニー) 申し送り「Phase 4 申し送り 6: アップ動線と checkout ジャーニーの統一 CTA (`PLAN_CHANGE_TERMS.changeVerb`)」を Phase 4 で動線確定 |
| Phase 1+2+3+4 整合 | Phase 1 #2535 (アップ即時 + ダウン期末 / proration `always_invoice` / DowngradeResourceSelector) + Phase 1 #2583 補強 1 (`/admin/license` → `/admin/subscription`) + Phase 1 #2588 補強 2 (月額のみ / V4 decoy / `family` atom 維持) + Phase 2 #2549 (Tier Change / Notion 型 Pattern A / proration UX) + Phase 2 #2548 谷④ (購入動線探索) + Phase 3 #2570 (FeatureGate + tooltip + `tooltipFor` atom) + Phase 3 #2573 (`/confirm` 特商法 6 項目ハイブリッド) + Phase 3 #2574 (期末ダウン banner 3 variant) + Phase 4 #2620 (URL マッピング、`/admin/license` → `/admin/subscription` 永久エントリ) |
| Phase 7 rename 方針 | 動線終端の URL は `/admin/subscription` / `/admin/subscription/confirm` (Phase 4 #2620 確定、本書 §3.3 で参照のみ) / `family` atom 表示名「ファミリー」維持 (Phase 3 #2609 SSOT 衝突解決後の Phase 7 で rename 判断) |
| `premium` 階層 signal 打消 | アップ CTA 文言は「○○以上で利用可能」(階層 signal 中立) + 「`${PRICE}` を支払って `${PLAN_FULL_TERMS}` に変更」(事実説明) で煽り回避。`FREE_PLAN_TERMS.forever` (永久無料) を hero / pricing に維持して階層 signal を構造的に打消 (Phase 2 #2549 / Phase 4 #2621 と同方針、refs #2594 D-2) |
| 作業姿勢 (#2525 critical) | 法令適合性最優先 (#2573 で確定済特商法 6 項目を確実に通過) / Notion 型 Pattern A 整合 (Phase 2 #2549) / Kinde 「what happens when clicked」CTA 原則整合 / 6 観点 workflow ([[per-issue-execution-workflow]]) + 詰まり時立ち戻り ([[pause-and-replan-on-stuck]]) |
| deep-research | (1) Tier Change UX (Stripe / Kinde / Linear / Notion 4 社事例、Phase 2 #2549 primary source 再利用) / (2) proration 透明化 (Stripe `proration_behavior` 3 値 + Preview API `create_preview` 公式 docs) / (3) アップ即時 vs ダウン期末分岐の業界収束 (Notion 型 Pattern A、Phase 2 #2549 既存採用) / (4) feature gate → CTA → 確認画面 → 決済の 4 段階 conversion funnel (Userpilot / Plotline / Webuild 業界規範) |
| impact-analysis 適用 | L1 構文 grep (PLAN_GATE_LABELS / `/admin/subscription` href / `subscriptions.update` call) + L2 意味 (`family` atom 表示名 vs 内部 enum / アップ即時 vs ダウン期末 分岐の同型扱い禁止) + L3 構造 (FeatureGate → PremiumBadge → /confirm → Stripe Checkout の依存チェーン / proration preview の subscription page #2567 → confirm page #2573 props 受渡し) + L4 派生 artifact 21 カテゴリ (本 PR は docs のみ、Phase 7 実装 PR で 21 カテゴリ checklist 必須適用) |

> **6 観点の自己検証は §10 にまとめて記載**。本書は設計書 SSOT (3 部構成: §1 設計背景 / §2 設計原則 / §3 以降 仕様、docs/CLAUDE.md 整合)。

---

## 1. 設計背景

### 1.1 なぜこの動線統一が必要か

Phase 2 #2549 (Tier Change ジャーニー) で確定した **アップ即時 (Notion 型 Pattern A 整合 + proration `always_invoice`)** と **ダウン期末 (`schedule_at_period_end`)** の 2 分岐は、Phase 3 で **個別 UI** ([#2570 FeatureGate](phase3-feature-gate-ui-design.md) / [#2573 `/confirm`](phase3-subscription-confirm-tokushoho-ui-design.md) / [#2574 期末ダウン banner](phase3-scheduled-downgrade-banner-ui-design.md)) として個別設計されたが、**動線として 4 段階 (gate → CTA → /confirm → Checkout) を繋ぐ SSOT が未確定**。Phase 4 で動線レイヤを統合し、以下の構造的破綻を予防する。

| 構造的破綻 | 既存の状態 (Phase 3 完了時点) | 本 #2624 で確定 |
|---|---|---|
| feature gate (#2570) の CTA「プランを見る」link が `/admin/subscription` 遷移するが、**「プランを変更する場合に何が起きるか」が gate 画面で予見できない** (Kinde 「what happens when clicked」原則違反) | gate → /admin/subscription 直遷移 (1 タップ) | gate → /admin/subscription (プラン選択) → **`/confirm` で特商法 6 項目 + proration 差額表示 (#2573 ハイブリッド方式)** → Stripe Checkout の 3 タップ動線を明示。各タップで「次に何が起きるか」を CTA 文言に予告 (例: 「ファミリーにする (¥530 を支払う)」) |
| **アップ即時 vs ダウン期末の分岐動線が UI で混在表示される可能性** (subscription page #2567 で「アップグレード」「ダウングレード」の 2 ボタンが並ぶ → ユーザーは「どちらが即時 / 期末か」を判別不能) | Phase 3 #2567 + #2574 で個別 UI 確定だが、動線として「同じ subscription page 内で 2 経路が混在する場合のフレーミング」未統一 | アップ動線 (subscription page → /confirm → Stripe Checkout、3 タップ即時) + ダウン動線 (subscription page → DowngradeResourceSelector → 期末ダウン banner #2574、確認後 schedule、期末まで family 維持) の 2 動線を **mermaid 図 + 動線 SSOT 表**で分離明示 |
| **proration 差額表示の動線が gate → /confirm に伝播していない** (Phase 3 #2573 で `/confirm` の差額表示 UI 確定だが、gate からの遷移時に subscription page → /confirm の context-passing が未設計) | gate → /admin/subscription (直遷移) / `/confirm` (差額表示は preview API 経由で表示する設計、Phase 3 #2573) | gate (`?from=feature-gate&feature=<id>`) → subscription page (#2567 で context 表示 + 推奨バッジ) → /confirm (proration 差額 dry-run 表示、Phase 3 #2573 §3.3 整合) の **3 段階 context-passing 動線** を SSOT 化 |
| **Phase 5 (アーキ) で実装される `subscriptions.update` API call timing が動線レイヤで未確定** | Phase 5 申し送り済 (Phase 2 #2549 §「Phase 5 アーキ 申し送り 7-9」) | 本書 §3.3 で動線図に preview API call timing (Phase 5 §「subscriptions.update preview」) と update API call timing (Phase 5 §「アップ即時 update」) を明示。Phase 5 アーキ実装時の hooks 位置を確定 |

### 1.2 何が困るか (この設計がなかった場合)

| 想定リスク | 実害 | 既存事例 |
|---|---|---|
| アップ即時 / ダウン期末の動線混在 | ユーザーが「いつ反映されるのか?」を判別不能、Stripe Customer Portal を都度確認 → サポート問合せ増 + 解約離脱 | Phase 2 #2549 §「ダウン ジャーニー 谷②失う恐怖」で発見 (Notion / Calendly 業界規範 1 件目) |
| feature gate → CTA → Checkout の 3 段階 conversion funnel 未確定 | 谷④購入動線探索 (Phase 2 #2548) + 谷②金額説得力 (#2548) が未解消、conversion 25% 未達リスク | Phase 2 #2548 谷②谷④ で PO 指摘 |
| proration 差額表示の context-passing 未設計 | gate → subscription page → /confirm 経路で差額表示が「無料 → 有料」と「有料 → 有料 (差額)」で UI 動線が分岐せず、ユーザーが「いくら払うのか?」を /confirm まで把握不能 | Phase 2 #2549 §「アップ ジャーニー 改善要 1」で発見 |
| Phase 5 アーキ実装時の API call timing 不確定 | `subscriptions.update preview` を /confirm の load で呼ぶか、subscription page の load で呼ぶか不明 → 実装で 2 重呼出 or 取りこぼし | Phase 2 #2549 §「Phase 5 申し送り 9」で primary source 未確定 |

### 1.3 Phase 1+2+3+4 上流 SSOT との整合

| 上流 SSOT | 整合観点 | 本書での扱い |
|---|---|---|
| Phase 1 #2535 (アップ/ダウン要件) | FR-3 (アップ即時 + proration 即時) / FR-4 (ダウン期末) / FR-5 (DowngradeResourceSelector 既存実装) / FR-6 (webhook SSOT) | §3.3 mermaid 図でアップ動線 (FR-3) とダウン動線 (FR-4/FR-5) を分離 / §3.4 動線 SSOT 表で FR 各項目への適合確認 |
| Phase 1 #2588 補強 2 (プラン命名 + 月額のみ + V4 decoy) | アップ CTA 文言は `${PLAN_FULL_TERMS.family}` (現 atom 維持) / V4 decoy (standard 推奨バッジ + family 最右、Phase 3 #2567 整合) | §4.1 文言 atom 設計 / §3.5 V4 decoy 整合確認 |
| Phase 2 #2549 (Tier Change ジャーニー) | Notion 型 Pattern A / proration UX (preview API + `always_invoice`) / 文言 atom 拡張 (`PLAN_CHANGE_TERMS`) | §2 設計原則 (Notion 型 Pattern A 採用) / §3.3 mermaid 図 / §4 文言 atom (PLAN_CHANGE_TERMS 拡張 + PLAN_CHANGE_LABELS 新規) |
| Phase 2 #2548 谷④ (購入動線探索) | feature gate → CTA → Checkout の 3 段階 conversion funnel | §3.3 mermaid 図 + §3.4 動線 SSOT 表 |
| Phase 3 #2570 (FeatureGate + tooltip) | `tooltipFor(tier)` atom (`'${PLAN_FULL_TERMS[tier]}以上で利用可能'`) + section overlay 「プランを見る」link → `/admin/subscription` 1 タップ遷移 | §3.3 mermaid 図 (gate variant: inline tooltip + section overlay 両対応) + §3.4 動線 SSOT 表 (gate → /admin/subscription `?from=feature-gate&feature=<id>` context-passing) |
| Phase 3 #2573 (`/confirm` 特商法 6 項目) | ハイブリッド方式 (自社 confirm + Stripe `custom_text`) + proration 差額表示 (§3.3) + 同意 checkbox + 「上記内容で申し込む」CTA | §3.3 mermaid 図で /confirm を経由する動線を明示 / §4.1 CTA 文言は #2573 既存 atom (`SUBSCRIPTION_CONFIRM_LABELS.confirmButtonLabel`) を再利用 (二重実装禁止) |
| Phase 3 #2574 (期末ダウン banner 3 variant) | ダウン動線後の banner 表示 (期末まで family 維持中 + 復活 CTA) | §3.3 mermaid 図でダウン動線の終端に banner 接続を明示 / §3.5 アップ動線とダウン動線の境界確認 |
| Phase 4 #2620 (URL マッピング) | `/admin/license` → `/admin/subscription` 永久エントリ + 308 redirect (length 降順評価) | §3.3 mermaid 図で URL は新 URL `/admin/subscription` / `/admin/subscription/confirm` を使用 (LEGACY_URL_MAP は本書 scope 外、#2620 で確定済) |

---

## 2. 設計原則

### 2.1 Notion 型 Pattern A 整合 (Phase 2 #2549 確定 + Kinde 「what happens when clicked」)

本書のアップ動線は **Notion 型 Pattern A** (アップ即時 + proration `always_invoice` + 既存資産保護) と **Kinde 「what happens when clicked」CTA 原則** (CTA 文言で「クリック時に何が起きるか」を予告) を統一原則とする。

| 原則 | 採用根拠 |
|---|---|
| **アップ即時 (`proration_behavior=always_invoice`)** | Stripe 公式 + 業界収束 ("don't make them wait" — 興奮中の顧客を待たせない、Phase 2 #2549 §「アップ固有の改善要」採用済) |
| **ダウン期末 (`schedule_at_period_end`)** | Phase 1 #2535 FR-4 + Stripe 公式推奨 (credit proration の複雑さ回避 + サービス提供義務、Phase 2 #2549 既存採用) |
| **CTA 文言で「what happens when clicked」予告** | Kinde Plan Change Best Practices 公式 (「Avoid generic 'Upgrade' — be specific about what changes」)。本書 §4.1 CTA 文言設計で適用 |
| **proration 差額の dry-run 表示** | Stripe `POST /v1/invoices/create_preview` Preview API 公式 (Phase 2 #2549 §「アップ固有の改善要」採用、Phase 3 #2573 §3.3 で UI 確定済) |
| **「失う / 消える / 使えなくなる」atom 禁止 (ダウン動線)** | Phase 2 #2549 §「文言 atom 拡張案」+ Kinde 「avoid scare tactics, use empathetic language」整合 (本書 §4.1 PLAN_CHANGE_TERMS で atom 化、ダウン動線でのみ適用、アップ動線は影響なし) |

### 2.2 アップ即時 vs ダウン期末 分岐の動線分離 (動線レイヤ SSOT 確定)

Phase 3 #2567 (`/admin/subscription`) で「アップグレード」「ダウングレード」の 2 ボタンが並ぶ可能性があるが、本書 §3.3 mermaid 図で **アップ動線 (3 タップ即時)** と **ダウン動線 (確認後期末 schedule)** を **独立した 2 経路** として動線設計する。

| 動線 | 経路 | 反映 timing | 文言主軸 | UX 山 |
|---|---|---|---|---|
| **アップ動線** | `subscription page` → `/confirm` (proration 差額 dry-run) → Stripe Checkout → webhook 権限解放 | **即時** (proration `always_invoice` 即時請求 + 即時 capability 解放) | 「`${PRICE}` を支払って `${PLAN_FULL_TERMS}` に変更」(事実説明、Kinde 原則) | webhook 数秒後の即時機能解放 (Phase 2 #2549 §「アップ ジャーニー」山 1 件) |
| **ダウン動線** | `subscription page` → `DowngradeResourceSelector` (#2575 既存実装 + 「保護 + 復活」フレーミング、Phase 2 #2549 §「ダウン ジャーニー」整合) → 期末ダウン banner #2574 表示 → 期末で自動降格 | **期末** (`schedule_at_period_end` + 期末まで family 機能維持) | 「期末まで family のままご利用、`${PERIOD_END}` から `${PLAN_FULL_TERMS.standard}` に変更」(資産保護フレーミング、Phase 2 #2549 §「文言 atom 拡張」整合) | 期末まで family 機能維持 + 再アップで瞬時復元 (Phase 2 #2549 §「ダウン ジャーニー」山 2 件) |

本 #2624 (アップグレード動線統一) は **アップ動線のみを主スコープ**とし、ダウン動線は #2574 (期末ダウン banner) + Phase 3 #2575 (archived 表示) で確定済の動線を本書 §3.3 で**参照**する (二重設計禁止)。

### 2.3 ADR 整合

| ADR | 観点 | 適合性 |
|---|---|---|
| ADR-0010 (Pre-PMF) | Bucket A (法令必須 + 構造的安全保証) | ✅ 特商法 6 項目通過 (#2573 経由) + proration 差額表示 (法令推奨「分量」明示) |
| ADR-0012 (Anti-engagement) | 滞在強要 / 煽り / 連続演出禁止 | ✅ countdown timer 不採用 / 「期間限定」「特別オファー」禁止 / アップ即時で短時間完結 / ダウンは静的 banner 1 件 (#2574) |
| ADR-0013 (LP truth) | 実装の事実 SSOT | ✅ LP / app / 法務文書 (tokushoho.html) の 3 経路で `family` atom 表示名「ファミリー」維持 (Phase 3 #2609 SSOT 衝突解決後の Phase 7 で rename 判断、本書では現 atom 維持) |
| ADR-0045 (terms.ts 2 階層) | atom / compound 責務分離 | ✅ Phase 2 #2549 で確定済 `PLAN_CHANGE_TERMS` atom + `PLAN_CHANGE_LABELS` compound を再利用 (本書で新規追加せず、二重実装禁止) |
| ADR-0050 (Parent-Gate session cookie) | 子供 UI 課金圧排除 | ✅ アップ動線は `/admin/*` 配下のため Parent-Gate 通過後のみ表示 (子供画面非露出、ADR-0012 整合) |
| ADR-0051 (NUC-SaaS Bifurcation) | NUC 環境では Edition badge 経路 | ✅ NUC 環境では本動線非表示 (Edition badge 経路、別 issue で扱う) |

---

## 3. UI 動線設計

### 3.1 4 段階 conversion funnel (Phase 2 #2548 谷④購入動線探索 + Phase 3 #2570/#2573 統合)

アップ動線は **4 段階 (gate → subscription page → /confirm → Stripe Checkout)** で構成される。Phase 3 で個別 UI が確定済のため、本書では **段階間の遷移条件 + context-passing + CTA 文言** を SSOT 化する。

| 段階 | 起点 | 表示 UI | CTA 文言 | 遷移先 |
|---|---|---|---|---|
| **段階 0** (起点) | feature gate (#2570) / header plan-badge (#2568) / ActivityLimitBanner (#2569) / PremiumDialog (#2570 経由) | 既存 UI (Phase 3 確定済) | gate variant inline: tooltip (`tooltipFor(tier)` = `'${PLAN_FULL_TERMS}以上で利用可能'`) + PremiumBadge / gate variant section: overlay 「プランを見る」link + PremiumBadge | `/admin/subscription?from=feature-gate&feature=<id>` (gate 経由) / `/admin/subscription?from=header-badge` (header 経由) |
| **段階 1** (プラン選択) | `/admin/subscription` (Phase 3 #2567 確定済) | 4 ページ分割 UI (現プラン + プラン選択 + standard 推奨バッジ + family decoy 配置、V4 framing #2588 整合) | アップ用 CTA: 「`${PLAN_FULL_TERMS.standard}` にする」 / 「`${PLAN_FULL_TERMS.family}` にする」 (Phase 3 #2567 既定文言) | `/admin/subscription/confirm?plan=<standard|family>` (アップ動線) / `/admin/subscription` 内で DowngradeResourceSelector 起動 (ダウン動線、本書 scope 外、#2574/#2575 で確定) |
| **段階 2** (特商法 6 項目 + proration 差額確認) | `/admin/subscription/confirm` (Phase 3 #2573 確定済) | 6 ブロック構造 (法定 5 項目 + 自動更新明示) + proration 差額 dry-run 表示 (機能 3) + 同意 checkbox | 「上記内容で申し込む」(disabled until checkbox checked、Phase 3 #2573 `SUBSCRIPTION_CONFIRM_LABELS.confirmButtonLabel` 再利用) | Stripe Checkout (`/v1/checkout/sessions` 経由、Phase 5 アーキで `subscriptions.update` 即時 update) |
| **段階 3** (決済) | Stripe Checkout (Stripe ホスト画面) | カード入力 + 再度規約同意 (`terms_of_service_acceptance`) + `custom_text` (Phase 3 #2573 整合) | (Stripe 標準) | webhook 経由 `customer.subscription.updated` → `/admin/subscription/success` (Phase 3 #2572 polling UI) → 権限解放 |

### 3.2 アップ即時 vs ダウン期末 分岐 (subscription page #2567 内分岐)

`/admin/subscription` (#2567) で現プラン (例: standard) からの選択肢は以下の 4 ボタンに整理される (V4 decoy + Phase 3 #2567 推奨バッジ整合):

| 現プラン | 表示ボタン | 動線分岐 |
|---|---|---|
| **`free`** (新規 / trial 終了後) | 「`${PLAN_FULL_TERMS.standard}` にする」+ 「`${PLAN_FULL_TERMS.family}` にする」 | **両者ともアップ動線 (即時、本書 §3.3 図 1)** |
| **`standard`** (既存契約者) | 「`${PLAN_FULL_TERMS.family}` にする」 (アップ) + 「`${PLAN_FULL_TERMS.free}` に戻す」 (ダウン、解約相当、#2536 経由) | アップは本書 §3.3 図 1 / ダウンは #2536 (解約) 経路 |
| **`family`** (既存契約者) | 「`${PLAN_FULL_TERMS.standard}` に変更」 (ダウン期末) + 「`${PLAN_FULL_TERMS.free}` に戻す」 (解約、#2536) | **本書 §3.3 図 2 (ダウン動線、本書 scope 外、参照のみ)** |

### 3.3 mermaid 動線図 (アップ動線中心、ダウン動線は参照)

#### 図 1: アップ動線 (3 タップ即時、本書主スコープ)

```mermaid
flowchart TB
    subgraph Origin["段階 0: アップ動線起点 (Phase 3 既存)"]
        Gate[feature gate #2570<br/>inline tooltip / section overlay<br/>PremiumBadge + link]
        Header[header plan-badge #2568<br/>無料時のみ アップグレード ボタン]
        Banner[ActivityLimitBanner #2569<br/>上限到達 → プランページ link]
    end

    Origin -->|"?from=feature-gate&feature=&lt;id&gt; (gate 経由)<br/>?from=header-badge (header 経由)<br/>?from=banner (banner 経由)"| Sub

    subgraph Stage1["段階 1: プラン選択 (#2567)"]
        Sub[/admin/subscription<br/>4 ページ分割 UI<br/>+ standard 推奨バッジ<br/>+ family decoy 配置<br/>+ ?from= context 表示]
    end

    Sub -->|"アップ CTA クリック<br/>「${PLAN_FULL_TERMS.&lt;tier&gt;} にする」"| Confirm

    subgraph Stage2["段階 2: 特商法 6 項目 + proration 差額確認 (#2573)"]
        Confirm[/admin/subscription/confirm?plan=&lt;tier&gt;<br/>6 ブロック構造<br/>+ proration 差額 dry-run 表示<br/>+ 同意 checkbox<br/>+ 「上記内容で申し込む」CTA]
        Preview[Stripe Preview API<br/>POST /v1/invoices/create_preview<br/>差額算出 (Phase 5 アーキ実装)]
        Confirm <-->|load 関数経由<br/>proration_date hidden field| Preview
    end

    Confirm -->|"checkbox check + CTA クリック<br/>「上記内容で申し込む」"| Checkout

    subgraph Stage3["段階 3: 決済 (Stripe Checkout)"]
        Checkout[Stripe Checkout<br/>カード入力<br/>+ 再度規約同意<br/>+ custom_text 補強]
        UpdateAPI[Stripe subscriptions.update<br/>proration_behavior=always_invoice<br/>即時 capability 解放<br/>(Phase 5 アーキ実装)]
        Checkout -->|決済確定| UpdateAPI
    end

    UpdateAPI -->|"webhook<br/>customer.subscription.updated"| Success
    Success[/admin/subscription/success<br/>processing gap polling #2572] -->|webhook 権限付与| Activated[家庭機能即時解放<br/>UX 山]

    style Sub fill:#fff3e0
    style Confirm fill:#ffecb3
    style Checkout fill:#e3f2fd
    style Activated fill:#d4edda
```

#### 図 2: ダウン動線 (期末 schedule、本書参照のみ、#2574/#2575 確定済)

```mermaid
flowchart TB
    Sub[/admin/subscription<br/>family 契約者]
    Sub -->|"ダウン CTA クリック<br/>「${PLAN_FULL_TERMS.standard} に変更」"| Selector
    Selector[DowngradeResourceSelector #2575<br/>「保護 + 復活可能」明示<br/>resource 選択]
    Selector -->|"確定"| Schedule[Stripe subscriptions.update<br/>proration_behavior=none<br/>+ schedule_at_period_end<br/>(Phase 5 アーキ実装)]
    Schedule -->|"webhook"| Banner[期末ダウン banner #2574<br/>3 variant: confirmed/nearing/today<br/>「現プランのまま続ける」CTA<br/>(Win-Back)]
    Banner -->|"期末到達"| AutoDown[期末自動降格<br/>超過分 read-only<br/>子供画面 invisible]
    AutoDown -->|"再アップ"| Restore[restoreArchivedResources<br/>瞬時復元 (Phase 2 #2549 既存)]

    style Selector fill:#e3f2fd
    style Banner fill:#fff3cd
    style Restore fill:#d4edda
```

### 3.4 段階 1 (subscription page) → 段階 2 (/confirm) の context-passing SSOT

段階 1 → 段階 2 の遷移で `?plan=<tier>` クエリと proration preview の context を /confirm に渡す:

| パラメータ | 値 | 起点 | /confirm 側の振る舞い |
|---|---|---|---|
| `plan` | `'standard'` / `'family'` | アップ CTA クリック (段階 1 → 段階 2) | /confirm の `+page.server.ts` load で受取 + `previewSubscriptionChange()` 呼出 |
| `from` (Phase 4 #2622 trial→paywall 動線整合) | `'trial-3d'` / `'trial-1d'` / `'trial-0d'` / `'trial-end'` / `'feature-gate'` / `'header-badge'` / `'banner'` / null | trial 通知 link / gate / header / banner 経由 | /confirm 上部に context 文言表示 (例: 「○○ で gate されていた機能を解放するため `${PLAN_FULL_TERMS.standard}` にアップグレードします」) |
| `feature` (オプション、`from=feature-gate` の場合のみ) | feature ID (例: `'marketplace-import'` / `'ai-suggest'`、Phase 4 #2622 整合) | gate 経由 | /confirm 上部に「`${feature 名}` を解放します」表示 |

**実装ルール** (Phase 7):
- `+page.server.ts` の `load` で `url.searchParams.get('plan')` / `'from'` / `'feature'` を取得
- `previewSubscriptionChange(plan, currentSubscription)` を Phase 5 アーキで実装 (`stripe-service.ts` 新規追加)
- `load` 戻り値 `{ plan, prorationPreview, contextFrom, contextFeature }` で /confirm `+page.svelte` に配布
- セキュリティ: `?from=...` と `?feature=...` は表示文言切替のみで認可境界には影響しない (任意の値が来ても標準表示にフォールバック、Phase 4 #2622 §「原則 2」整合)

### 3.5 V4 decoy framing 整合 (Phase 1 #2588 + Phase 3 #2567)

Phase 1 #2588 で確定した V4 decoy framing (standard 推奨バッジ + family 最右配置 + premium 階層 signal 打消) と本動線の整合性を確認:

| V4 decoy 要素 | 段階 1 (subscription page) | 段階 2 (/confirm) | 動線整合 |
|---|---|---|---|
| **standard 推奨バッジ** | Phase 3 #2567 で「✓ 推奨」中立バッジを standard に配置 (煽り回避、ADR-0012 整合) | /confirm では context 文言で再強調 (例: 「`${PLAN_FULL_TERMS.standard}` で十分なご家庭が多いです」、Phase 4 #2622 trial-1d 文言と同型) | ✅ アップ動線で standard ダウンセル経路を能動的に提示 (LTV 最適化、Phase 4 #2622 §「原則 3」整合) |
| **family 最右配置 (decoy)** | Phase 3 #2567 で family を最右配置、premium 階層 signal を打消 (FREE_PLAN_TERMS.forever / FREE_TERMS.start を hero に維持) | /confirm では `plan=family` 選択時に「`${PLAN_FULL_TERMS.family}` をお選びいただきました」中立表示 (煽り回避) | ✅ family 選択を「過剰選択」と煽らない (Phase 2 #2549 §「禁止語彙」整合) |
| **月額のみ表示 (年額廃止)** | Phase 3 #2567 で月額 toggle 削除 (V4 framing #2588 FR-2) | /confirm の「次回更新」は「毎月 N 日、自動更新」固定表示 (Phase 3 #2573 §3.2 ④引渡時期・自動更新ブロック整合) | ✅ Phase 1 #2588 FR-2 年額廃止整合 |

---

## 4. 文言 atom 設計 (terms.ts / labels.ts、ADR-0045 整合)

### 4.1 既存 atom 再利用 (新規最小化原則)

本動線で使用する文言 atom は **Phase 2 #2549 + Phase 3 #2570/#2573 で既に確定済の atom を再利用** する (二重実装禁止、ADR-0045 整合)。

| 用途 | atom (既存) | 値 | 出典 |
|---|---|---|---|
| プラン名 (フル) | `PLAN_FULL_TERMS.standard` / `.family` | `'スタンダードプラン'` / `'ファミリープラン'` | Phase 1 #2588 (atom 表示名「ファミリー」維持、Phase 3 #2609 後 rename 判断) |
| プラン名 (短縮) | `PLAN_TERMS.standard` / `.family` | `'スタンダード'` / `'ファミリー'` | 同上 |
| 価格 | `PRICE_TERMS.standard` / `.family` / `.taxNote` | `'¥500'` / `'¥780'` / `'（税込）'` | Phase 1 #2588 確定済 |
| アップ CTA 動詞 (Kinde 原則整合) | `PLAN_CHANGE_TERMS.changeVerb` | `'プランを変更'` | Phase 2 #2549 §「文言 atom 拡張案」確定済 |
| アップ CTA 主文 (Kinde 「what happens when clicked」) | `PLAN_CHANGE_LABELS.upgradeConfirm` | `\`¥{差額} を支払って ${PLAN_FULL_TERMS.family} に変更\`` | Phase 2 #2549 §「文言 atom 拡張案」確定済 |
| ダウン保護文言 | `PLAN_CHANGE_TERMS.protected` | `'保護されています'` | Phase 2 #2549 §「文言 atom 拡張案」確定済 |
| ダウン復活文言 | `PLAN_CHANGE_TERMS.resumeReady` | `'いつでも復活できます'` | 同上 |
| feature gate tooltip | `PLAN_GATE_LABELS.tooltipFor(tier)` | `\`${PLAN_FULL_TERMS[tier]}以上で利用可能\`` | Phase 3 #2570 確定済 |
| feature gate overlay link | `UI_COMPONENTS_LABELS.featureGatePlanLink` | `'プランを見る'` | Phase 3 #2570 確定済 |
| /confirm CTA | `SUBSCRIPTION_CONFIRM_LABELS.confirmButtonLabel` | `'上記内容で申し込む'` | Phase 3 #2573 確定済 |
| /confirm 中止 CTA | `SUBSCRIPTION_CONFIRM_LABELS.cancelButtonLabel` | `'やめる'` | Phase 3 #2573 確定済 |
| /confirm 同意 checkbox | `SUBSCRIPTION_CONFIRM_LABELS.consentLabel` | `'上記内容を確認し、お申し込みに同意します'` | Phase 3 #2573 確定済 |
| 解約安心保証 | `CANCEL_TERMS.anytimeOk` | `'いつでも解約できます（契約期間の縛りなし）'` | 既存 atom (Phase 4 #2621 LP→app 動線整合) |
| 期末ダウン banner | (Phase 3 #2574 atom 既存、本書では参照のみ) | (3 variant 別 atom、A/B/C) | Phase 3 #2574 確定済 |

### 4.2 新規 atom (本書で追加、最小限)

本書で追加する atom は **アップ動線の context-passing 文言** のみ。Phase 3 #2573 SUBSCRIPTION_CONFIRM_LABELS と Phase 3 #2570 PLAN_GATE_LABELS は再利用し、二重実装しない。

```ts
// src/lib/domain/labels.ts 新規追加 (ADR-0045 compound 責務、Phase 7 atom 拡張)
//
// 設計意図: アップ動線の context-passing 文言を atom 化。
// /confirm 上部に「どこから来たか」context 表示し、conversion funnel の文脈整合を強化。
// Phase 2 #2549 + Phase 3 #2570/#2573 既存 atom を template literal で参照、atom 直書き複製禁止。
//
// 動線整合 (本書 §3.4):
//   - ?from=feature-gate&feature=<id> → /confirm 上部「<feature> を解放するため <plan> にアップグレード」
//   - ?from=header-badge → /confirm 上部「<plan> にアップグレード」(context なし、標準表示)
//   - ?from=trial-end (Phase 4 #2622 整合) → /confirm 上部「<plan> 体験は終了、継続のためアップグレード」
//
// 法務確認: 本 atom は SUBSCRIPTION_CONFIRM_LABELS (Phase 3 #2573) の補強であり、
// 特商法 6 項目本体は #2573 で確定済の文言を維持。誤認表示禁止 (改正特商法第12条の6第2項) 違反性を Phase 7 法務 review で確認。
export const UPGRADE_FLOW_LABELS = {
  // context-passing 上部文言 (Phase 4 #2622 trial→paywall 動線と integrated)
  contextFromFeatureGate: (featureLabel: string, tierLabel: string) =>
    `${featureLabel} を解放するため ${tierLabel} にアップグレードします`,
  contextFromTrialEnd: (tierLabel: string) =>
    `体験は終了しました。継続される場合は ${tierLabel} へアップグレードしてください`,
  contextFromHeaderBadge: '', // context なし、標準表示 (Phase 3 #2573 6 ブロック構造をそのまま表示)
  contextFromBanner: (tierLabel: string) =>
    `上限到達のため ${tierLabel} へアップグレードします`,
  // ?from パラメータ非該当時のフォールバック (任意の値が来た場合の安全表示)
  contextFallback: '',
} as const;
```

**新規 atom 数**: compound 1 件 (`UPGRADE_FLOW_LABELS`、5 メソッド)。terms.ts には新規追加なし (atom = Phase 2 #2549 + Phase 3 #2570/#2573 既存を再利用)。

---

## 5. a11y 設計 (動線レイヤの screen reader + keyboard)

### 5.1 段階間遷移の a11y

| 観点 | 仕様 |
|---|---|
| **段階 0 → 段階 1 (gate → subscription page)** | gate inline variant の `aria-describedby` + tooltip (Phase 3 #2570 確定済) を通過後、`/admin/subscription` のページ title が `<h1>` で focus 移動 (SvelteKit `<Head>` + `tabindex="-1"` 経由) |
| **段階 1 → 段階 2 (subscription page → /confirm)** | アップ CTA クリック後、`/confirm` の `<h1>` 「お申し込み内容のご確認」に focus 移動 (Phase 3 #2573 §5.1 整合) |
| **段階 2 → 段階 3 (/confirm → Stripe Checkout)** | 同意 checkbox check 後、「上記内容で申し込む」CTA enabled (Phase 3 #2573 §5.1 整合)、CTA クリック後 Stripe Checkout にリダイレクト (Stripe 側 a11y は Stripe 標準) |
| **段階 3 → 段階 4 (Stripe Checkout → success)** | webhook 経由 polling UI (Phase 3 #2572 確定済) で `aria-live="polite"` 「処理中です…」 → 「権限を解放しました」 |

### 5.2 keyboard 動線

全段階で Tab 順序が動線方向と一致するよう設計 (a11y 整合):

- 段階 0 gate: gate 直前 / 直後の通常コンテンツ → gate disabled button → tooltip (`aria-describedby`) → PremiumBadge → 「プランを見る」link (Phase 3 #2570 整合)
- 段階 1 subscription page: 4 ページ分割の標準 Tab 順序 (Phase 3 #2567 整合)
- 段階 2 /confirm: 6 ブロック → checkbox → 「やめる」→ 「上記内容で申し込む」(Phase 3 #2573 §5.3 整合)
- 段階 3 Stripe Checkout: Stripe 標準 a11y (本書 scope 外)

---

## 6. Storybook stories 設計

```typescript
// UpgradeFlow 動線確認用 stories (Phase 7、本書は動線レイヤのため stories は段階別 stories の組合せ確認)
// 既存 stories (Phase 3 #2567/#2570/#2573 で確定済) を組合せて動線通しの確認:

// SubscriptionPage.stories.svelte (Phase 3 #2567)
- FreeWithTrial         // 無料 + trial 期間中 (アップ動線起点)
- StandardCurrent       // standard 契約者 (family へのアップ動線起点)
- FamilyCurrent         // family 契約者 (ダウン動線起点、本書参照のみ)
- WithContextFromGate   // ?from=feature-gate&feature=ai-suggest 経由 (gate 経由動線確認)

// SubscriptionConfirmPage.stories.svelte (Phase 3 #2573)
- FreeToFamily          // 無料 → ファミリー 新規 (proration なし)
- StandardToFamily      // スタンダード → ファミリー (proration 差額表示)
- WithUpgradeFlowContext // ?from=feature-gate&feature=ai-suggest 経由の context 表示 (本書新規 UPGRADE_FLOW_LABELS 確認)
- ConsentChecked        // 同意済 (CTA enabled)
- ConsentUnchecked      // 同意未済 (CTA disabled + tooltip)

// FeatureGate.stories.svelte (Phase 3 #2570)
- InlineFreeToStandard  // gate → subscription page 経路起点
- SectionFreeToFamily   // gate overlay link → subscription page 経路起点
```

---

## 7. Playwright SS + E2E テスト計画

### 7.1 動線通し E2E (`tests/e2e/upgrade-flow.spec.ts` 新規、Phase 7 実装)

```typescript
// 必須 8 シナリオ (動線通しテスト、Phase 7 実装時に追加)
test('動線 1: 無料 → ファミリー (gate 経由)', async ({ page }) => {
  // 段階 0 (gate click) → 段階 1 (subscription page、?from=feature-gate&feature=ai-suggest)
  // → 段階 2 (/confirm?plan=family、context 文言確認) → 段階 3 (Stripe Checkout mock)
  // → 段階 4 (webhook 経由 success polling → 権限解放)
});

test('動線 2: 無料 → スタンダード (header badge 経由)', async ({ page }) => {
  // 段階 0 (header badge click) → 段階 1 → 段階 2 (?plan=standard) → 段階 3 → 段階 4
});

test('動線 3: スタンダード → ファミリー (proration 差額表示)', async ({ page }) => {
  // 段階 1 (subscription page、standard 契約者) → 段階 2 (/confirm、preview API mock で差額 ¥530 表示)
  // → 段階 3 → 段階 4 (subscriptions.update preview + always_invoice mock)
});

test('動線 4: feature gate tooltip → subscription page で context 表示', async ({ page }) => {
  // 段階 0 inline gate tooltip → click → ?from=feature-gate&feature=marketplace-import
  // → subscription page 上部 context 文言確認
});

test('動線 5: /confirm 同意 checkbox → CTA 有効化 → Checkout 遷移', async ({ page }) => {
  // 段階 2 同意 checkbox toggle → CTA enabled/disabled 切替 (Phase 3 #2573 §7.2 整合)
});

test('動線 6: ダウン動線 (family → standard、本書参照のみ)', async ({ page }) => {
  // 段階 1 (family 契約者) → DowngradeResourceSelector → 期末 schedule → 期末ダウン banner #2574 表示確認
});

test('動線 7: アップ即時 vs ダウン期末の動線分岐確認', async ({ page }) => {
  // standard 契約者 → アップ CTA (family) → /confirm 即時遷移
  // family 契約者 → ダウン CTA (standard) → DowngradeResourceSelector → 期末 schedule
});

test('動線 8: trial→in-app paywall 経由のアップ動線 (Phase 4 #2622 統合)', async ({ page }) => {
  // trial 中 → TrialBanner sticky-invite click → ?from=trial-1d → subscription page 上部 context 表示
  // → アップ CTA → /confirm → Checkout
});
```

### 7.2 SS 取得 (memory test-coverage-every-issue 整合)

| 変数 | URL | 状態 | 用途 |
|---|---|---|---|
| `upgrade-flow-stage0-gate` | (FeatureGate.svelte stories 経由) | inline tooltip + section overlay | 段階 0 起点 SS (Phase 3 #2570 SS と統合) |
| `upgrade-flow-stage1-context` | `/admin/subscription?from=feature-gate&feature=ai-suggest` | 上部 context 文言表示 | 段階 1 context-passing SS (本書新規) |
| `upgrade-flow-stage2-confirm-with-context` | `/admin/subscription/confirm?plan=family&from=feature-gate&feature=ai-suggest` | 上部 context 文言 + 6 ブロック + 差額表示 | 段階 2 context + 特商法 SS (本書新規) |
| `upgrade-flow-stage2-confirm-proration` | `/admin/subscription/confirm?plan=family` (standard 契約者) | proration 差額 ¥530 表示 | 段階 2 proration SS (Phase 3 #2573 SS と統合) |
| `upgrade-flow-stage3-checkout-mock` | (Stripe Checkout mock) | カード入力フォーム | 段階 3 SS (Stripe 標準) |
| `upgrade-flow-stage4-success-polling` | `/admin/subscription/success` | polling UI + webhook 経由完了 | 段階 4 SS (Phase 3 #2572 SS と統合) |

### 7.3 UX レビュー (3 ペルソナ、Phase 7 PR で実施)

1. **慎重派 (1 人っ子家庭 / standard 検討者)**: 「`${PLAN_FULL_TERMS.standard}` で十分」context が gate → subscription page → /confirm で一貫して表示されるか / 差額表示で「いくら払うか」が gate 段階で予見できるか
2. **即決派 (兄弟複数家庭 / family ターゲット)**: 4 段階の Tab キー操作で 10 秒以内に Checkout に到達できるか / 「ファミリーにする」CTA で「what happens when clicked」が明確か
3. **gate 経由探索派 (feature gate 経由)**: gate tooltip → /confirm まで「何の機能を解放するか」が一貫して表示されるか (context-passing 文言整合)

---

## 8. impact-analysis 4 layer 防御

### L1 構文 (ast-grep / ripgrep) — 事後検証 PR 時に実施

- `PLAN_CHANGE_LABELS.upgradeConfirm` 参照: Phase 2 #2549 確定済 atom (新規利用想定箇所: subscription page #2567 + /confirm #2573)
- `SUBSCRIPTION_CONFIRM_LABELS.confirmButtonLabel` 参照: Phase 3 #2573 確定済 atom (本書では新規参照なし、再利用のみ)
- `?from=feature-gate&feature=<id>` クエリ参照: 本書 §3.4 で動線確定、Phase 4 #2622 (trial→paywall) との整合確認 (両者で `?from=...` 経路を共有)
- `UPGRADE_FLOW_LABELS.contextFromFeatureGate` 等の新規 atom 利用: 本書 §4.2 で確定、Phase 7 実装で `/confirm +page.svelte` から参照

### L2 意味 (型 / 同名異義)

- `family` atom (現状の atom key 'family' を維持、Phase 3 #2609 SSOT 衝突解決後の Phase 7 で rename 判断) vs 内部 enum `'family'` / DB `plan_tier='family'` の整合 — Phase 1 #2588 FR-5 で明文化済
- アップ動線 (即時) vs ダウン動線 (期末) の同型扱い禁止: 本書 §2.2 で明示的に動線分離 (mermaid 図 1 vs 図 2)
- `?from=...` クエリと Phase 4 #2622 trial-3d/1d/0d/trial-end の context-passing は **同一 URL クエリ機構** を共有 (新規仕組み追加不要、Phase 4 #2622 §「原則 2」整合)
- proration 差額表示の通貨単位: `PRICE_TERMS.taxNote` (税込) 適用範囲は Phase 3 #2573 §8.L2 で確定済、本書では再確認のみ

### L3 構造 (依存グラフ)

- 動線依存チェーン (アップ動線、段階 0 → 段階 4):
  ```
  feature gate (#2570) ─┐
  header plan-badge (#2568) ─┼→ /admin/subscription (#2567) ─→ /admin/subscription/confirm (#2573)
  ActivityLimitBanner (#2569) ─┘                                                    │
                                                                                     ↓
                                                                                Stripe Checkout
                                                                                     │
                                                                                     ↓ webhook
                                                                              /admin/subscription/success (#2572)
                                                                                     │
                                                                                     ↓ webhook 権限解放
                                                                              family 機能即時利用
  ```
- ダウン動線依存チェーン (本書参照のみ、#2574/#2575 で確定):
  ```
  /admin/subscription (#2567) ─→ DowngradeResourceSelector (#2575)
                                              │ 確定
                                              ↓
                                  Stripe schedule_at_period_end
                                              │ webhook
                                              ↓
                                  期末ダウン banner (#2574)
                                              │ 期末到達
                                              ↓
                                  自動降格 + archived 表示 + 復活 CTA
  ```
- subscription page (#2567) の load 関数で `previewSubscriptionChange()` (Phase 5 アーキ実装) を呼ばない: preview API call は **/confirm の load** に限定 (本書 §3.3 図 1 + §3.4 整合)、subscription page では「差額表示なし、プラン選択のみ」(Phase 3 #2567 既存設計)

### L4 派生 artifact 21 カテゴリ (本 #2624 docs PR は該当なし、Phase 7 実装 PR で適用)

| カテゴリ | 影響 (Phase 7 実装時) |
|---|---|
| A. 法務文書 | 本書 scope 外 (Phase 3 #2573 で確定済、tokushoho.html の 6 項目見出し変更なし) |
| B. Stripe 連携 | `stripe-service.ts` に `previewSubscriptionChange()` 関数追加 + `subscriptions.update` (`proration_behavior=always_invoice`、アップ即時) call 追加 (Phase 2 #2549 §「Phase 5 申し送り 7+8+9」整合) |
| C. 認可 / Parent-Gate | 全動線が `/admin/*` 配下のため既存 Parent-Gate (ADR-0050) で保護済 |
| D. E2E / Playwright | Phase 7 実装時に新規追加する upgrade-flow spec (§7.1 8 シナリオ) + 既存 [tests/e2e/](../../../tests/e2e/) 配下 subscription-confirm spec (Phase 3 #2573) 拡張 (?from= context 検証) |
| E. Storybook | 既存 stories (Phase 3 #2567/#2570/#2573) に variant 追加 (§6 WithContextFromGate / WithUpgradeFlowContext) |
| F. labels.ts | `UPGRADE_FLOW_LABELS` 新規 (本書 §4.2、compound 1 件 5 メソッド) + PLAN_CHANGE_LABELS (Phase 2 #2549 確定済) の subscription page 参照追加 |
| G. generate-lp-labels | UPGRADE_FLOW_LABELS は LP 露出なし (`/admin/*` 配下のみ)、`npm run pre-ready` Step 8 (`generate-lp-labels --check`) は影響なし |
| H. legacy-url-map | 本動線の URL `/admin/subscription` / `/admin/subscription/confirm` は Phase 4 #2620 で永久エントリ確定済、本書では新規追加なし |
| I-U (その他 11) | docs / scripts / CI / 通知 / monitoring 等は Phase 7 個別判断 (本書 scope 外) |

---

## 9. 大方針整合チェック (作業姿勢、#2525 critical case)

### 9.1 目的達成

| 目的 (Issue #2624) | 達成方法 |
|---|---|
| アップ動線統一 CTA (gate → CTA → /confirm → Checkout) | §3.1 4 段階 conversion funnel + §3.3 mermaid 図 1 + §3.4 context-passing SSOT |
| アップ即時 vs ダウン期末分岐 (Notion 型 Pattern A) | §2.2 動線分離 + §3.3 mermaid 図 1 (アップ) / 図 2 (ダウン参照) + §3.2 4 ボタン整理 |
| proration 差額表示動線 (Phase 5 アーキ依存) | §3.3 図 1 で Preview API call timing 明示 + §3.4 段階 1 → 段階 2 context-passing (Phase 3 #2573 §3.3 整合) |
| Kinde 「what happens when clicked」CTA 文言整合 | §2.1 設計原則 + §4.1 atom 表 (PLAN_CHANGE_LABELS.upgradeConfirm = `¥{差額} を支払って ${PLAN_FULL_TERMS.family} に変更`) |

### 9.2 premium 階層 signal 打消 (refs #2594 D-2)

本動線で premium 階層 signal を構造的に打消す verification:

- 段階 1 subscription page (#2567) で `FREE_PLAN_TERMS.forever` (永久無料) / `FREE_TERMS.start` (まずは無料) を hero / pricing に維持 (Phase 4 #2621 LP→app 動線整合)
- 段階 2 /confirm (#2573) で「お選びのプランの機能」(`CHECKOUT_TERMS.chosenPlanFeature`) 経由「すべての機能」誤認排除 (景品表示法第5条1号整合)
- standard 推奨バッジ (V4 decoy framing #2588) で「家庭ごとに最適なプランを選ぶ」フレーミングを段階 1 → 段階 2 で一貫表示
- 「特別オファー」「期間限定」「お得」等の煽り語彙は本動線全 CTA で不採用 (ADR-0012 整合)

### 9.3 ADR 適合性総括

| ADR | 適合 |
|---|---|
| ADR-0010 (Pre-PMF) | ✅ Bucket A (法令必須 = 特商法 6 項目通過 + Stripe 公式 proration UX)、過剰防衛なし |
| ADR-0012 (Anti-engagement) | ✅ countdown timer / modal interrupt / 連続演出すべて不採用 / アップ即時で短時間完結 / ダウンは静的 banner 1 件 (#2574 参照) |
| ADR-0013 (LP truth) | ✅ LP / app / 法務文書 3 経路で `family` atom 表示名「ファミリー」維持 (Phase 3 #2609 SSOT 衝突解決後の Phase 7 で rename 判断) |
| ADR-0045 (terms.ts 2 階層) | ✅ Phase 2 #2549 + Phase 3 #2570/#2573 既存 atom を再利用 + 新規 UPGRADE_FLOW_LABELS compound のみ追加 (atom は新規なし、二重実装禁止) |
| ADR-0050 (Parent-Gate) | ✅ /admin/* 配下、子供 UI に課金圧表示なし |
| ADR-0051 (NUC-SaaS Bifurcation) | ✅ NUC 環境では本動線非表示 (Edition badge 経路、別 issue で扱う) |

---

## 10. 6 観点 workflow 自己検証 ([[per-issue-execution-workflow]] 整合)

### 観点 1: 着手時 deep-research (本プロジェクト固有性 + 業界事例)

- **本プロジェクト固有性**: Phase 2 #2549 deep-research (Stripe `proration_behavior` 3 値 + Preview API + 超過リソース 5 パターン対比 + Kinde Plan Change Best Practices + Win-Back Chargebee/Sequenzy/Churnkey + 消費者庁特商法ガイドライン 2022) を再利用 + Phase 3 #2567/#2570/#2573 で個別 UI 設計確定済 → 本書はそれらを動線レイヤで統合
- **業界事例**: Kinde 「what happens when clicked」原則 (Stripe Plan Change Best Practices) + Notion 型 Pattern A (Phase 2 #2549 採用) + Linear / Asana の Tier Change UX (4 段階 conversion funnel)
- **Open question**: 本動線で proration 差額が ¥0 になるエッジケース (即時 upgrade 直後の同日再アップ) の表示は Phase 7 実装時に確定 (Phase 3 #2573 §11 Open #6 参照)

### 観点 2: UI 変更時の SS + a11y 検証計画

- **SS 取得計画**: §7.2 で 6 SS 確定 (段階 0/1/2/3/4 + context-passing variant)、Phase 7 実装時に取得
- **a11y 検証計画**: §5 で段階間遷移の Tab 順序 + screen reader 動線 + WCAG 2.1 AA 整合 (`@axe-core/playwright` 自動検証、Phase 7 PR で実施)
- **UX レビュー (3 ペルソナ)**: §7.3 で慎重派 / 即決派 / gate 経由探索派の 3 ペルソナを Phase 7 PR で実施

### 観点 3: UX 変更時のテスト計画

- **E2E 動線通しテスト**: §7.1 で 8 シナリオ確定、Phase 7 実装時に `tests/e2e/upgrade-flow.spec.ts` 新規追加
- **Storybook variant**: §6 で既存 stories (#2567/#2570/#2573) に variant 追加 (`WithContextFromGate` / `WithUpgradeFlowContext`)
- **個別実行は不要**: 全 phase の動線統合確認は Phase 7 一括実施 ([[per-issue-execution-workflow]] §3 整合)

### 観点 4: 用語 SSOT 化検証 (terms.ts / labels.ts 経由 + 用語統一)

- **atom 経由参照確認**: §4.1 で既存 atom (PLAN_CHANGE_TERMS / SUBSCRIPTION_CONFIRM_LABELS / PLAN_GATE_LABELS) を再利用、§4.2 で新規 compound UPGRADE_FLOW_LABELS 1 件のみ追加
- **terms.ts への新規追加なし**: atom は全て既存を再利用 (ADR-0045 §3.3 二重実装禁止整合)
- **Kinde 「what happens when clicked」整合**: §4.1 で `PLAN_CHANGE_LABELS.upgradeConfirm` (Phase 2 #2549 確定済 = `¥{差額} を支払って ${PLAN_FULL_TERMS.family} に変更`) を再利用、「アップグレード」単独の動詞句は不採用 (Kinde 原則違反回避)

### 観点 5: 影響範囲事後検証 (skill `impact-analysis` 4 layer 防御)

- **L1 構文**: §8.L1 で `PLAN_CHANGE_LABELS.upgradeConfirm` / `SUBSCRIPTION_CONFIRM_LABELS` / `?from=` 参照を確認
- **L2 意味**: §8.L2 で `family` atom vs enum / アップ即時 vs ダウン期末分岐の同型扱い禁止 / `?from=...` Phase 4 #2622 整合
- **L3 構造**: §8.L3 で動線依存チェーン (アップ + ダウン) を mermaid + 矢印図で確定、subscription page load で preview API 呼ばない (Phase 3 #2567 既存設計維持) を明示
- **L4 派生 artifact 21 カテゴリ**: §8.L4 で本 PR docs のみ該当、Phase 7 実装 PR で 21 カテゴリ checklist 適用

### 観点 6: 目的達成 / 大方針整合

- **目的達成**: §9.1 で Issue #2624 AC 4 件全達成確認 (動線 mermaid 図 / アップ即時 vs ダウン期末分岐 / proration 差額表示動線 / Kinde 原則整合)
- **個別最適でない**: §1.3 で Phase 1+2+3+4 上流 SSOT との整合確認 (#2535 / #2549 / #2570 / #2573 / #2574 / #2620 / #2588 / #2548)
- **大方針整合**: §9.3 で ADR-0010 / 0012 / 0013 / 0045 / 0050 / 0051 適合性総括

---

## 11. Phase 7 実装手順 (本 #2624 は docs のみ、実装は Phase 7)

1. `labels.ts` に `UPGRADE_FLOW_LABELS` compound 追加 (§4.2、新規 1 件 5 メソッド)
2. `src/routes/(parent)/admin/subscription/confirm/+page.server.ts` (Phase 3 #2573 で新規追加する load、Phase 7 実装) に `?from=...` / `?feature=...` クエリ受取 + `UPGRADE_FLOW_LABELS` 経由 context 文言生成
3. `src/routes/(parent)/admin/subscription/confirm/+page.svelte` (Phase 3 #2573 で新規追加、Phase 7 実装) で context 文言上部表示 + 6 ブロック構造維持
4. `src/routes/(parent)/admin/subscription/+page.server.ts` (Phase 3 #2567 既存実装) で `?from=...` クエリ受取 + Phase 4 #2622 (trial→paywall) と integrated な context 表示
5. `src/routes/(parent)/admin/subscription/+page.svelte` (Phase 3 #2567 既存実装) で context 文言上部表示 + 4 ページ分割 UI 維持
6. `stripe-service.ts` に `previewSubscriptionChange()` 関数追加 (Phase 2 #2549 §「Phase 5 アーキ 申し送り 7+8+9」整合、Phase 5 アーキで本格実装、本 Phase 4 では interface stub のみ)
7. Storybook variant 追加 (§6 WithContextFromGate / WithUpgradeFlowContext)
8. Playwright E2E 8 シナリオ追加 (§7.1)
9. impact-analysis 4 layer 防御 + 21 カテゴリ checklist を Phase 7 PR body に記載
10. UX レビュー 3 ペルソナ (§7.3) + a11y 自動検証 (`@axe-core/playwright`)
11. 法務 review (Phase 3 #2573 で確定済の特商法 6 項目を本動線で確実に通過することを再確認、誤認表示禁止違反性は #2573 法務 review に統合可能)

---

## 12. Open question (PO 判断、Phase 7 実装時に確認)

| # | 論点 | 推奨案 | 状態 |
|---|---|---|---|
| 1 | アップ動線の 4 段階 (gate → subscription page → /confirm → Checkout) を 3 段階 (gate → /confirm → Checkout、subscription page スキップ) に圧縮するか? | **不採用**: subscription page (#2567) は V4 decoy framing (standard 推奨バッジ + family 最右配置) のための「ダウンセル経路」として必須。圧縮すると LTV 最適化 (Phase 4 #2622 §「原則 3」) が崩れる | 要 PO 判断、推奨は 4 段階維持 |
| 2 | `?from=feature-gate&feature=<id>` の `feature` パラメータの atom 化 (Phase 4 #2622 §「原則 4 feature ID 一覧」と統一) | **採用**: Phase 4 #2622 §「原則 4」で確定済の feature ID 一覧 (`marketplace-import` / `child-add` / `activity-add` / `ai-suggest` 等) を本書でも統一参照 | 確定 (Phase 4 #2622 整合) |
| 3 | proration 差額が ¥0 になるエッジケース (即時 upgrade 直後の同日再アップ) の /confirm 表示 | Phase 3 #2573 §11 Open #6 と統合、Phase 7 実装時に Stripe cents 単位整合で確定 | Phase 7 実装時 |
| 4 | アップ動線中の途中離脱率 (subscription page → /confirm への遷移率 + /confirm → Checkout への遷移率) の Phase 7 計測 | **採用**: Phase 7 PR で Playwright SS A/B + UX レビュー時に 3 ペルソナでの離脱箇所特定。Phase 5 アーキで分析 SSOT (`/ops/analytics`) に metric 追加 | Phase 7 実装時 |
| 5 | feature gate inline tooltip + section overlay の **両方とも CTA 文言を同一にする** (`tooltipFor(tier)` 統一) vs 各 variant で文言調整 (inline = 短文 / section = 長文) | **採用 (統一)**: Phase 3 #2570 で `tooltipFor` 統一 atom 確定済、variant 別差分は文字数制約のみ (UI レイヤで処理) | 確定 (Phase 3 #2570 整合) |
| 6 | アップ動線終端 (段階 4 success) の **webhook polling failure** 時の再試行動線 | Phase 3 #2572 で polling UI 確定済 (再試行 + サポート問合せリンク)、本書では参照のみ | 確定 (Phase 3 #2572 整合) |
| 7 | trial 中 (`active_trial` 状態) からのアップ動線 (Phase 4 #2622 統合) で、trial 終了通知 3 タッチ (T-3d/1d/0d) からの遷移と本動線の context 表示の整合性 | **採用**: Phase 4 #2622 §「原則 2」`?from=trial-3d/1d/0d/trial-end` を本書 §3.4 で統一参照、UPGRADE_FLOW_LABELS.contextFromTrialEnd で文言確定 | 確定 (Phase 4 #2622 整合) |
| 8 | **法務 review の取扱い** (Phase 3 #2573 で確定済の特商法 6 項目を本動線で確実に通過するため、本書も #2573 法務 review に統合可能か) | **採用**: 本書は #2573 の動線レイヤ補強 (新規 atom UPGRADE_FLOW_LABELS は context 表示のみで特商法本体に影響なし)、#2573 法務 review に統合し本書単独 review は不要 | Phase 7 法務 review (#2573 統合) |

---

## 13. Open question (Adversarial Reviewer 3 軸、PO 判断待ち)

| 軸 | 論点 | 推奨案 | 状態 |
|---|---|---|---|
| **business** | アップ即時 (`proration_behavior=always_invoice`) を採用すると、ユーザーが「即時で課金された」と認識して返金要求が発生するリスク。Phase 5 アーキで `proration_behavior=create_prorations` (次回請求時に充当) を採用すべきか? | **不採用 (即時請求維持)**: Stripe 公式 + 業界収束 ("don't make them wait") に整合。即時請求にすることで「即時 capability 解放」と支払いタイミングが一致し、ユーザーの予測可能性が向上 (Kinde 「what happens when clicked」原則)。返金要求リスクは Phase 3 #2573 特商法 6 項目 (差額表示 + 同意 checkbox) で予防 | Phase 5 アーキ確定 (Phase 2 #2549 採用済) |
| **UX** | アップ動線 4 段階を 3 段階 (gate → /confirm → Checkout、subscription page スキップ) に圧縮した方が conversion rate は上がる可能性 (4 段階の途中離脱) | **不採用 (4 段階維持)**: subscription page (#2567) は V4 decoy framing + standard 推奨バッジによる **LTV 最適化動線** であり、圧縮すると 1 人っ子家庭がいきなり family を選んで family loss → 解約 → LTV 減少につながる。conversion rate (短期) vs LTV (長期) の trade-off は LTV 優先 (Pre-PMF 段階の生存戦略、ADR-0010 整合)。4 段階維持し各段階で context 表示で離脱率を抑制する設計を維持 | Phase 7 実装時に A/B 計測で確定 (Phase 12 で要再評価) |
| **security** | `?from=feature-gate&feature=<id>` クエリ経由の context-passing で `feature` パラメータに任意の値を渡された場合、subscription page / /confirm で誤った文言が表示される可能性 (例: `?feature=admin-bypass`) | **採用 (safe fallback)**: 本書 §3.4 で「セキュリティ: `?from=...` と `?feature=...` は表示文言切替のみで認可境界には影響しない (任意の値が来ても標準表示にフォールバック)」を明文化。実装時に feature ID は Phase 4 #2622 §「原則 4」の whitelist と照合し、whitelist 外は context 非表示 (標準表示、Phase 3 #2573 6 ブロック構造のみ) | Phase 7 実装時に whitelist 照合実装 (`UPGRADE_FLOW_FEATURE_WHITELIST` const、Phase 4 #2622 統合) |

---

## 14. 根拠 (primary source、deep-research 2026-05-29)

### 14.1 Stripe 公式 + 業界実装

- Stripe `subscriptions.update` API 仕様 + `proration_behavior` 3 値 (`always_invoice` / `create_prorations` / `none`) `https://docs.stripe.com/billing/subscriptions/upgrade-downgrade`
- Stripe Preview API `POST /v1/invoices/create_preview` 仕様 `https://docs.stripe.com/api/invoices/create_preview`
- Stripe Customer Portal `schedule_at_period_end` 設定 `https://docs.stripe.com/customer-management/configure-portal`
- Kinde Plan Change Best Practices `https://docs.kinde.com/billing/plans/plan-change-best-practices/` (「what happens when clicked」原則 + 「avoid scare tactics」)
- Notion 公式 Help Center: 「Downgrade your plan」(Pattern A 採用、既存資産保護 + read-only) `https://www.notion.so/help/downgrade-your-plan`

### 14.2 既存実装 (Explore 照合 2026-05-29)

- `src/lib/features/admin/components/SaasLicensePanel.svelte:165-763` (Phase 7 で `SaasSubscriptionPanel.svelte` に rename、現状の subscription page 統合 UI)
- `src/lib/server/services/downgrade-service.ts:31-117` (`getDowngradePreview` / `archiveForDowngrade`)
- `src/lib/server/services/resource-archive-service.ts` (`archived_reason='downgrade_user_selected'`)
- `src/lib/features/admin/components/DowngradeResourceSelector.svelte` (Phase 3 #2575 で UI 強化 (Phase 7 実装))
- `src/lib/ui/components/FeatureGate.svelte:43-66` (Phase 3 #2570 で改善確定済)
- `src/lib/server/services/stripe-service.ts:43-114` (Phase 5 アーキで `previewSubscriptionChange()` + `subscriptions.update` 拡張、Phase 7 実装)

### 14.3 Phase 1+2+3+4 上流 SSOT

- `docs/design/billing-redesign/phase1-plan-change-requirements.md` (Phase 1 #2535 FR-3〜FR-7)
- `docs/design/billing-redesign/phase1-checkout-requirements.md` (Phase 1 #2534 FR-1〜FR-8)
- `docs/design/billing-redesign/phase1-naming-url-integrity-requirements.md` (Phase 1 補強 1 #2583)
- `docs/design/billing-redesign/phase1-plan-naming-pricing-axis-requirements.md` (Phase 1 補強 2 #2588)
- `docs/design/billing-redesign/phase2-plan-change-journey.md` (Phase 2 #2549 Tier Change + Notion 型 Pattern A + proration UX)
- `docs/design/billing-redesign/phase2-checkout-journey.md` (Phase 2 #2548 4 谷 + Reverse Trial パターン C)
- `docs/design/billing-redesign/phase3-feature-gate-ui-design.md` (Phase 3 #2570)
- `docs/design/billing-redesign/phase3-subscription-confirm-tokushoho-ui-design.md` (Phase 3 #2573)
- `docs/design/billing-redesign/phase3-scheduled-downgrade-banner-ui-design.md` (Phase 3 #2574)
- `docs/design/billing-redesign/phase3-subscription-page-ui-design.md` (Phase 3 #2567)
- `docs/design/billing-redesign/phase4-url-mapping-design.md` (Phase 4 #2620)
- `docs/design/billing-redesign/phase4-lp-app-flow-design.md` (Phase 4 #2621)
- `docs/design/billing-redesign/phase4-trial-paywall-flow-design.md` (Phase 4 #2622)

### 14.4 ADR + memory

- ADR-0010 (Pre-PMF scope、Bucket A 法令必須)
- ADR-0012 (Anti-engagement)
- ADR-0013 (LP truth、3 経路 SSOT 整合)
- ADR-0045 (terms.ts 2 階層、UPGRADE_FLOW_LABELS compound 責務 + 既存 atom 再利用)
- ADR-0050 (Parent-Gate session cookie)
- ADR-0051 (NUC-SaaS Bifurcation)
- ADR-0056 (QM drift prevention、Adversarial Reviewer business/UX/security 3 軸 §13 整合)
- skill `impact-analysis` (4 layer 防御 + 21 カテゴリ checklist)
- 関連 memory: feedback_billing_critical_extra_caution / feedback_adr0010_interpretation / feedback_scope_customer_experience_layer / feedback_design_intent_grounding / feedback_test_coverage_every_issue / feedback_deep_research_product_specific / reference_per_issue_execution_workflow / reference_impact_analysis_methodology / feedback_pr_review_recurring_blocks
