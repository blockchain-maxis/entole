import { z } from 'zod';

import { askForJson, type ChatMessage, type LanguageModelConfig } from './language-model';

/**
 * The help center: the questions people ask, the answers, and the support
 * bot that is grounded in them.
 *
 * The articles below are the one source for both the list a person reads and
 * what the bot is allowed to say. The bot is not trained on anything. For each
 * question it is handed the few articles that fit best and told to answer from
 * those and nothing else; a question none of them covers is answered with
 * "I'm not sure" and a way to reach a person, and is kept (words only, no
 * account) so it can be read later and turned into a new article. That log is
 * how the help gets better: someone adds the answer here.
 *
 * Words the product never says to a person are not used in any answer, and the
 * bot's reply is dropped if it uses one.
 */

export type HelpCategory = 'start' | 'money' | 'assistant' | 'safety' | 'more';

export const HELP_CATEGORIES: { id: HelpCategory; title: string }[] = [
  { id: 'start', title: 'Getting started' },
  { id: 'money', title: 'Sending, receiving and adding money' },
  { id: 'assistant', title: 'The assistant and allowances' },
  { id: 'safety', title: 'Safety and your account' },
  { id: 'more', title: 'Savings, business and bills' },
];

export type HelpArticle = {
  id: string;
  category: HelpCategory;
  question: string;
  answer: string;
  /** Words people use for this that the question does not contain. */
  keywords: string[];
};

