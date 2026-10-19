/**
 * What the assistant knows about Nigerian names, in three jobs.
 *
 * 1. **Saying them.** A voice built to read English reads "Chukwuemeka" and
 *    "Ngozi" the way the letters suggest. `sayNigerianNames` swaps a name for a
 *    respelling that voices read the way it is said ("Chook-woo-eh-meh-kah").
 *    A name in the list is respelled whole; a name made of known pieces
 *    ("Oluwaseun" is Oluwa + seun) is put together from them; anything else is
 *    left alone, because a wrong guess is worse than an English reading.
 * 2. **Finding them.** What a recogniser writes for a spoken name is often not
 *    the spelling: "Adaeze" comes back as "a day zay", "Chukwuemeka" as "chuck
 *    wemeka". `nameSimilarity` compares by sound as well as by letters, so the
 *    person who was meant is still found among the people saved.
 * 3. **Hearing them.** `recognitionVocabulary` is the short list of names handed
 *    to the speech recogniser as hints: first the person's own saved people,
 *    then common names, so it leans towards names that are likely.
 *
 * The respellings are written by ear and are the thing most worth correcting.
 * They are all in `RESPELLINGS` and `PIECES`; changing a line changes how that
 * name is said, and nothing else depends on the spelling chosen.
 */

/** Names that a voice reading English gets wrong, and how they are said. Syllables are joined with hyphens. */
const RESPELLINGS: Record<string, string> = {
  // The assistant's own name.
  ayo: 'Eye-yo',
  // Igbo
  adaeze: 'Ah-dah-eh-zeh',
  adaobi: 'Ah-dah-oh-bee',
  amaka: 'Ah-mah-kah',
  chidi: 'Chee-dee',
  chika: 'Chee-kah',
  chinedu: 'Chee-neh-doo',
  chinonso: 'Chee-non-soh',
  chioma: 'Chee-oh-mah',
  chukwudi: 'Chook-woo-dee',
  chukwuemeka: 'Chook-woo-eh-meh-kah',
  ebuka: 'Eh-boo-kah',
  emeka: 'Eh-meh-kah',
  ifeanyi: 'Ee-feh-ahn-yee',
  ifeoma: 'Ee-feh-oh-mah',
  ikenna: 'Ee-ken-nah',
  kelechi: 'Keh-leh-chee',
  nkechi: 'N-keh-chee',
  nneka: 'N-neh-kah',
  nnamdi: 'N-nahm-dee',
  ngozi: 'N-go-zee',
  obinna: 'Oh-been-nah',
  oluchi: 'Oh-loo-chee',
  onyeka: 'Oh-nyeh-kah',
  onyinye: 'Oh-nyee-nyeh',
  uche: 'Oo-cheh',
  uchenna: 'Oo-chen-nah',
  ugochukwu: 'Oo-go-chook-woo',
  nwanneka: 'Nwah-n-neh-kah',
  // Yoruba
  abiodun: 'Ah-bee-oh-doon',
  adebayo: 'Ah-deh-bah-yo',
  adewale: 'Ah-deh-wah-leh',
  adesola: 'Ah-deh-shoh-lah',
  ayodele: 'Eye-yo-deh-leh',
  ayomide: 'Eye-yo-mee-deh',
  ayobami: 'Eye-yo-bah-mee',
  babatunde: 'Bah-bah-toon-deh',
  bolanle: 'Boh-lahn-leh',
  bukola: 'Boo-koh-lah',
  damilola: 'Dah-mee-loh-lah',
  damilare: 'Dah-mee-lah-reh',
  folake: 'Foh-lah-keh',
  funmilayo: 'Foon-mee-lah-yo',
  gbenga: 'Gbeng-gah',
  kehinde: 'Keh-heen-deh',
  kemi: 'Keh-mee',
  lekan: 'Leh-kahn',
  olamide: 'Oh-lah-mee-deh',
  olumide: 'Oh-loo-mee-deh',
  oluwaseun: 'Oh-loo-wah-shay-oon',
  oluwatobi: 'Oh-loo-wah-toh-bee',
  oluwafemi: 'Oh-loo-wah-feh-mee',
  segun: 'Sheh-goon',
  seyi: 'Shay-yee',
  temitope: 'Teh-mee-toh-peh',
  tolu: 'Toh-loo',
  tunde: 'Toon-deh',
  yetunde: 'Yeh-toon-deh',
  yemi: 'Yeh-mee',
  titilayo: 'Tee-tee-lah-yo',
  toyin: 'Toh-yeen',
  sade: 'Shah-deh',
  ronke: 'Ron-keh',
  wale: 'Wah-leh',
  bisi: 'Bee-see',
  dayo: 'Dah-yo',
  femi: 'Feh-mee',
  kunle: 'Koon-leh',
  // Hausa and the north
  abdullahi: 'Ab-doo-lah-hee',
  aisha: 'Ah-ee-shah',
  bashir: 'Bah-sheer',
  fatima: 'Fah-tee-mah',
  hadiza: 'Hah-dee-zah',
  musa: 'Moo-sah',
  usman: 'Oos-mahn',
  yusuf: 'Yoo-soof',
  zainab: 'Zah-ee-nab',
};

