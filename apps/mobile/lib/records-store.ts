import * as SecureStore from 'expo-secure-store';

import type { RecordStore } from '@entole/core/records';

/** Where the person's own records (who they pay, their allowances, what they've
 * sent) live on the phone. The keychain-backed store is used because it already
 * ships in the app; `chunkedStore` in core keeps each value small enough for it.
 * Keys are `entole.records.<account>.<collection>.<n>` — letters, digits, dots. */
export const deviceRecordStore: RecordStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
};
