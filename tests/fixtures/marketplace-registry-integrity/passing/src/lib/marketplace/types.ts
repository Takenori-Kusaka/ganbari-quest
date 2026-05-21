/**
 * Marketplace registry integrity check — fixture (#2389)
 *
 * 本ファイルは `scripts/check-marketplace-registry-integrity.mjs --root <fixture>`
 * 経由でテストから検証される passing fixture。実コードベースから独立した最小限の
 * `MARKETPLACE_TYPE_CODES` SSOT を持つ。
 *
 * 5 type を完全に揃えた状態が「PASS する基準状態」。テスト内で本 fixture を tmpdir に
 * コピーした後、必要箇所だけ書き換えて FAIL ケースを再現する。
 */

export const MARKETPLACE_TYPE_CODES = [
	'activity-pack',
	'reward-set',
	'checklist',
	'rule-preset',
	'challenge-set',
] as const;
