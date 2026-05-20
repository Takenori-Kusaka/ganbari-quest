// #2320 (EPIC #2319 ①): /admin/settings hub page。
// 既存メガファイル 2059 行 (15 sections) を 6 child routes に分割し、本ファイルは
// hub page (6 グループへのナビ集約) のみを担当する。
//
// 既存の action / load はすべて child routes へ移行済 (#2321 account / #2322 activities
// / #2323 data / #2324 support、notifications は #2320 で同梱)。

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// hub page は data load 不要 (各 child route が独自に load する)
	return {};
};
