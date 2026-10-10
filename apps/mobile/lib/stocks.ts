import { createStockMarketClient } from '@entole/core/stock-market';

import { API_BASE } from '@/lib/onchain';

/**
 * Where the stock screens read from: the server's `/api/stocks` routes, which
 * read the issuer and the exchange live. There is no list and no price
 * anywhere in the app itself.
 */
export const stockMarket = createStockMarketClient({ baseUrl: API_BASE });
