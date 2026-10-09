// Registers this app's Telegram webhook, with the secret the route checks.
//
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
//     pnpm --filter @entole/web telegram:webhook https://your-domain.example
//
// Reads the same variables as the route, from the environment or `.env.local`.
// Run it again whenever the domain or the secret changes. `--delete` removes
// the webhook. Nothing here prints the bot's credentials.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(name) {
  try {
    for (const line of readFileSync(join(root, name), 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // No such file: the environment alone is fine.
  }
}
loadEnvFile('.env.local');

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const args = process.argv.slice(2);
const remove = args.includes('--delete');
const base = args.find((arg) => !arg.startsWith('--'));

if (!token) fail('TELEGRAM_BOT_TOKEN is not set.');
if (!remove && !secret) fail('TELEGRAM_WEBHOOK_SECRET is not set. Use a long random string.');
if (!remove && !base) fail('Pass the public https URL of the web app, e.g. https://entole.example');
if (!remove && !/^https:\/\//.test(base)) fail('Telegram only delivers to https URLs.');

const method = remove ? 'deleteWebhook' : 'setWebhook';
const body = remove
  ? {}
  : {
      url: `${base.replace(/\/$/, '')}/api/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ['message'],
    };

const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const result = await response.json().catch(() => ({}));
if (!response.ok || !result.ok) fail(`Telegram refused: ${result.description ?? response.status}`);
console.log(remove ? 'Webhook removed.' : `Webhook set to ${body.url}`);

function fail(message) {
  console.error(message);
  process.exit(1);
}
