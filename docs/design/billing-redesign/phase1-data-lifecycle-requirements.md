# データライフサイクル 要件定義 (#2538 / Epic #2525 Phase 1)

| 項目 | 内容 |
|------|------|
| 孫 issue | #2538 (データライフサイクルの要件) — 複数孫 (トライアル/解約/ダウングレード/dunning) の連動中核 |
| 親 | #2526 (Phase 1) / 上位 #2525 |
| ステータス | Phase 1 完了 (deep-research: PIPC 一次 + ADR-0049/account-deletion-flow.md 照合 → PO 確定 2026-05-27、判断 3 論点も確定) |

## 重要: 「90日」は 2 系統 (混同注意)

| 系統 | 対象 | 期間 | SSOT |
|---|---|---|---|
| **A. プラン別履歴保持** | 活動ログ等の履歴が閲覧/保持される期間 | free **90日** / standard 1年 / family 無制限 | ADR-0049 |
| **B. 退会グレースピリオド** | アカウント削除を取り消せる復元猶予 | free **即時(0日)** / standard 7日 / family 30日 | account-deletion-flow.md §4.1 |

**解約=無料に戻る→A系統 90日保持適用**。**退会=B系統猶予後に全削除**。この 2 軸を要件で必ず分離。

## 機能要件 (FR)

| ID | 要件 | 設計意図 + 根拠 |
|----|------|----------------|
| FR-1 | プラン別履歴保持 (free 90日/standard 1年/family 無制限) を**物理削除**で履行 (日次 cron `recorded_date < cutoff`) | pricing 約束を実データで履行 (表示フィルタだけでない)。ADR-0049 |
| FR-2 | **ポイント残高 (BALANCE) は履歴削除対象外**。past明細 (point_ledger) は消えるが現在残高は不変 | 「がんばりの証」を毀損しない。**新規要件で BALANCE 削除を持ち込まない (最重要制約)** |
| FR-3 | 集計テーブル (report_daily_summaries 等) は削除対象外で恒久保持 | 月次レポート (有料機能) が全期間集計前提。集計は識別性低く保存制限趣旨に適合 |
| FR-4 | ダウングレード超過リソース (member 等) は**期末アーカイブ** (is_archived=true、物理削除せず)、再アップグレードで復元 | 課金境界での即時破壊回避、復帰インセンティブ。plan-change-flow.md §5.2 |
| FR-5 | 退会はプラン別グレース後に**全データ物理削除** (free 即時/standard 7日/family 30日)、grace 中は soft-delete (復元可) | 誤操作からの復元余地を有料ほど厚く。account-deletion-flow.md §4 |
| FR-6 | 全削除では **DB削除より先に Stripe Subscription キャンセル + Customer オブジェクト削除** (失敗時 throw で中断) | 課金継続のままテナント消滅=窓口喪失を防ぐ。Stripe 側に PII (メール等) を残さない (PO 確定 2026-05-27)。ADR-0022 |
| FR-7 | 解約 (subscription.deleted) は `plan=undefined, status=suspended`、**テナント・子供・履歴は削除しない** (free 縮退) | 解約と削除は別概念。A系統保持内は閲覧可、再課金で復元。plan-change-flow.md §3.4 |
| FR-8 | データエクスポートで解約/退会前に子供記録を持ち出し可能に (**UI 機能化、cloudExports 拡張、セルフサービス**、PO 確定) | PIPC 開示請求権 (法第33条) + 「記録を失う」配慮の機能的担保 |
| FR-9 | PIPC 利用停止・消去請求 (法第35条) に応じる導線 (退会=本人実行で実質充足 + 請求受付窓口) | 法第35条第5-6項 消去義務 |

## 非機能要件 (NFR)

- NFR-1: 物理削除は**復元不可能な手段**で消去 (PIPC FAQ。soft-delete 放置は消去にならない)
- NFR-2: 削除 cron はテナント単位 try/catch、dry-run、idempotent (障害分離、webhook 二重実行耐性)
- NFR-3: 削除予告メール (family 14日前/standard 1日前)、`deletion_warning_sent_at` で 1 送信 (突然消失防止)
- NFR-4: cancellation_reasons の free_text 等 PII も保持期間ポリシー対象 (ADR-0049 拡張、Open Q2)
- NFR-5: graduation_consent/certificates は法的・永続記録で保持対象外、ただし公開承諾**撤回フロー**を備える

## 統合方針 (解約/ダウングレード/退会/dunning)

```
解約(cancel)         → plan=undefined/suspended → 全保持。free移行→A系統90日→予告後物理削除。残高不変
ダウングレード        → plan=下位/active          → 超過は期末アーカイブ(復元可)。保持短縮分は予告後物理削除
dunning最終(canceled) → plan=undefined/suspended → ★解約と同一。free復帰→90日保持
退会(削除)           → subscription先にcancel    → grace後 全物理削除(復元不可)。Stripe customer も削除(Open Q4)
```

**統合原則**: 「dunning最終=解約=free復帰(保持)」「退会=全削除(復元不可)」の 2 分岐に集約。解約・ダウングレード・dunning は**保持側**、退会だけ**削除側**。

## PIPC 対応 (一次確認)

- 保存期間に**法的上限なし** (法第22条 努力義務)。自社の合理的保持期間設定は適法、pricing 約束履行が要点
- 法第35条 利用停止・消去請求に**応諾義務** (退会フローで実質充足 + 請求窓口必要)
- 消去は**復元不可能な手段**で (NFR-1)
- 子供データの年齢別特別規定は**日本法になし** (COPPA 適用外妥当、過剰防衛しない ADR-0010)

## Open question

| # | 論点 | 結論/状態 |
|---|------|----------|
| 1 | 保持期間境界処理 (90日超の古い履歴) | ✅ PO 確定 2026-05-27: **予告後物理削除** (ADR-0049 踏襲、ポイント残高は不変) |
| 2 | cancellation_reasons 保持期間 | 90日経過後物理削除、推奨で確定 |
| 3 | データエクスポート要件の範囲 | ✅ PO 確定 2026-05-27: **UI 機能化** (cloudExports 拡張、Phase 1 スコープ) |
| 4 | 退会時 Stripe Customer 削除 | ✅ PO 確定 2026-05-27: **Customer も削除** (PII 残さない、PIPC 消去整合) |
| 5 | judgment 保留テーブル (childCustomVoices/childAchievements) の retention 対象 | 卒業振り返り価値 vs 保存制限、Phase 5/法務 #2541 で確定 |

## 関連 (2026-05-28 補強)

- [URL/命名/用語の意味的整合性](phase1-naming-url-integrity-requirements.md) — Phase 1 補強 (#2526)。`/admin/license` → `/admin/subscription` rename / コンポーネント / atom 影響範囲 308+218+450 件

## 根拠 (primary source)

- PIPC FAQ (法第22条 消去努力義務 / 法第35条 消去請求応諾 / 復元不可能な消去 / 子供年齢別規定なし)
- ADR-0049 (retention 物理削除、BALANCE 対象外、集計恒久) / account-deletion-flow.md (§4 grace, §3 削除順) / plan-change-flow.md (§3.4 解約, §5.2 アーカイブ) / ADR-0022 (削除順) / ADR-0010 (過剰防衛しない)
