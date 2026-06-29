// src/lib/domain/export-migrations.ts
// backup の lazy マイグレーション seam。
//
// 背景: backup は `version` フィールドを拠り所に持つ (export-format.ts EXPORT_VERSION) が、
// これまで「version 別の変換」は存在せず、各 bump が「追加のみ optional フィールド」である前提に
// 暗黙依存した tolerant reader だった。この不変条件が破れた瞬間 (フィールド rename / 分割 / 意味変更)
// に silent data loss (#3329 と同クラス) になる。
//
// 本モジュールは「旧 version の shape → 現 version の shape」へ import 前に正規化する**単一の seam**を提供し、
// 破壊的変更に明示的な置き場所を与える。現状の bump は全て追加のみのため変換は identity だが、
// **STEPS に全 version 連鎖を宣言することで「EXPORT_VERSION を bump したのに step 未登録」を
// テストで機械検出する** (= 追加のみ不変条件の機械ガード。`export-migrations.test.ts`)。
//
// 重要: マイグレーションは **checksum 検証の後**に実行する (checksum は元データに対して計算されているため、
// version を書き換える本処理を先に通すと verifyChecksum が mismatch する)。呼び出しは import の単一入口
// `importFamilyData` 冒頭に置く (import-service.ts)。

import { EXPORT_VERSION } from './export-format';

/** 1 つの version bump に対応する変換ステップ。破壊的変更時はここに transform を実装する。 */
interface MigrationStep {
	from: string;
	to: string;
	/** 旧 shape を次 version の shape に変換する。追加のみ bump は identity。 */
	migrate: (data: Record<string, unknown>) => Record<string, unknown>;
}

/** 追加のみ bump の identity 変換 (新フィールドは import 側が schema default で補う)。 */
const identity = (data: Record<string, unknown>): Record<string, unknown> => data;

/**
 * version 連鎖 (1.0.0 → … → EXPORT_VERSION)。
 * 新しい EXPORT_VERSION を切ったら必ず 1 step 追加する (追加のみなら identity、破壊的なら transform)。
 * 連鎖の網羅は export-migrations.test.ts が検証する。
 */
const STEPS: readonly MigrationStep[] = [
	{ from: '1.0.0', to: '1.1.0', migrate: identity },
	{ from: '1.1.0', to: '1.2.0', migrate: identity },
	{ from: '1.2.0', to: '1.3.0', migrate: identity },
	{ from: '1.3.0', to: '1.4.0', migrate: identity },
	{ from: '1.4.0', to: '1.5.0', migrate: identity },
	{ from: '1.5.0', to: '1.6.0', migrate: identity },
];

/** STEPS が辿れる version の集合 (chain の起点 + 各 step の to)。テストの網羅検証に使う。 */
export const MIGRATABLE_VERSIONS: readonly string[] = [
	STEPS[0]?.from ?? EXPORT_VERSION,
	...STEPS.map((s) => s.to),
];

/**
 * 旧 version の backup を現 version (EXPORT_VERSION) の shape へ lazy migration する。
 * fromVersion が EXPORT_VERSION なら即 return (identity)。step が見つからない version は
 * 「移行経路未定義」として throw し、silent な取りこぼしを fail-loud にする。
 */
export function migrateExportData(
	data: Record<string, unknown>,
	fromVersion: string,
): Record<string, unknown> {
	let current = fromVersion;
	let migrated = data;
	// 無限ループ保険: STEPS 数を上限に回す。
	for (let guard = 0; current !== EXPORT_VERSION && guard <= STEPS.length; guard++) {
		const step = STEPS.find((s) => s.from === current);
		if (!step) {
			throw new Error(
				`[export-migrations] version ${current} → ${EXPORT_VERSION} の移行経路が未定義です (STEPS に step を追加してください)`,
			);
		}
		migrated = step.migrate(migrated);
		current = step.to;
	}
	if (current !== EXPORT_VERSION) {
		throw new Error(
			`[export-migrations] 移行が ${EXPORT_VERSION} に到達しませんでした (from=${fromVersion})`,
		);
	}
	// 現 version に正規化したことを version フィールドにも反映する。
	return { ...migrated, version: EXPORT_VERSION };
}
