// src/lib/server/db/interfaces/storage.interface.ts
// ファイルストレージのインターフェース定義

export interface FileData {
	data: Buffer;
	contentType: string;
}

/**
 * getDownloadUrl の戻り値 (async-backup-export.md §3.4)。
 * - `redirect`: 一時 presigned URL へ 302 redirect できる (S3/AWS)。Lambda body 6MB / 30 秒制約を迂回する。
 * - `proxy`: 一時 URL を発行できない runtime (NUC ローカル FS)。呼び出し側 (DL route) が
 *   `readFile` から認証済で stream する。
 */
export type StorageDownloadUrl = { kind: 'redirect'; url: string } | { kind: 'proxy' };

export interface IStorageRepo {
	saveFile(key: string, data: Buffer, contentType: string): Promise<void>;
	readFile(key: string): Promise<FileData | null>;
	fileExists(key: string): Promise<boolean>;
	deleteFile(key: string): Promise<void>;
	listFiles(prefix: string): Promise<string[]>;
	/**
	 * プレフィックスに一致する全ファイルを一括削除し、削除件数を返す。
	 *
	 * **バージョニング有効なバックエンド (S3、#4724) では「現行バージョンを消す」= delete marker を
	 * 立てるだけ**で、非現行バージョンは lifecycle (30 日) まで残る。誤操作から戻せるのはこの性質の
	 * おかげであり、子供の削除などはこちらを使う。
	 *
	 * **「戻せてはいけない」削除には使わない** — 退会 (完全削除) は `purgeByPrefix` を使う。
	 */
	deleteByPrefix(prefix: string): Promise<number>;
	/**
	 * プレフィックスに一致するオブジェクトを **全バージョン + delete marker まで物理削除**し、件数を返す。
	 *
	 * 退会 (アカウント完全削除) 専用 (#4724)。バージョニングを有効にしたことで `deleteByPrefix` が
	 * 「30 日は戻せる削除」になったため、**法務文書が約束する「猶予期間後に完全削除」を満たすには
	 * バージョンごと消す経路が要る**。バージョニングを持たない backend では `deleteByPrefix` と同義。
	 *
	 * 戻り値は削除したバージョン数 (delete marker を含む) で、オブジェクト数とは一致しない。
	 *
	 * **既定は tolerant** (#4767 QM must): S3 の batch delete は個々のキーの失敗を例外にせず
	 * 応答本文の `Errors[]` に並べる。既定ではそれを **error ログに出したうえで処理を続け**、
	 * 成功した分だけを件数に数える。退会 (`account-deletion-service`) はこの呼び出しを
	 * try/catch で包んでおらず、直前に「削除記録の書き込み」と「サブスク解約」を済ませているため、
	 * ここで throw すると**不可逆な退会フローが途中で壊れる**。
	 *
	 * `failOnPartialError: true` を渡した呼び出しだけが fail-closed になる。1 件でも消えていなければ
	 * throw するので、呼び出し側は「実体が残ったまま DB 行を消す」を避けられる
	 * (クラウド共有の削除 = `cloud-export-service.deleteCloudExport` がこれを使う)。
	 */
	purgeByPrefix(prefix: string, opts?: { failOnPartialError?: boolean }): Promise<number>;
	/**
	 * key に対する一時ダウンロード経路を返す (async-backup-export.md §3.4、CWE-598)。
	 * - AWS (S3): `getSignedUrl(GetObjectCommand)` で対象 key 限定・短命 TTL の presigned URL を発行し
	 *   `{ kind: 'redirect', url }` を返す。
	 * - NUC (ローカル FS): presigned 不在のため `{ kind: 'proxy' }` を返し、呼び出し側が readFile で stream する。
	 * @param opts.expiresIn presigned URL の有効秒数 (60〜300 秒程度、redirect 経路のみ有効)。
	 */
	getDownloadUrl(key: string, opts: { expiresIn: number }): Promise<StorageDownloadUrl>;
}