/** Pieces that names are made of. A name that is wholly made of these is put together from them. */
const PIECES: Record<string, string> = {
  oluwa: 'Oh-loo-wah',
  chukwu: 'Chook-woo',
  ola: 'Oh-lah',
  ade: 'Ah-deh',
  ayo: 'Eye-yo',
  ife: 'Ee-feh',
  chi: 'Chee',
  nne: 'N-neh',
  ogo: 'Oh-go',
  seun: 'shay-oon',
  tobi: 'toh-bee',
  femi: 'feh-mee',
  mide: 'mee-deh',
  yemi: 'yeh-mee',
  wale: 'wah-leh',
  bayo: 'bah-yo',
  dele: 'deh-leh',
  tunde: 'toon-deh',
  funmi: 'foon-mee',
  layo: 'lah-yo',
  kunle: 'koon-leh',
  sola: 'shoh-lah',
  bola: 'boh-lah',
  gbemi: 'gbeh-mee',
  tope: 'toh-peh',
  lola: 'loh-lah',
  mola: 'moh-lah',
  jide: 'jee-deh',
  kayode: 'kah-yo-deh',
  rotimi: 'roh-tee-mee',
  bami: 'bah-mee',
  koya: 'koh-yah',
  dami: 'dah-mee',
  ekene: 'eh-keh-neh',
  nna: 'n-nah',
  ebuka: 'eh-boo-kah',
  emeka: 'eh-meh-kah',
  ugo: 'oo-go',
  obi: 'oh-bee',
  ada: 'ah-dah',
  eze: 'eh-zeh',
  uche: 'oo-cheh',
  oma: 'oh-mah',
  nkem: 'n-kem',
  nonso: 'non-soh',
  kamsi: 'kahm-see',
  ndidi: 'n-dee-dee',
};

/** Letters with a mark on them (ọ, ẹ, ṣ) are the same letters to a recogniser and to this. */
function plain(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

const PIECE_KEYS = Object.keys(PIECES).sort((a, b) => b.length - a.length);

/** Splits a name wholly into known pieces, preferring the longest, or says it cannot be done. */
function split(word: string): string[] | null {
  if (!word) return [];
  for (const piece of PIECE_KEYS) {
    if (!word.startsWith(piece)) continue;
    const rest = split(word.slice(piece.length));
    if (rest) return [piece, ...rest];
  }
  return null;
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** How a Nigerian name is said, or `null` when it is not one this knows (the voice then reads it its own way). */
export function respellNigerianName(name: string): string | null {
  const key = plain(name);
  if (key.length < 2) return null;
  const known = RESPELLINGS[key];
  if (known) return known;
  // A made-up name from known pieces needs at least two of them, so one piece alone is not guessed at.
  const pieces = split(key);
  if (!pieces || pieces.length < 2) return null;
  return capital(pieces.map((piece) => PIECES[piece]!).join('-').toLowerCase());
}

/** Every Nigerian name in a sentence, respelled for a voice; the rest of the sentence is untouched. */
export function sayNigerianNames(text: string): string {
  return text.replace(/[\p{L}̀-ͯ]+/gu, (word) => respellNigerianName(word) ?? word);
}

// ---------------------------------------------------------------------------
// Finding a name by how it sounds.
// ---------------------------------------------------------------------------

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, at) => at);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]!;
      row[j] = Math.min(above + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}

/**
 * A name by its sound. Spellings that a recogniser and a person trade
 * freely are folded together ("ch" and "c", "kw" and "q", "gb" and "b", "ph" and
 * "f", "sh" and "s", a doubled letter and one), "y" and "w" count as vowels, and
 * the vowels are dropped, leaving the consonants a name is held together by.
 */
