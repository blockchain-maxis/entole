import { describe, expect, it, vi } from 'vitest';

import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  NOT_COVERED,
  answerHelpQuestion,
  helpArticle,
  rankArticles,
  redactQuestion,
} from './help';

const NEVER = /\b(wallet|crypto\w*|blockchain|on-?chain|chain|gas|token|seed phrase|recovery phrase|private key|transaction hash|signature)\b/i;

function modelSaying(content: unknown): { apiKey: string; fetch: typeof fetch } {
  return {
    apiKey: 'test',
    fetch: vi.fn(async () =>
      Response.json({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }),
    ) as unknown as typeof fetch,
  };
}

describe('the articles', () => {
  it('have unique ids, a real category, and both a question and an answer', () => {
    expect(new Set(HELP_ARTICLES.map((article) => article.id)).size).toBe(HELP_ARTICLES.length);
    const categories = new Set(HELP_CATEGORIES.map((category) => category.id));
    for (const article of HELP_ARTICLES) {
      expect(categories.has(article.category)).toBe(true);
      expect(article.question.endsWith('?')).toBe(true);
      expect(article.answer.length).toBeGreaterThan(40);
    }
    for (const category of HELP_CATEGORIES) {
      expect(HELP_ARTICLES.some((article) => article.category === category.id)).toBe(true);
    }
  });

  it('never use a word the product never says to a person', () => {
    for (const article of HELP_ARTICLES) {
      expect(`${article.question} ${article.answer}`).not.toMatch(NEVER);
    }
  });

  it('never show an address or ask for a passkey', () => {
    for (const article of HELP_ARTICLES) {
      expect(article.answer).not.toMatch(/0x[0-9a-fA-F]{6,}/);
      expect(article.answer).not.toMatch(/(please|you can|just|then) send (us|me) your (passkey|password|code)/i);
    }
  });

  it('cover what people most often ask', () => {
    for (const id of ['send-money', 'add-money', 'fees', 'lost-phone', 'allowance', 'pause', 'is-it-safe', 'new-device', 'cash-out']) {
      expect(helpArticle(id)).toBeDefined();
    }
  });
});

describe('finding the article that fits', () => {
  it.each([
    ['how do I send money', 'send-money'],
    ['I lost my phone', 'lost-phone'],
    ['what is an allowance', 'allowance'],
    ['how do i stop the assistant', 'pause'],
    ['can i withdraw to my bank', 'cash-out'],
    ['how much does it cost', 'fees'],
    ['is my money safe', 'is-it-safe'],
    ['how do I add money with a card', 'add-money'],
    ['i sent money to the wrong person', 'cancel-payment'],
    ['how do I log in on my laptop', 'new-device'],
    ['how do i talk to ayo', 'talk-to-ayo'],
    ['can i pay my dstv', 'bills'],
  ])('"%s" finds %s first', (question, id) => {
    expect(rankArticles(question)[0]?.article.id).toBe(id);
  });

  it('finds nothing for words that are not about the app', () => {
    expect(rankArticles('the capital of france')).toEqual([]);
    expect(rankArticles('')).toEqual([]);
  });
});

describe('answering', () => {
  it('without a model, answers from the best article when it fits well', async () => {
    const result = await answerHelpQuestion('how do I send money', null);
    expect(result).toMatchObject({ by: 'article', articles: ['send-money'] });
    expect(result.answer).toBe(helpArticle('send-money')!.answer);
  });

  it('without a model, says it is not sure rather than stretch one stray word', async () => {
    const result = await answerHelpQuestion('can you recommend a good restaurant', null);
    expect(result).toEqual({ answer: NOT_COVERED, articles: [], by: 'none' });
  });

  it('with a model, gives its answer and the articles it used', async () => {
    const result = await answerHelpQuestion(
      'how do i send money',
      modelSaying({ answer: 'Tap Send, pick the person and confirm.', articles: ['send-money', 'nonsense-id'] }),
    );
    expect(result).toEqual({ answer: 'Tap Send, pick the person and confirm.', articles: ['send-money'], by: 'model' });
  });

  it('hands the model only the articles that fit, and the earlier turns', async () => {
    const config = modelSaying({ answer: 'ok', articles: [] });
    await answerHelpQuestion('how much is the fee', config, [
      { from: 'you', text: 'how do I send money' },
      { from: 'bot', text: 'Tap Send.' },
    ]);
    const body = JSON.parse(((config.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { body: string }).body) as {
      messages: { role: string; content: string }[];
    };
    const system = body.messages.map((message) => message.content).join('\n');
    expect(system).toContain('[fees]');
    expect(system).toContain('Answer ONLY from them');
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'how much is the fee' });
    expect(body.messages.some((message) => message.role === 'assistant' && message.content === 'Tap Send.')).toBe(true);
  });

  it('drops a model answer that uses a word the product never says, and falls back to the article', async () => {
    const result = await answerHelpQuestion(
      'how do I send money',
      modelSaying({ answer: 'Connect your wallet and sign the transaction.', articles: ['send-money'] }),
    );
    expect(result.by).toBe('article');
    expect(result.answer).not.toMatch(NEVER);
  });

  it('falls back when the model fails or answers something that is not JSON', async () => {
    const failing = { apiKey: 'k', fetch: vi.fn(async () => new Response('no', { status: 500 })) as unknown as typeof fetch };
    expect((await answerHelpQuestion('how do I send money', failing)).by).toBe('article');
    expect((await answerHelpQuestion('how do I send money', modelSaying('not json at all'))).by).toBe('article');
  });

  it('marks a question none of the articles touch as not covered, even when the model answers', async () => {
    const result = await answerHelpQuestion('who won the match yesterday', modelSaying({ answer: 'I’m not sure about that one.', articles: [] }));
    expect(result.by).toBe('none');
  });
});

describe('what is kept', () => {
  it('keeps the words and takes out anything that looks like a person', () => {
    expect(redactQuestion('call me on +234 803 123 4567 or ada@example.com')).toBe('call me on [number] or [email]');
    expect(redactQuestion('why did @tunde_o not get 0x1234567890abcdef1234')).toBe('why did [username] not get [address]');
    expect(redactQuestion('  how do   I send money ')).toBe('how do I send money');
    expect(redactQuestion('x'.repeat(500))).toHaveLength(300);
  });
});