export const HELP_ARTICLES: readonly HelpArticle[] = [
  {
    id: 'what-is-entole',
    category: 'start',
    question: 'What is Entole?',
    answer:
      'Entole is a money app for sending, receiving and sharing spending. It also has an assistant that can pay on your behalf, but only inside limits you set, called allowances. The limit is held by the network, so the assistant cannot go past it, whatever it is told.',
    keywords: ['about', 'app', 'what', 'does', 'for'],
  },
  {
    id: 'test-money',
    category: 'start',
    question: 'Is the money in the app real?',
    answer:
      'Not yet. Entole is in testing, so the balances you see are test money with no value, and it is added from Add money. It lets you try everything, including sending and allowances, without risking anything.',
    keywords: ['real', 'fake', 'test', 'demo', 'testnet', 'value', 'live'],
  },
  {
    id: 'sign-in',
    category: 'start',
    question: 'How do I sign in? Is there a password?',
    answer:
      'There is no password. You confirm it is you with your fingerprint, your face or your phone’s screen lock, through a passkey on your device. The app locks itself after 30 minutes and asks again.',
    keywords: ['login', 'password', 'pin', 'unlock', 'passkey', 'biometric', 'fingerprint', 'face'],
  },
  {
    id: 'new-device',
    category: 'start',
    question: 'How do I use my account on another phone or on the web?',
    answer:
      'Open Entole on the other device and choose “I already have an account”. It asks for the passkey your account was made with. That works when your Google or Apple account carries your passkeys to that device, or when you choose the other device if it asks. It asks for your name again; your saved people, allowances and payments follow your account.',
    keywords: ['new phone', 'second device', 'computer', 'browser', 'website', 'laptop', 'switch', 'transfer', 'sync', 'already have'],
  },
  {
    id: 'lost-phone',
    category: 'safety',
    question: 'I lost my phone. Is my money gone?',
    answer:
      'No. Your money belongs to your passkey, not to the phone. Sign in on a new phone with the same Google or Apple account that carried your passkey and choose “I already have an account”. Entole holds no copy of your passkey and cannot reset it, so if you can no longer reach it, nobody can open the account for you.',
    keywords: ['stolen', 'broken', 'lost', 'recover', 'recovery', 'restore', 'forgot', 'locked out', 'reset'],
  },
  {
    id: 'send-money',
    category: 'money',
    question: 'How do I send money?',
    answer:
      'Tap Send, choose someone you have saved or type their username or phone number, enter the amount on the keypad and review it. You then confirm with your fingerprint, face or screen lock. When it has gone through you get a receipt.',
    keywords: ['pay', 'transfer', 'send', 'someone', 'friend', 'family'],
  },
  {
    id: 'who-can-i-pay',
    category: 'money',
    question: 'Who can I send money to?',
    answer:
      'Anyone with an Entole username or an Entole phone number. You can save people under Beneficiaries to pay them in a few taps. Sending to a bank account is not open yet.',
    keywords: ['recipient', 'bank account', 'contact', 'beneficiary', 'beneficiaries', 'save', 'username', 'number'],
  },
  {
    id: 'get-paid',
    category: 'money',
    question: 'How do I get paid?',
    answer:
      'Open Receive. It shows your username link and a scan code. Share the link, or let the other person scan the code, and you can ask for a set amount. Money shows in your activity as soon as it arrives, and the app tells you while it is open.',
    keywords: ['receive', 'request', 'link', 'qr', 'scan', 'invoice', 'collect', 'username'],
  },
  {
    id: 'fees',
    category: 'money',
    question: 'What does it cost to send money?',
    answer:
      'There is a small fee, and you see it before you confirm, never after. What the other person receives is shown on the same screen. The fee is the same whether you send it yourself or the assistant does it inside an allowance.',
    keywords: ['fee', 'charge', 'price', 'cost', 'free', 'cheap', 'how much'],
  },
  {
    id: 'cancel-payment',
    category: 'money',
    question: 'Can I take back a payment?',
    answer:
      'A payment you confirm yourself goes through in about a second and cannot be taken back, so check the person and the amount on the review screen. A payment the assistant makes inside an allowance waits out a short countdown first, and you can stop it with one tap before it goes.',
    keywords: ['cancel', 'undo', 'reverse', 'refund', 'stop', 'wrong person', 'mistake', 'wrong amount', 'sent by mistake'],
  },
  {
    id: 'add-money',
    category: 'money',
    question: 'How do I add money?',
    answer:
      'Open Add money. You can bring money in from another app by scanning a code, and you pick what you are sending first. You can also add by card, from $20, or from USDT on Tron and USDC on Solana. Bank transfer in naira is coming soon. While Entole is in testing you can add test money there too.',
    keywords: ['top up', 'fund', 'deposit', 'card', 'bank transfer', 'naira', 'load', 'put money'],
  },
  {
    id: 'cash-out',
    category: 'money',
    question: 'Can I withdraw to my bank account?',
    answer:
      'Not yet. You can keep bank details on a beneficiary for later, but nothing sends money to a bank account until that is switched on. For now you can pay anyone who has Entole.',
    keywords: ['withdraw', 'cash out', 'bank', 'naira', 'transfer to bank', 'off-ramp', 'payout'],
  },
  {
    id: 'history',
    category: 'money',
    question: 'Where can I see my payments?',
    answer:
      'Home shows your latest payments, and Activity lists all of them. Tap one to see its receipt, which you can share as a picture. Anything the assistant did is marked in blue so you can tell it apart from what you did yourself.',
    keywords: ['history', 'receipt', 'statement', 'transactions', 'activity', 'record', 'proof'],
  },
  {
    id: 'assistant-what',
    category: 'assistant',
    question: 'What can the assistant do?',
    answer:
      'Talk to it like a person. Ask for your balance and it takes you to Home and tells you. Say you want to send money and it opens Send, or name a person and an amount and it fills them in. It can also open screens and show how to get paid. It cannot confirm anything: you do that yourself, with your fingerprint or face. Turn it on in the Assistant settings.',
    keywords: ['ayo', 'ai', 'voice', 'bot', 'talk', 'speak', 'microphone', 'hey ayo', 'navigate'],
  },
  {
    id: 'allowance',
    category: 'assistant',
    question: 'What is an allowance?',
    answer:
      'An allowance is a rule written as a sentence, such as “Send ₦50,000 to Mum every month, never more than ₦100,000 a month.” It lets the assistant pay that person for you, and no more than the limit. The limit is held by the network, not the app, and what is left is always on screen. When it is used up, the assistant stops.',
    keywords: ['limit', 'rule', 'budget', 'recurring', 'monthly', 'weekly', 'standing order', 'automatic', 'schedule'],
  },
  {
    id: 'pause',
    category: 'assistant',
    question: 'How do I stop the assistant?',
    answer:
      'Tap the Assistant control at the top of any screen. One tap pauses it right away, and your allowances stay as they are. You can resume it from the same place. You can also turn off talking to it, or its paying, in the Assistant settings.',
    keywords: ['pause', 'off', 'disable', 'turn off', 'kill switch', 'halt', 'emergency'],
  },
  {
    id: 'talk-to-ayo',
    category: 'assistant',
    question: 'How do I talk to Ayo?',
    answer:
      'Turn on “Talks with you” in the Assistant settings, then tap the microphone at the top of any screen and speak. If you want, turn on “Say Hey Ayo” and it will answer when it hears its name while the app is open. Hold the microphone to type instead. It needs microphone permission.',
    keywords: ['hey ayo', 'wake', 'voice', 'speak', 'microphone', 'mic', 'accent', 'listen'],
  },
  {
    id: 'is-it-safe',
    category: 'safety',
    question: 'Is my money safe?',
    answer:
      'Entole does not hold your money or a copy of your passkey. Every payment you make needs your fingerprint, face or screen lock. The assistant can only spend inside the allowances you write, and the limit cannot be passed even by Entole. Savings are the exception to “nothing between you and your money”: they sit with the lender, and the Savings screen says so.',
    keywords: ['secure', 'security', 'safe', 'hack', 'protect', 'trust', 'steal', 'scam', 'fraud'],
  },
  {
    id: 'privacy',
    category: 'safety',
    question: 'Does Entole see my fingerprint or hear my voice?',
    answer:
      'No. Your phone checks your fingerprint or face itself and only tells Entole that it matched. For voice, your phone’s speech service turns what you say into words and Entole receives the words, never the sound, and keeps no recording.',
    keywords: ['privacy', 'data', 'recording', 'listening', 'microphone', 'biometric', 'track', 'spy'],
  },
  {
    id: 'savings',
    category: 'more',
    question: 'How do savings work?',
    answer:
      'Under Grow, Savings, you can put money aside and take it out again. With real money, savings are lent out and earn what borrowers pay; the rate is shown on the screen and it changes. While Entole is in testing nothing earns. If nearly all of the lender’s money is out on loan, taking savings out can be delayed, and the app tells you before you start.',
    keywords: ['grow', 'interest', 'earn', 'yield', 'save', 'invest', 'rate', 'return'],
  },
  {
    id: 'stocks',
    category: 'more',
    question: 'Can I buy stocks?',
    answer:
      'You can look at stocks, with live prices, under Grow. Buying is not open yet, so the Buy button is switched off.',
    keywords: ['shares', 'invest', 'investing', 'market', 'buy', 'equity', 'grow'],
  },
  {
    id: 'business',
    category: 'more',
    question: 'What is Business for?',
    answer:
      'Business is for getting paid and paying people for a business. You can send an invoice with a link, see which are paid, set aside tax from what you are paid, and pay staff from a list you import.',
    keywords: ['invoice', 'payroll', 'staff', 'salary', 'tax', 'customer', 'csv', 'company'],
  },
  {
    id: 'bills',
    category: 'more',
    question: 'Can I pay bills?',
    answer:
      'Pay a bill covers electricity, airtime and data, cable TV and internet. You enter the meter, card or phone number, check the name shown, and confirm. If it says bills are not available, they have not been switched on for your account yet.',
    keywords: ['electricity', 'light', 'nepa', 'airtime', 'data', 'dstv', 'gotv', 'cable', 'internet', 'recharge', 'utility'],
  },
  {
    id: 'contact',
    category: 'more',
    question: 'How do I reach a person?',
    answer:
      'Use Send feedback in Me, or email support@entole.pro. Say what you were doing and what you saw. Never send anyone your passkey or a screen showing your balance; nobody from Entole will ask for them.',
    keywords: ['support', 'contact', 'email', 'complain', 'human', 'agent', 'help', 'problem', 'report', 'bug'],
  },
];

