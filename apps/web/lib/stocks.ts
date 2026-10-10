import { createStockMarketClient } from '@entole/core/stock-market';

/**
 * Where the stock screens read from: this app's own `/api/stocks` routes,
 * which read the issuer and the exchange live. There is no list and no price
 * anywhere in the app itself.
 */
export const stockMarket = createStockMarketClient({ baseUrl: '' });
