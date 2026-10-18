/**
 * The rules of a spoken conversation that do not depend on a phone: when a
 * person has finished a sentence, whether what the microphone heard is the
 * assistant's own voice coming back, and whether someone is talking over it.
 *
 * They live here, apart from the recogniser and the screen, so they can be
 * tested with plain strings.
 */

/** Words as a recogniser writes them, lower case, with the symbols that are spoken as words turned into words. */
export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/₦/g, ' naira ')
    .replace(/(\d),(?=\d)/g, '$1')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** A crude stem, enough that "sending" and "send" or "payments" and "payment" count as one word. */
function stem(word: string): string {
  return word.replace(/(?:ing|ed|es|s)$/, '');
}

const NUMBER_WORDS = new Set([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty',
  'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'naira', 'point', 'k',
]);

const isNumberish = (word: string) => /^\d+$/.test(word) || NUMBER_WORDS.has(word);

function editDistance(a: string, b: string): number {
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
 * Whether a heard word is one the assistant was saying. A recogniser hearing
 * a speaker through a microphone gets words slightly wrong ("balance" for
 * "balances", "sending" for "send"), so a word one letter off a spoken word, or
 * a longer or shorter form of it, counts as the same word. And a sentence with
 * a figure in it comes back as digits or as words ("₦12,500" as "twelve
 * thousand five hundred"), so once the assistant has said a number, any number
 * word heard is taken as that.
 */
function wasSaid(word: string, known: ReadonlySet<string>, saidANumber: boolean): boolean {
  if (known.has(stem(word))) return true;
  if (saidANumber && isNumberish(word)) return true;
  if (word.length < 3) return false;
  for (const spoken of known) {
    if (spoken.length < 3) continue;
    if (spoken.startsWith(word) || word.startsWith(spoken) || editDistance(word, spoken) <= 1) return true;
  }
  return false;
}

/**
 * The words in what was heard that the assistant was not itself saying.
 *
 * `figuresAreEcho` treats any number heard as the one the assistant just said.
 * That is right for telling whether something is its own voice coming back, and
 * wrong for keeping what a person says straight after it: "send 5000" must not
 * lose its 5000 because the assistant had just said a balance.
 */
export function novelWords(heard: string, spoken: string, options: { figuresAreEcho?: boolean } = {}): string[] {
  const said = wordsOf(spoken);
  const known = new Set(said.map(stem));
  const saidANumber = options.figuresAreEcho === true && said.some(isNumberish);
  return wordsOf(heard).filter((word) => !wasSaid(word, known, saidANumber));
}

/**
 * Whether what the microphone heard is only the assistant's own voice, played
 * by the speaker and picked up again. A phone has no echo cancellation the app
 * can rely on, so this compares the words: if nearly all of them were in the
 * sentence being said, it is the echo.
 */
export function isEcho(heard: string, spoken: string): boolean {
  const all = wordsOf(heard);
  if (all.length === 0) return true;
  return novelWords(heard, spoken, { figuresAreEcho: true }).length / all.length < 0.34;
}

const INTERRUPT = /\b(?:stop|wait|hold on|hang on|cancel|never ?mind|quiet|shush|enough|okay okay)\b/;

/** A word or two that means "stop talking", which counts as interrupting even though it is short. */
export function wantsToInterrupt(novel: readonly string[]): boolean {
  return INTERRUPT.test(novel.join(' '));
}

/**
 * Whether what was heard, set against what is being said, is a person talking
 * over the assistant.
 *
 * It has to be sure. The microphone hears the speaker, a recogniser garbles
 * what it hears, and an assistant that stops itself because it misheard itself
 * is worse than one that can be talked over a little less easily. So it takes
 * only two things as a person: an explicit word to stop ("stop", "wait",
 * "cancel", or the assistant's name when it was not itself saying it), or a
 * good run of words, four or more and mostly new, which its own voice does not
 * produce.
 */
export function isInterruption(heard: string, spoken: string): { yes: false } | { yes: true; words: string[] } {
  const novel = novelWords(heard, spoken, { figuresAreEcho: true });
  if (wantsToInterrupt(novel) || (novel.includes('ayo') && !wordsOf(spoken).includes('ayo'))) {
    return { yes: true, words: novel };
  }
  const all = wordsOf(heard);
  return novel.length >= 4 && novel.length / all.length >= 0.5 ? { yes: true, words: novel } : { yes: false };
}

/** Words a sentence does not end on: someone who has said one is still going. */
const UNFINISHED = new Set([
  'and', 'or', 'but', 'so', 'then', 'to', 'for', 'from', 'with', 'of', 'the', 'a', 'an', 'my', 'his', 'her', 'their',
  'some', 'about', 'like', 'um', 'uh', 'er', 'erm', 'hmm', 'because', 'that', 'is', 'are', 'i', 'want', 'wanna',
  'need', 'send', 'pay', 'give',
]);

/** The quiet, in milliseconds, after which what was said counts as finished. */
export const QUIET_COMPLETE_MS = 1800;
export const QUIET_OPEN_MS = 2400;
export const QUIET_MOST_MS = 5000;

/**
 * How long to wait in silence before taking a sentence as finished. It used to
 * be whatever the phone decided, about a second, which cut people off mid
 * thought. Now it depends on what was said:
 *
 * - a request the app already fully understands ("what's my balance") waits the
 *   least, so a short command is not slowed down;
 * - anything else waits longer, because it may not be finished;
 * - a sentence that ends on a word like "and", "to" or "for", or on "um",
 *   is plainly not finished, and waits longer still.
 */
export function endpointDelay(command: string, understood: boolean): number {
  const said = wordsOf(command);
  const last = said[said.length - 1] ?? '';
  let delay = understood ? QUIET_COMPLETE_MS : QUIET_OPEN_MS;
  if (!understood && said.length <= 2) delay += 500;
  if (UNFINISHED.has(last)) delay += 1600;
  return Math.min(delay, QUIET_MOST_MS);
}

// ---------------------------------------------------------------------------
// Saying yes.
// ---------------------------------------------------------------------------

const SOFTENERS = new Set(['abeg', 'please', 'pls', 'just', 'now', 'then', 'o']);

/** Words that can be a yes, alone or together. */
const YES_CORE = new Set([
  'yes', 'yeah', 'yep', 'yup', 'ya', 'sure', 'ok', 'okay', 'alright', 'fine', 'correct', 'right', 'proceed', 'confirm',
  'confirmed', 'approve', 'approved', 'send', 'oya', 'ehen', 'sharp', 'perfect', 'good', 'great', 'thing',
]);
/** Words that may sit beside those in a yes ("yes go ahead", "send it", "that is correct"). */
const YES_TOKENS = new Set([...YES_CORE, 'go', 'ahead', 'it', 'do', 'on', 'that', 'is', 'thats', 'na', 'lets', 'let', 'us', 'and']);
/** Yes, said without any of the words above on their own. */
const YES_PHRASES = new Set(['doit', 'goahead', 'goon', 'letsgo', 'oyago', 'letusgo']);

const NO_WORDS = new Set([
  'no', 'nope', 'nah', 'cancel', 'stop', 'dont', 'not', 'never', 'nevermind', 'wait', 'hold', 'abort', 'forget', 'negative',
]);

/**
 * Whether a short reply is a yes or a no to a question the assistant has just
 * asked, in the English and Pidgin people use: "yes", "go ahead", "send it",
 * "abeg do it", "no", "cancel", "no wait". Anything longer than a few words, or
 * that is neither, is not an answer: it is a new request, and is read as one.
 *
 * A no anywhere in it wins ("no go ahead" is a no), because the safe mistake is
 * not sending. A yes must be only yes-words: "send 5000 to Ada" is a request,
 * not an approval of one.
 *
 * It decides nothing about money. It only says whether the person agreed, to a
 * screen that is waiting for exactly that and still asks for their fingerprint.
 */
export function readApproval(text: string): 'yes' | 'no' | null {
  const said = wordsOf(text)
    .map((word) => word.replace(/'/g, ''))
    .filter((word) => word && !SOFTENERS.has(word));
  if (said.length === 0 || said.length > 5) return null;
  if (said.some((word) => NO_WORDS.has(word))) return 'no';
  const joined = said.join('');
  const onlyYesWords = said.every((word) => YES_TOKENS.has(word));
  if (onlyYesWords && (said.some((word) => YES_CORE.has(word)) || YES_PHRASES.has(joined))) return 'yes';
  return null;
}
