/**
 * Marketplace export checksum SSOT — Issue #2372 (EPIC #2362 P4).
 *
 * Round-trip 保証 + 改竄検知のため、deterministic JSON + SHA-256 を提供する。
 *
 * 設計原則:
 *   - **deterministic stringify**: object key を再帰的にソートし、同じ payload なら
 *     必ず同じ JSON 文字列になることを保証。`Array` は順序維持 (semantic 上の意味)。
 *   - **SHA-256**: Node.js `crypto` 標準 + Web Crypto API の両環境で動作するよう
 *     SSR (Node) 経路を SSOT とし、UI 側 fetch は不要。
 *   - **export 時 checksum を payload と一緒に格納し、import 時に再計算して一致を
 *     verify する**。改竄 → 400 / Invalid checksum。
 *
 * 既存 `src/lib/server/services/import-service.ts:147 verifyChecksum` パターンを
 * marketplace 領域の SSOT に統合した薄いラッパ。
 *
 * 関連:
 *   - ADR-0006 (後方互換性、v1 export を新 import が読める保証)
 *   - Issue #2372
 */

import { createHash } from 'node:crypto';

/**
 * deterministic JSON stringify。
 *
 * - **object key を再帰的にソート** (RFC 8785 / JSON Canonicalization Scheme 簡易版)
 * - **Array は順序維持** (要素順は data semantics)
 * - `undefined` / `function` / `symbol` は JSON.stringify と同じく除外
 * - `null` / number / string / boolean / Array は JSON.stringify と同じ出力
 *
 * 同一の payload に対し常に同じ文字列を返す。round-trip 保証 + checksum 計算の
 * 入力に使う。
 *
 * @param value  stringify 対象
 * @returns      deterministic JSON 文字列
 */
export function deterministicStringify(value: unknown): string {
	return JSON.stringify(sortValueRecursive(value));
}

/**
 * 値を再帰的に key-sort した plain object / array に変換する。
 *
 * 戻り値は構造的に同じだが object key 順が文字列昇順に固定される。
 */
function sortValueRecursive(value: unknown): unknown {
	if (value === null || typeof value !== 'object') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(sortValueRecursive);
	}
	const obj = value as Record<string, unknown>;
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(obj).sort()) {
		sorted[key] = sortValueRecursive(obj[key]);
	}
	return sorted;
}

/**
 * 任意 payload の SHA-256 checksum (hex 文字列) を計算する。
 *
 * **deterministic stringify を経由**するため、object key の物理的並び順に
 * 依存しない。round-trip 後の checksum 一致を保証する。
 *
 * @param payload  checksum 対象 (object / array / primitive いずれも可)
 * @returns        64 文字の lowercase hex (e.g. "abc123...")
 */
export function computeChecksum(payload: unknown): string {
	const canonical = deterministicStringify(payload);
	return createHash('sha256').update(canonical).digest('hex');
}

/**
 * checksum 検証。改竄 / corruption 検知用。
 *
 * 期待 checksum と再計算 checksum が一致しなければ false。
 *
 * @param payload   検証対象 payload
 * @param expected  事前計算済みの checksum (export 時に格納された値)
 */
export function verifyChecksum(payload: unknown, expected: string): boolean {
	if (typeof expected !== 'string' || expected.length !== 64) {
		return false;
	}
	return computeChecksum(payload) === expected;
}
