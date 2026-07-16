// src/lib/server/db/restore-idempotency.ts
// #3394: backup restore の insertForRestore 冪等 guard 分類 SSOT (same-class #3385/#3391/#3387/#3401)。
//
// 背景: DynamoDB insertForRestore が SQLite unique index 相当の衝突防御を欠く同型欠陥が
// 連続発生した (#3385 challenge auto:weekly / #3391 stampCard)。個別パッチでは同 class の
// 新規 entity 追加時に再発するため、本 registry で「restore 冪等性の種別」と「backend ごとの
// guard 実装方式」を宣言し、fitness function (tests/unit/db/restore-idempotency-registry.test.ts)
// が以下を機械検証する (ADR-0061 same-class → guard):
//   1. no-silent-gap: 各 backend repo の `*ForRestore` 関数は全て本 registry に分類されている
//   2. guard 対称性: kind='natural-key' の entity は宣言された backend guard (ConditionExpression /
//      ON CONFLICT / onConflictDoNothing) がソース上に存在する
//   3. demo stub は null / false を返し import カウントを偽装しない (#3420 count 偽装 #2263 class)
//
// 統一契約 (機能等価契約、#3394 / #3401):
//   - natural-key 重複 → `null` (card/challenge/pref/cert) または `false` (entry) を返す =
//     import 側は skipped++ (imported に加算しない = count 偽装防止)
//   - その他の write 失敗 (throttle / network / FK) → **throw** (silent loss 禁止、#3401 例外分類)。
//     import 側 catch が skipped++ + errors.push で可視化する
//   - content-dedup (DB 自然キーなし) は import-service 層が merge mode で content key dedup する
//     (verbatim mode = cutover は bypass、#3653 semantics)

/**
 * restore 冪等性の種別。
 * - `natural-key`   : DB レベルの自然キー (unique index / 決定的 key + 条件付き書込) で重複を
 *                     物理拒否する。重複時は null / false を返す (throw しない)。
 * - `content-dedup` : DB 自然キーが存在しない (id-addressable append)。import-service が
 *                     merge mode で content key (既存行 + 同一 import 内) を dedup する。
 * - `append`        : dedup なしの append (再取込で複製され得る既知の制約)。理由を reason に明記。
 */
export type RestoreIdempotencyKind = 'natural-key' | 'content-dedup' | 'append';

/** backend ごとの guard 実装方式 (fitness function がソース上のマーカーを照合する)。 */
export type RestoreGuardImpl =
	/** DynamoDB: PutCommand + ConditionExpression 'attribute_not_exists(PK)' */
	| 'condition-expression'
	/** drizzle sqlite: .onConflictDoNothing() + returning/changes 判定 */
	| 'on-conflict-do-nothing'
	/** DSQL raw SQL: ON CONFLICT ... DO NOTHING + RETURNING 行有無判定 */
	| 'on-conflict-sql'
	/** DB 制約なし (dsql certificates 等)。import-service 層の dedup が唯一の防御 */
	| 'service-layer'
	/** demo: 書き込み no-op stub。null / false を返し count を偽装しない */
	| 'null-stub'
	/** guard 不要 (append / content-dedup で service 層が担う) */
	| 'none';

export interface RestoreIdempotencyEntry {
	kind: RestoreIdempotencyKind;
	/** repo ファイル basename (拡張子なし)。全 backend で同名。 */
	repoFile: string;
	/** 当該 entity の restore 関数名 (exported)。 */
	functionNames: string[];
	/** natural-key のとき: キーの人間可読表現 */
	naturalKey?: string;
	/** content-dedup のとき: import-service が使う content key の表現 */
	contentKey?: string;
	/** backend ごとの guard 実装方式 (fitness 照合対象) */
	guards: {
		sqlite: RestoreGuardImpl;
		dynamodb: RestoreGuardImpl;
		dsql: RestoreGuardImpl;
		demo: RestoreGuardImpl;
	};
	reason: string;
}

/**
 * backup restore 対象 entity の冪等 guard 分類 SSOT。
 * 新規に `*ForRestore` 関数を repo に追加したら本 registry にも追記する
 * (未追記は restore-idempotency-registry.test.ts の no-silent-gap で fail)。
 */
