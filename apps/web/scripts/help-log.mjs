// Prints what the help bot could not answer, and the answers people marked as
// unhelpful: the questions to write a new article for. Reads the same Redis
// the app writes to (UPSTASH_REDIS_REST_URL / _TOKEN), so run it with those set.
//
//   pnpm --filter @entole/web help-log          # what is worth an article
//   pnpm --filter @entole/web help-log --all    # everything kept
import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) {
  console.error('Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN first.');
  process.exit(1);
}

const redis = new Redis({ url, token });
const all = process.argv.includes('--all');
const ids = await redis.lrange('help:log', 0, 999);
const entries = [];
for (const id of ids) {
  const raw = await redis.get(`help:q:${id}`);
  if (!raw) continue;
  entries.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
}

const wanted = all ? entries : entries.filter((entry) => entry.by === 'none' || entry.helpful === false);
console.log(`${wanted.length} of ${entries.length} kept questions${all ? '' : ' need an answer or a better one'}:\n`);
for (const entry of wanted) {
  const mark = entry.by === 'none' ? 'NOT COVERED' : entry.helpful === false ? 'UNHELPFUL' : entry.helpful === true ? 'helpful' : '';
  console.log(`${entry.at.slice(0, 10)}  ${mark.padEnd(11)}  ${entry.question}  [${entry.articles.join(', ') || '-'}]`);
}
