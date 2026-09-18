/**
 * Everything both the phone app and the web app share: money as integer minor
 * units, the Zod boundary schemas, allowance arithmetic, the payments gateway
 * and the store that sits over it.
 *
 * Nothing here may import from `react-native`, `expo-*` or `next`. If a module
 * needs a platform, it belongs in that platform's app, not in this package.
 */
export * from './address-book';
export * from './allowance';
export * from './amount-entry';
export * from './aurora-intents';
export * from './chainlink-cre';
export * from './fixtures';
export * from './format';
export * from './fx';
export * from './gateway';
export * from './indexed-activity';
export * from './money';
export * from './onchain-gateway';
export * from './passkey';
export * from './schemas';
export * from './settlement-asset';
export * from './store';
export * from './telegram-intake';
