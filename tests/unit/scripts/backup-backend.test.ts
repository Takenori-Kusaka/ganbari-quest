// tests/unit/scripts/backup-backend.test.ts
// #3967 — 「どの backend をバックアップするか」の判定を env × /api/health の組合せで固定する。
//
// 旧実装 `process.env.DATA_SOURCE || 'sqlite'` は未設定・typo・env 配布漏れのいずれでも
// 黙って SQLite 経路に落ちた。現状は SQLite 経路が必ず fail するため沈黙しないが、
// 依存しているのは「たまたま失敗すること」であり設計上の保証ではない。
// 本 test は「**判定できないなら実行しない**」を実行可能な形で固定する。
//
// cspell 例外 (本 file 限定):
//   - `pglte`: 「`pglite` の typo」を再現する負例 fixture。綴りを直すと negative case が
//     成立しなくなる (typo を検出できないことを検出できなくなる)。global 辞書に足すと
//     repo 全体で `pglite` の打ち間違いが素通りするため file scope に閉じる。
// cspell:ignore pglte

import { describe, expect, it } from 'vitest';

import {
	BackendResolutionError,
	resolveBackupBackend,
} from '../../../scripts/lib/backup-backend.cjs';

/** `/api/health` の正常レスポンス相当 (必要な field のみ)。 */
const health = (dataSource: unknown) => ({
	status: 'ok',
	dataSource,
	version: '1.0.0',
});

describe('#3967 resolveBackupBackend', () => {
	describe('AC1: DATA_SOURCE 未設定で SQLite に暗黙フォールバックしない', () => {
		it('env 未設定 + health あり → health の dataSource を採用する', () => {
			const r = resolveBackupBackend({ envDataSource: undefined, health: health('pglite') });
			expect(r.backend).toBe('pglite');
			expect(r.source).toBe('health');
			// 運用上の異常 (env 配布漏れ) は握り潰さずログに残す
			expect(r.detail).toContain('DATA_SOURCE 未設定');
		});

		it('env 未設定 + health 取得失敗 → sqlite に落ちず fail する', () => {
			expect(() => resolveBackupBackend({ envDataSource: undefined, health: null })).toThrow(
				BackendResolutionError,
			);
			expect(() => resolveBackupBackend({ envDataSource: undefined, health: null })).toThrow(
				/backend を特定できません/,
			);
		});

		it('空文字 / 空白のみの env は「未設定」と同じに扱う', () => {
			expect(resolveBackupBackend({ envDataSource: '', health: health('pglite') }).source).toBe(
				'health',
			);
			expect(resolveBackupBackend({ envDataSource: '   ', health: health('pglite') }).source).toBe(
				'health',
			);
		});
	});

	describe('AC2: env と実態が食い違ったら実行前に fail する', () => {
		it('env=sqlite / health=pglite → fail (#3950 の事故そのものの形)', () => {
			expect(() =>
				resolveBackupBackend({ envDataSource: 'sqlite', health: health('pglite') }),
			).toThrow(/backend が食い違っています/);
		});

		it('env=pglite / health=sqlite → fail (逆向きも同じく落とす)', () => {
			expect(() =>
				resolveBackupBackend({ envDataSource: 'pglite', health: health('sqlite') }),
			).toThrow(/backend が食い違っています/);
		});

		it('typo した env は一致しないので fail する', () => {
			expect(() =>
				resolveBackupBackend({ envDataSource: 'pglte', health: health('pglite') }),
			).toThrow(/backend が食い違っています/);
		});

		it('メッセージに双方の値が載る (どちらが正かを人が判断できる)', () => {
			try {
				resolveBackupBackend({
					envDataSource: 'sqlite',
					health: health('pglite'),
					healthUrl: 'http://app:3000/api/health',
				});
				throw new Error('should have thrown');
			} catch (e) {
				const msg = (e as Error).message;
				expect(msg).toContain('DATA_SOURCE=sqlite');
				expect(msg).toContain('dataSource=pglite');
				expect(msg).toContain('http://app:3000/api/health');
			}
		});
	});

	describe('AC4: 一致する正常系は従来どおり動き、突合結果が残る', () => {
		it('env=pglite / health=pglite → pglite 経路 + 一致した旨を残す', () => {
			const r = resolveBackupBackend({ envDataSource: 'pglite', health: health('pglite') });
			expect(r.backend).toBe('pglite');
			expect(r.source).toBe('health+env');
			expect(r.detail).toContain('一致');
		});

		it('env=sqlite / health=sqlite → sqlite 経路', () => {
			expect(
				resolveBackupBackend({ envDataSource: 'sqlite', health: health('sqlite') }).backend,
			).toBe('sqlite');
		});

		it('前後の空白は無視して一致とみなす (docker env の末尾空白で落ちない)', () => {
			expect(
				resolveBackupBackend({ envDataSource: ' pglite ', health: health('pglite') }).source,
			).toBe('health+env');
		});
	});

	describe('health レスポンスが期待の形でない場合は fail closed', () => {
		// 「規約に従うデータ」だけを並べた fixture は、規約違反を検出できないことを検出できない。
		// 実際に起きうる壊れ方 (500 の HTML が JSON.parse された / field 名変更 / null) を混ぜる。
		it.each([
			['dataSource 欠落', { status: 'ok' }],
			['dataSource が null', health(null)],
			['dataSource が空文字', health('')],
			['dataSource が数値', health(42)],
			['body が配列', []],
			['body が文字列', 'ok'],
		])('%s → fail する', (_label, body) => {
			expect(() => resolveBackupBackend({ envDataSource: 'pglite', health: body })).toThrow(
				BackendResolutionError,
			);
		});

		it('503 (DB 到達不可) でも dataSource があれば backend は同定できる', () => {
			// backend の同定と DB の生死は別問題。ここで弾くと、DB 障害中に
			// 「backend が分からない」という誤った理由で落ちることになる。
			const r = resolveBackupBackend({
				envDataSource: 'pglite',
				health: { status: 'error', error: 'db_unreachable', dataSource: 'pglite' },
			});
			expect(r.backend).toBe('pglite');
		});
	});
});