export const RESTORE_IDEMPOTENCY_REGISTRY: Record<string, RestoreIdempotencyEntry> = {
	childChallenge: {
		kind: 'natural-key',
		repoFile: 'child-challenge-repo',
		functionNames: ['insertForRestore'],
		naturalKey:
			'auto:weekly 行のみ (childId, startDate)。sqlite=部分 unique index idx_child_challenges_auto_weekly_unique / dynamodb=AUTO# 決定的 SK + attribute_not_exists / dsql=weekly_auto_guard UNIQUE。regular 行は新規採番 id キーで衝突しない',
		guards: {
			sqlite: 'on-conflict-do-nothing',
			dynamodb: 'condition-expression',
			dsql: 'on-conflict-sql',
			demo: 'null-stub',
		},
		reason:
			'#3387: 重複 auto:weekly backup が DynamoDB で silent 上書き + count 偽装される非対称の根治',
	},
	stampCard: {
		kind: 'natural-key',
		repoFile: 'stamp-card-repo',
		functionNames: ['insertCardForRestore'],
		naturalKey:
			'(childId, weekStart)。sqlite=idx_stamp_cards_child_week / dynamodb=SK STMPCARD#<weekStart> + attribute_not_exists / dsql=stamp_cards_week_uq',
		guards: {
			sqlite: 'on-conflict-do-nothing',
			dynamodb: 'condition-expression',
			dsql: 'on-conflict-sql',
			demo: 'null-stub',
		},
		reason: '#3391/#3394: dynamodb 無条件 Put の (child,weekStart) silent 上書き根治',
	},
	stampEntry: {
		kind: 'natural-key',
		repoFile: 'stamp-card-repo',
		functionNames: ['insertEntryForRestore'],
		naturalKey:
			'(cardId, slot) + (cardId, loginDate)。重複は boolean false を返し stampEntriesImported に加算しない',
		guards: {
			sqlite: 'on-conflict-do-nothing',
			dynamodb: 'condition-expression',
			dsql: 'on-conflict-sql',
			demo: 'null-stub',
		},
		reason: '#3394: 旧実装は重複 skip 後も void 返却で imported++ される count 偽装だった',
	},
	certificate: {
		kind: 'natural-key',
		repoFile: 'certificate-repo',
		functionNames: ['insertForRestore'],
		naturalKey:
			'(childId, certificateType)。sqlite=idx_certificates_child_type / dynamodb=SK CERT#<type> + attribute_not_exists / dsql=DB 制約なし (§11.2 未設置) のため import-service 層 dedup が唯一の防御',
		guards: {
			sqlite: 'on-conflict-do-nothing',
			dynamodb: 'condition-expression',
			dsql: 'service-layer',
			demo: 'null-stub',
		},
		reason:
			'#3401: dynamodb 旧実装は catch-all return null で throttle を「重複 skip」と誤分類していた',
	},
	activityPref: {
		kind: 'natural-key',
		repoFile: 'activity-pref-repo',
		functionNames: ['insertForRestore'],
		naturalKey:
			'(childId, activityId)。sqlite=idx_child_activity_prefs_unique / dynamodb=SK ACTPREF#<activityId> + attribute_not_exists / dsql=自然複合 PK',
		guards: {
			sqlite: 'on-conflict-do-nothing',
			dynamodb: 'condition-expression',
			dsql: 'on-conflict-sql',
			demo: 'null-stub',
		},
		reason: '#3465: dynamodb 無条件 Put の silent overwrite + count 水増し根治',
	},
	parentMessage: {
		kind: 'content-dedup',
		repoFile: 'message-repo',
		functionNames: ['insertForRestore'],
		contentKey: '(childId, messageType, stampCode, body, sentAt) — import-service merge mode',
		guards: {
			sqlite: 'none',
			dynamodb: 'none',
			dsql: 'none',
			demo: 'null-stub',
		},
		reason:
			'#3414: id-addressable append のため DB 自然キーなし。同一 backup 再取込の複製を service 層 content dedup で防ぐ (verbatim=cutover は bypass)',
	},
	siblingCheer: {
		kind: 'content-dedup',
		repoFile: 'sibling-cheer-repo',
		functionNames: ['insertForRestore'],
		contentKey: '(fromChildId, toChildId, stampCode, sentAt) — import-service merge mode',
		guards: {
			sqlite: 'none',
			dynamodb: 'none',
			dsql: 'none',
			demo: 'null-stub',
		},
		reason: '#3420: parentMessage と同型。demo stub の虚偽 imported カウントも null 返却で根治',
	},
	childVoice: {
		kind: 'append',
		repoFile: 'voice-repo',
		functionNames: ['insertForRestore'],
		guards: {
			sqlite: 'none',
			dynamodb: 'none',
			dsql: 'none',
			demo: 'null-stub',
		},
		reason:
			'音声 DB 行は filePath (uuid) が実質識別子で、静的ファイル復元 (#3077) と対で管理される。再取込複製は既知の制約 (backup 対象は同一 uuid path へ上書き復元されるため実害は DB 行の重複のみ)',
	},
	restDay: {
		kind: 'natural-key',
		repoFile: 'evaluation-repo',
		functionNames: ['insertRestDayForRestore'],
		naturalKey:
			'(childId, date)。sqlite=idx_rest_days_child_date / dsql=自然複合 PK + ON CONFLICT / dynamodb=保存対象外 (no-op stub が undefined を返し skip 計上)',
		guards: {
			sqlite: 'on-conflict-do-nothing',
			dynamodb: 'null-stub',
			dsql: 'on-conflict-sql',
			demo: 'null-stub',
		},
		reason:
			'統一契約の既存模範実装 (#3329)。重複 → undefined 返却 + import 側 skip 計上が全 backend で成立済',
	},
	checklistOverride: {
		kind: 'append',
		repoFile: 'checklist-repo',
		functionNames: ['insertOverrideForRestore'],
		guards: {
			sqlite: 'none',
			dynamodb: 'none',
			dsql: 'none',
			demo: 'null-stub',
		},
		reason:
			'日次 override は (child, targetDate, action, itemName) に DB 一意制約がなく、同日複数 override も正当なため dedup 対象外 (既知の制約、#3329)。' +
			'#3473 item 2 の「dynamodb に ConditionExpression 冪等 guard を追加 (#3385/#3448/#3465 と同方針)」は再分類の結果 non-applicable: ' +
			'#3385/#3448/#3465 は決定的 SK (STMPCARD#<weekStart> 等) への無条件 Put が既存行を silent overwrite + count 偽装する欠陥だった。' +
			'一方 insertOverrideForRestore は id を nextId で新規採番し SK=CKOVER#<date>#<id> が毎回一意になるため silent overwrite は構造的に発生せず、' +
			'残るのは append 特性 (merge 再取込での重複行) のみ。これは同日複数 override 正当性から dedup してはならない。' +
			'したがって natural-key guard は追加せず append 分類を維持する (ADR-0066 / #3719 統一契約整合)。',
	},
	rewardRedemption: {
		kind: 'append',
		repoFile: 'reward-redemption-repo',
		functionNames: ['insertRedemptionForRestore'],
		guards: {
			sqlite: 'none',
			dynamodb: 'none',
			dsql: 'none',
			demo: 'null-stub',
		},
		reason:
			'交換履歴は同一 (child, reward, requestedAt) の正当な複数申請があり得る append イベント。dedup 対象外 (既知の制約、#3329。残高の真実は pointLedger が持つ)',
	},
};

/** kind='natural-key' の entity 名一覧 (fitness / import-service 参照用)。 */
export function naturalKeyRestoreEntities(): string[] {
	return Object.entries(RESTORE_IDEMPOTENCY_REGISTRY)
		.filter(([, e]) => e.kind === 'natural-key')
		.map(([name]) => name)
		.sort();
}

/** registry が宣言する `repoFile:functionName` の組 (no-silent-gap 照合用)。 */
export function declaredRestoreFunctions(): string[] {
	return Object.values(RESTORE_IDEMPOTENCY_REGISTRY)
		.flatMap((e) => e.functionNames.map((fn) => `${e.repoFile}:${fn}`))
		.sort();
}
