import { describe, expect, it } from 'vitest';

import { bestNameMatch, nameSimilarity, recognitionVocabulary, respellNigerianName, sayNigerianNames } from './nigerian-names';

describe('saying a Nigerian name', () => {
  it('respells the ones a voice reading English gets wrong', () => {
    expect(respellNigerianName('Chukwuemeka')).toBe('Chook-woo-eh-meh-kah');
    expect(respellNigerianName('Ngozi')).toBe('N-go-zee');
    expect(respellNigerianName('Adaeze')).toBe('Ah-dah-eh-zeh');
    expect(respellNigerianName('Oluwaseun')).toBe('Oh-loo-wah-shay-oon');
    expect(respellNigerianName('Ayo')).toBe('Eye-yo');
  });

  it('does not mind capitals, or the marks Yoruba and Igbo put on letters', () => {
    expect(respellNigerianName('NGOZI')).toBe('N-go-zee');
    expect(respellNigerianName('Olúwaṣeun')).toBe('Oh-loo-wah-shay-oon');
    expect(respellNigerianName('Ọbịnna')).toBe('Oh-been-nah');
  });

  it('puts a name together from known pieces when it is not in the list', () => {
    expect(respellNigerianName('Adeola')).toBe('Ah-deh-oh-lah');
    expect(respellNigerianName('Chiobi')).toBe('Chee-oh-bee');
  });

  it('leaves alone what it does not know, rather than guess', () => {
    for (const word of ['Okafor', 'Smith', 'Hello', 'balance', 'Ola', 'x']) expect(respellNigerianName(word)).toBeNull();
  });

  it('respells every Nigerian name in a sentence, and nothing else', () => {
    expect(sayNigerianNames('Sent. ₦5,000 has gone to Ngozi Okafor. Hey Ayo!')).toBe('Sent. ₦5,000 has gone to N-go-zee Okafor. Hey Eye-yo!');
    expect(sayNigerianNames('You have ₦12,500 in savings.')).toBe('You have ₦12,500 in savings.');
  });

  it('does not touch a longer word that merely starts with a name', () => {
    expect(sayNigerianNames('Ayodele and Ayodeji')).toBe('Eye-yo-deh-leh and Ayodeji');
  });
});

describe('finding a name by how it sounds', () => {
  it.each([
    ['a day zay', 'Adaeze Okafor'],
    ['chuck wemeka', 'Chukwuemeka Obi'],
    ['go zee', 'Ngozi Eze'],
    ['tonde', 'Tunde Bello'],
    ['Ngozi', 'Ngozi Eze'],
    ['olu waseun', 'Oluwaseun Adeyemi'],
    ['kemmy', 'Kemi Adebayo'],
  ])('"%s" is %s', (heard, name) => {
    expect(nameSimilarity(heard, name)).toBeGreaterThanOrEqual(0.78);
  });

  it.each([
    ['mum', 'Adaeze Okafor'],
    ['balance', 'Tunde Bello'],
    ['send money', 'Ngozi Eze'],
    ['ada', 'Tunde Bello'],
    ['tolu', 'Tunde Bello'],
    ['', 'Tunde Bello'],
  ])('"%s" is not %s', (heard, name) => {
    expect(nameSimilarity(heard, name)).toBeLessThan(0.78);
  });

  it('uses the nickname as well', () => {
    expect(nameSimilarity('mommy', 'Adaeze Okafor', 'Mommy')).toBeGreaterThanOrEqual(0.78);
  });

  const people = [
    { name: 'Adaeze Okafor', nickname: 'Mum' },
    { name: 'Tunde Bello' },
    { name: 'Ngozi Eze' },
  ];

  it('picks the one person who is clearly meant', () => {
    expect(bestNameMatch('a day zay', people)).toEqual({ match: people[0] });
    expect(bestNameMatch('tonde', people)).toEqual({ match: people[1] });
    expect(bestNameMatch('go zee', people)).toEqual({ match: people[2] });
  });

  it('says there are several when two are about as close, and nobody when none is', () => {
    const twins = [{ name: 'Tunde Bello' }, { name: 'Tunde Adeyemi' }];
    expect(bestNameMatch('tunde', twins)).toMatchObject({ several: expect.any(Array) });
    // But a whole name that matches exactly beats one that is merely close.
    expect(bestNameMatch('tunde bello', [{ name: 'Tunde Bello' }, { name: 'Tunde Bellow' }])).toEqual({ match: { name: 'Tunde Bello' } });
    expect(bestNameMatch('zxqw', people)).toBeNull();
  });
});

describe('hinting the recogniser', () => {
  it('starts with its own name, then the person’s people, then common names', () => {
    const list = recognitionVocabulary([{ name: 'Adaeze Okafor', nickname: 'Mum' }, { name: 'Tunde Bello' }]);
    expect(list.slice(0, 7)).toEqual(['Ayo', 'Hey Ayo', 'Adaeze Okafor', 'Adaeze', 'Mum', 'Tunde Bello', 'Tunde']);
    expect(list).toContain('Chukwuemeka');
  });

  it('has no repeats, whatever the case, and stays within the limit', () => {
    const list = recognitionVocabulary([{ name: 'ngozi eze' }], 10);
    expect(list).toHaveLength(10);
    expect(new Set(list.map((word) => word.toLowerCase())).size).toBe(list.length);
  });
});
