/**
 * Marketplace module entry point — ADR-0052 (Issue #2363)
 *
 * このファイルは Strategy + Registry パターンの side-effect eager-load を
 * 統合する SSOT。後続 Issue #2365-2369 で concrete strategy を実装する際、
 *
 *   import './types/activity-pack';   // #2365
 *   import './types/reward-set';      // #2366
 *   import './types/checklist';       // #2367
 *   import './types/rule-preset';     // #2368
 *   import './types/challenge-set';   // #2369
 *
 * の形で 1 行ずつ追加する。各 type module の top-level で
 * `marketplaceRegistry.register(descriptor)` を呼び出すことで、
 * 本ファイルを 1 度 import するだけで 5 type 全てが登録される
 * (VSCode `contributes` / Obsidian Plugin 同型)。
 *
 * 本 PR (Issue #2363) は interface 基盤のみ。concrete strategy は #2365-2369 で実装。
 *
 * Barrel file 抑制理由: side-effect eager-load パターンの SSOT として
 * `marketplace/types/*.ts` を 1 箇所で集約する設計が ADR-0052 §2.4 で確定済。
 * `noBarrelFile` warning を意図的に抑制する。
 */

// biome-ignore lint/performance/noBarrelFile: ADR-0052 で意図的に barrel (eager-load SSOT)
export {
	getMarketplaceRegistry,
	hasMarketplaceRegistry,
	setMarketplaceRegistryContext,
} from './context.js';
export type { DispatchImportInput, DispatchImportResult } from './dispatcher.js';
export { dispatchImport } from './dispatcher.js';
export { MarketplaceTypeRegistry, marketplaceRegistry } from './registry.js';
// 公開 API: 型 / Registry / Context DI / Dispatcher
export type {
	AnyMarketplaceTypeDescriptor,
	ImportContext,
	ImportPreview,
	ImportResult,
	ImportStrategy,
	MarketplaceTypeCode,
	MarketplaceTypeDescriptor,
} from './types.js';
export { MARKETPLACE_TYPE_CODES } from './types.js';

// type 登録 (eager-load) — module 評価時に Registry へ side-effect register される。
// 順序は仕様上の依存ではなく可読性のため alphabetical 推奨。
import './types/activity-pack.js'; // #2365
import './types/checklist.js'; // #2367
import './types/reward-set.js'; // #2366
import './types/rule-preset.js'; // #2368
// 後続 Issue #2369 で各 type の side-effect import をここに追加する。
//   import './types/challenge-set';   // #2369
