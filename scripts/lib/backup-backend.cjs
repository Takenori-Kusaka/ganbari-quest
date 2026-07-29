// scripts/lib/backup-backend.cjs
// #3967 — 「どの backend をバックアップするか」の判定 SSOT (pure function)。
//
// ## なぜ env 単独で決めないか
//
// 旧実装は `process.env.DATA_SOURCE || 'sqlite'` だった。この形は
// **未設定・typo・env 配布漏れのいずれでも黙って `'sqlite'` に落ちる**。
//
// 現状は SQLite 経路が必ず fail するため沈黙はしないが、依存しているのは
// 「SQLite 経路がたまたま失敗すること」であって設計上の保証ではない。将来 SQLite 経路が
// 動く構成が復活すると、**間違った backend のバックアップを取って成功と報告する**状態になる。
// #3950 の事故 (PGlite 移行後も旧 SQLite を複製し続けた) と同じ形である。
//
// ## 真実の源はアプリ自身
//
// 「env に何が書いてあるか」ではなく「**アプリが実際にどの backend を使っているか**」を
// 真実とする。`/api/health` は `dataSource` を返すので、これを一次情報にする。
// env は照合用にのみ使い、食い違ったら実行前に落とす (config drift の検出)。
//
// 判定を fetch から切り離してあるのは、組み合わせを unit test で固定できるようにするため。

/** 判定できないときに投げる。呼び出し側はこれを alert 対象として扱う。 */
class BackendResolutionError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'BackendResolutionError';
	}
}

/**
 * `/api/health` のレスポンス body と env から、バックアップ対象 backend を決める。
 *
 * @param {object} params
 * @param {string | undefined} params.envDataSource `process.env.DATA_SOURCE` の値 (未設定なら undefined)
 * @param {unknown} params.health `/api/health` の JSON (取得できなかった場合は null を渡す)
 * @param {string} [params.healthUrl] エラーメッセージに載せる URL
 * @returns {{backend: string, source: 'health' | 'health+env', detail: string}}
 * @throws {BackendResolutionError} backend を特定できない / env と実態が食い違う
 */
function resolveBackupBackend({ envDataSource, health, healthUrl = '/api/health' }) {
	const env = typeof envDataSource === 'string' ? envDataSource.trim() : '';

	if (health === null || typeof health !== 'object') {
		// **env へフォールバックしない。** ここで env に逃げると、health が落ちている間だけ
		// 判定根拠が env に戻り、本 Issue が塞ごうとしている経路が復活する。
		throw new BackendResolutionError(
			`backend を特定できません: ${healthUrl} から dataSource を取得できませんでした` +
				`${env ? ` (env DATA_SOURCE=${env} は照合用であり単独では採用しません)` : ''}`,
		);
	}

	const actual = /** @type {{dataSource?: unknown}} */ (health).dataSource;
	if (typeof actual !== 'string' || actual.trim() === '') {
		throw new BackendResolutionError(
			`backend を特定できません: ${healthUrl} のレスポンスに dataSource がありません ` +
				`(received: ${JSON.stringify(actual)})`,
		);
	}
	const backend = actual.trim();

	if (env === '') {
		// env 未設定でも health が答えられるなら続行してよい。ただし
		// 「env が配られていない」ことは運用上の異常なので detail に残す。
		return {
			backend,
			source: 'health',
			detail: `DATA_SOURCE 未設定のため ${healthUrl} の dataSource=${backend} を採用`,
		};
	}

	if (env !== backend) {
		throw new BackendResolutionError(
			`backend が食い違っています: env DATA_SOURCE=${env} / ${healthUrl} dataSource=${backend}。` +
				'env の配布漏れか、アプリと backup コンテナが別の設定で動いています。' +
				'どちらが正かを確認するまでバックアップを実行しません',
		);
	}

	return {
		backend,
		source: 'health+env',
		detail: `DATA_SOURCE=${env} と ${healthUrl} dataSource=${backend} が一致`,
	};
}

module.exports = { resolveBackupBackend, BackendResolutionError };