function skeleton(name: string): string {
  return (
    plain(name)
      .replace(/ph/g, 'f')
      // "ch" is held apart as a capital while "c" and "q" become "k", then put back.
      .replace(/tch|ch|ts/g, 'C')
      .replace(/kw|qu|q|c/g, 'k')
      .replace(/gb/g, 'b')
      .replace(/kp/g, 'p')
      .replace(/sh|z/g, 's')
      .replace(/[aeiouyw]/g, '')
      .replace(/(.)\1+/g, '$1')
      // "Ngozi" and "Gozi": the n before another consonant at the start is hardly there.
      .replace(/^n(?=[a-zC])/, '')
  );
}

const similarity = (a: string, b: string) => (a || b ? 1 - distance(a, b) / Math.max(a.length, b.length) : 0);

/**
 * How well what was heard matches a name, from 0 to 1. Spaces are ignored, so
 * "a day zay" is "adaezay"; it is compared with the whole name, each part of
 * it, and the nickname, by letters, and by sound when the letters are close
 * enough that the sound is a fair tie-breaker.
 */
export function nameSimilarity(heard: string, name: string, nickname?: string): number {
  const said = plain(heard);
  if (said.length < 2) return 0;
  const targets = [name, ...name.split(/\s+/), ...(nickname ? [nickname] : [])].map(plain).filter((target) => target.length >= 2);
  let best = 0;
  for (const target of targets) {
    let score = similarity(said, target);
    // The same consonants in the same order, and the letters not too far off: the same name, said differently.
    if (score >= 0.4 && skeleton(said).length >= 2 && skeleton(said) === skeleton(target)) score = Math.max(score, 0.8);
    best = Math.max(best, score);
  }
  return best;
}

/** The single person a spoken name is most likely to mean, if one is clearly ahead of the rest. */
export function bestNameMatch<T extends { name: string; nickname?: string | undefined }>(
  heard: string,
  people: readonly T[],
  options: { least?: number; lead?: number } = {},
): { match: T } | { several: T[] } | null {
  const least = options.least ?? 0.78;
  const lead = options.lead ?? 0.08;
  const ranked = people
    .map((person) => ({ person, score: nameSimilarity(heard, person.name, person.nickname) }))
    .filter((entry) => entry.score >= least)
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;
  const [first, second] = ranked;
  if (!second || first!.score - second.score >= lead) return { match: first!.person };
  return { several: ranked.filter((entry) => first!.score - entry.score < lead).map((entry) => entry.person) };
}

// ---------------------------------------------------------------------------
// Hinting the recogniser.
// ---------------------------------------------------------------------------

/** Common names, spelled as written: the ones worth leaning the recogniser towards after the person's own. */
const COMMON = [
  'Adaeze', 'Amaka', 'Chidi', 'Chinedu', 'Chioma', 'Chukwuemeka', 'Emeka', 'Ifeanyi', 'Ikenna', 'Nkechi', 'Ngozi', 'Obinna',
  'Uche', 'Abiodun', 'Adebayo', 'Ayodele', 'Babatunde', 'Bukola', 'Damilola', 'Folake', 'Funmilayo', 'Gbenga', 'Kemi',
  'Oluwaseun', 'Segun', 'Seyi', 'Temitope', 'Tunde', 'Yetunde', 'Abdullahi', 'Aisha', 'Fatima', 'Musa', 'Usman', 'Yusuf',
  'Zainab', 'Tobi', 'Tolu', 'Wale', 'Yemi', 'Nneka', 'Nnamdi', 'Ebuka', 'Kelechi', 'Onyeka', 'Ayomide', 'Olamide',
] as const;

/**
 * The names to hand the speech recogniser as hints (it takes a short list):
 * the assistant's own name, then the person's saved people (full names, first
 * names and nicknames), then common names, up to `limit`. Most-likely first.
 */
export function recognitionVocabulary(
  people: readonly { name: string; nickname?: string | undefined }[],
  limit = 80,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (word: string | undefined) => {
    const text = word?.trim();
    if (!text || seen.has(text.toLowerCase())) return;
    seen.add(text.toLowerCase());
    out.push(text);
  };
  add('Ayo');
  add('Hey Ayo');
  for (const person of people) {
    add(person.name);
    add(person.name.split(/\s+/)[0]);
    add(person.nickname);
  }
  for (const name of COMMON) add(name);
  return out.slice(0, limit);
}
