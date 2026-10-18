/**
 * How a screen asks the assistant to ask the person something out loud, and
 * hear the answer.
 *
 * The review sheet that a spoken payment opens makes an offer: "Sending ₦5,000
 * to Ada Eze. The fee is ₦250. Shall I send it?" with what to do on a yes and
 * on a no. The assistant says the line, listens for yes or no, and calls the
 * matching function. That is all it can do with it, and all it ever holds: it
 * is given a function to call, never the means to send, sign, or answer the
 * fingerprint prompt. A yes only presses the same button the person would, and
 * that button's job is to raise the fingerprint prompt, which only the person
 * can answer.
 *
 * An offer lasts as long as the screen that made it. The screen withdraws it
 * when it closes, so a yes can never reach a sheet that is gone.
 *
 * With the assistant off, no one is connected and an offer goes nowhere: the
 * screens behave exactly as they always have.
 */

export type Offer = {
  /** The question, as it is spoken. Every figure in it comes from the screen. */
  say: string;
  /** Called on a spoken yes. */
  yes: () => void;
  /** Called on a spoken no. */
  no?: () => void;
  /** Said after a no. */
  declined?: string;
};

export type OfferSink = {
  offer: (offer: Offer) => void;
  say: (text: string) => void;
  withdraw: (offer: Offer) => void;
};

let sink: OfferSink | null = null;

/** The assistant connects here while it is on, and disconnects when it is not. */
export function connectOffers(next: OfferSink | null): void {
  sink = next;
}

/** Offers a question to the person by voice. Returns what withdraws it. */
export function makeOffer(offer: Offer): () => void {
  sink?.offer(offer);
  return () => sink?.withdraw(offer);
}

/** Says something, with no answer expected: that it has not gone through, say. */
export function voiceSay(text: string): void {
  sink?.say(text);
}