/** The article with this id, or `undefined`. */
export function helpArticle(id: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.id === id);
}

// ---------------------------------------------------------------------------
// Finding the articles that fit a question.
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set(
  (
    'a an the is are was were am be been do does did can could would should will my me i you your we our it its to of in on at for ' +
    'and or but with from by how what why when where which who whom this that these those there here if so as not no yes any some ' +
    'get got want need please tell about into out up down over than then too very just also have has had'
  ).split(' '),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s$₦]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

/** A crude stem, enough that "payments" finds "payment" and "sending" finds "send". */
function stem(word: string): string {
  return word.replace(/(ing|ed|es|s)$/, '');
}

export type Ranked = { article: HelpArticle; score: number };

/**
 * The articles that best fit a question, best first. Scored on the words in
 * the question and keywords (weighted most) and in the answer; articles with no
 * word in common are left out.
 */
export function rankArticles(question: string, count = 4): Ranked[] {
  const asked = [...new Set(words(question).map(stem))];
  if (asked.length === 0) return [];
  const phrase = question.toLowerCase();

  const ranked = HELP_ARTICLES.map((article): Ranked => {
    const title = new Set(words(article.question).map(stem));
    const keys = new Set(article.keywords.flatMap((keyword) => words(keyword).map(stem)));
    const body = new Set(words(article.answer).map(stem));
    let score = 0;
    for (const word of asked) {
      if (title.has(word)) score += 3;
      if (keys.has(word)) score += 3;
      if (body.has(word)) score += 1;
    }
    // A keyword that is a phrase ("hey ayo", "wrong person") counts when the whole phrase was said.
    for (const keyword of article.keywords) if (keyword.includes(' ') && phrase.includes(keyword)) score += 5;
    return { article, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, count);
}

// ---------------------------------------------------------------------------
// The bot.
// ---------------------------------------------------------------------------

export const HELP_QUESTION_MAX = 300;
export const HELP_HISTORY_MAX = 6;

export const helpHistorySchema = z
  .array(z.object({ from: z.enum(['you', 'bot']), text: z.string().trim().min(1).max(600) }))
  .max(HELP_HISTORY_MAX);

export type HelpHistory = z.infer<typeof helpHistorySchema>;

export const helpAnswerSchema = z.object({
  /** Kept in the log so a thumbs-up or thumbs-down can be matched to it. */
  id: z.string().min(1).max(40),
  answer: z.string().trim().min(1).max(900),
  /** Articles the answer came from, to offer as "read more". */
  articles: z.array(z.string()).max(4),
  /** Where it came from: the model, the best matching article, or nothing that fit. */
  by: z.enum(['model', 'article', 'none']),
});

export type HelpAnswer = z.infer<typeof helpAnswerSchema>;

/** What the bot says when nothing in the help covers the question. */
export const NOT_COVERED =
  'I’m not sure about that one. You can send us feedback from Me, or email support@entole.pro, and a person will answer.';

const NEVER_SAID = /\b(wallet|crypto\w*|blockchain|on-?chain|chain|gas|token|seed phrase|recovery phrase|private key|transaction hash|signature)\b/i;

export const HELP_SYSTEM_PROMPT = [
  'You are the help assistant inside Entole, a money app used in Nigeria. You answer questions about how the app works.',
  'You are given a few help articles. Answer ONLY from them. If they do not answer the question, say you are not sure and that the person can send feedback from Me or email support@entole.pro. Never guess, and never invent a feature, a number, a fee, a date or a screen that is not in the articles.',
  'You do not see the person’s account. You cannot move money, change settings or look anything up. If they ask for their balance or a payment, tell them where in the app to find it.',
  '',
  'Reply with ONLY a JSON object: {"answer": string, "articles": [ids]}.',
  '"answer" is plain, warm and short: at most 60 words, no lists, no markdown, no emoji. Say it the way a helpful friend would. People may write Nigerian English or Pidgin; understand it and answer in easy English.',
  '"articles" lists the ids of the articles you used, most useful first, at most 3.',
  'Never use these words: wallet, crypto, blockchain, chain, gas, token, signature. Say payment, account, fee, receipt.',
  'Never ask for, or tell anyone to share, a password, a passkey, a code or their screen.',
].join('\n');

function articleBlock(articles: readonly HelpArticle[]): string {
  return articles.map((article) => `[${article.id}] ${article.question}\n${article.answer}`).join('\n\n');
}

export type HelpResult = { answer: string; articles: string[]; by: 'model' | 'article' | 'none' };

/**
 * Answers a question from the help. With a model, it is asked to answer from
 * the best-fitting articles. Without one (no key, or it failed), the best
 * article answers for itself when it fits well enough, and otherwise the
 * question is "not covered". Never says anything outside the help.
 */
export async function answerHelpQuestion(
  question: string,
  config: LanguageModelConfig | null,
  history: HelpHistory = [],
): Promise<HelpResult> {
  const asked = question.replace(/\s+/g, ' ').trim().slice(0, HELP_QUESTION_MAX);
  const ranked = rankArticles(asked, 4);
  // A follow-up ("and on the web?") has few words of its own: search with the last question too.
  const lastQuestion = [...history].reverse().find((turn) => turn.from === 'you')?.text;
  const candidates = ranked.length >= 2 || !lastQuestion ? ranked : rankArticles(`${lastQuestion} ${asked}`, 4);

  if (config) {
    const given = candidates.length > 0 ? candidates.map((entry) => entry.article) : HELP_ARTICLES.slice(0, 3);
    const messages: ChatMessage[] = [
      { role: 'system', content: HELP_SYSTEM_PROMPT },
      { role: 'system', content: `Help articles:\n\n${articleBlock(given)}` },
      ...history.map((turn) => ({
        role: turn.from === 'you' ? ('user' as const) : ('assistant' as const),
        content: turn.text,
      })),
      { role: 'user', content: asked },
    ];
    const parsed = z
      .object({ answer: z.string().trim().min(1).max(900), articles: z.array(z.string()).max(6).default([]) })
      .safeParse(await askForJson(messages, config, 400));
    if (parsed.success && !NEVER_SAID.test(parsed.data.answer)) {
      const used = parsed.data.articles.filter((id) => helpArticle(id)).slice(0, 3);
      const notCovered = used.length === 0 && (candidates[0]?.score ?? 0) < 6;
      return { answer: parsed.data.answer.replace(/\s+/g, ' '), articles: used, by: notCovered ? 'none' : 'model' };
    }
  }

  const best = candidates[0];
  // Strong enough that the article itself is a fair answer: its question matched, not one stray word.
  if (best && best.score >= 6) return { answer: best.article.answer, articles: [best.article.id], by: 'article' };
  return { answer: NOT_COVERED, articles: [], by: 'none' };
}

// ---------------------------------------------------------------------------
// What is kept, so the help can improve.
// ---------------------------------------------------------------------------

/** A question as kept in the log: the words, never who asked. Numbers and addresses that look personal are removed. */
export function redactQuestion(question: string): string {
  return question
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/0x[0-9a-fA-F]{8,}/g, '[address]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/@[a-z0-9_.]{3,}/gi, '[username]')
    .replace(/\+?\d[\d\s-]{6,}\d/g, '[number]')
    .slice(0, HELP_QUESTION_MAX);
}

export const helpLogSchema = z.object({
  id: z.string(),
  at: z.string(),
  question: z.string(),
  by: z.enum(['model', 'article', 'none']),
  articles: z.array(z.string()),
  helpful: z.boolean().nullable(),
});

export type HelpLogEntry = z.infer<typeof helpLogSchema>;
