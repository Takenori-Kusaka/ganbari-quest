// このファイルは非推奨。ルートの playwright.production.config.ts を使用してください。
// npx playwright test --config playwright.production.config.ts
// biome-ignore lint/performance/noBarrelFile: 後方互換 re-export のため維持、削除は別 Issue で検討
export { default } from '../../playwright.production.config';
