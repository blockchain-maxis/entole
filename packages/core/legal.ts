/**
 * The Terms and the Privacy notice, as words. Both apps draw them from here so
 * the phone and the browser can never say two different things.
 *
 * They describe the product as it is today: a test network, test money, no
 * licence. Every sentence about data was checked against the code that handles
 * it (what the browser keeps, what the directory publishes, what the message
 * route stores and sends). When any of that changes, this file changes in the
 * same commit, and `updated` with it.
 *
 * Drafted 12 October 2026 and not yet reviewed by a lawyer. That review comes
 * before real money does. So does a rewrite of every "test network" and "test
 * money" sentence here: `apps/web/tests/legal-network.test.ts` fails the day the
 * web app's public config points at the main network until they are gone.
 */

export type LegalSection = {
  heading: string;
  /** Paragraphs, in order. Plain sentences: no markup. */
  body: readonly string[];
};

export type LegalDocument = {
  title: string;
  /** The day the words last changed, as a person writes it. */
  updated: string;
  lead: string;
  sections: readonly LegalSection[];
};

export const LEGAL_CONTACT = 'support@entole.pro';

const UPDATED = '12 October 2026';

export const TERMS: LegalDocument = {
  title: 'Terms',
  updated: UPDATED,
  lead: 'These are the terms for using Entole. They are short, and they are written to be read.',
  sections: [
    {
      heading: 'What Entole is today',
      body: [
        'Entole is a money app that is still being built. Today it runs on a test network, with test money.',
        'Test money has no value. It cannot be exchanged for naira, dollars or anything else, and a balance in Entole is not money that anyone owes you. Nothing you do here is a real payment yet.',
        'Entole is not a bank and is not licensed by the Central Bank of Nigeria or any other regulator. Balances are not deposits and are not insured.',
        'When real money becomes possible, these terms will change first, and we will tell you in the app before anything real can move.',
      ],
    },
    {
      heading: 'Your account',
      body: [
        'You make an account with a name and a passkey: your fingerprint, your face or the screen lock on your own device. There is no password, and nothing to write down.',
        'Your device keeps the passkey. Anyone who can unlock your device with it can move money from your account, so keep the device locked and do not add another person’s fingerprint to it.',
        'Most phones and browsers back passkeys up to your Google or Apple account, so a new device can use them. If yours does not, and you lose the device, we have no way to let you back in.',
        'You must be 18 or older to use Entole.',
        'The name you give is shown to people you pay and to people who pay you.',
      ],
    },
    {
      heading: 'Payments',
      body: [
        'Before a payment goes, a review screen shows who it is for, how much, and the fee. Check it. Once you confirm, the payment is sent straight away and we cannot reverse it.',
        'A payment is shown as delivered only when it has been delivered. Until then it is pending.',
        'Anyone who has your username, your phone number or your pay link can send you money. None of them lets anyone take any.',
        'Where a payment partner carries out part of a payment, such as paying in by bank or card or paying a bill, that part also follows the partner’s own terms, shown to you at that step.',
      ],
    },
    {
      heading: 'The assistant and allowances',
      body: [
        'The assistant can pay for you only inside an allowance you have written: who it may pay, how much each time, how often, and a limit.',
        'The limit is enforced by the payment network itself and not only by this app. A payment that would pass the limit is refused, whatever the assistant was asked to do.',
        'A payment the assistant is about to make waits for a short time first, and you can cancel it in that time. You can pause the assistant from the top of any screen, and revoke an allowance whenever you like.',
        'The assistant can misread a message. The allowance, the wait and the pause are there for that. A payment it makes inside an allowance you wrote, and that you did not cancel, is a payment you authorised.',
      ],
    },
    {
      heading: 'Savings and stocks',
      body: [
        'Savings sets money aside, separate from what you spend. It earns nothing today.',
        'Stock prices are shown for information. They come from outside market data sources and can be late or wrong. You cannot buy or sell stocks in Entole today.',
        'Nothing in Entole is investment, tax or legal advice.',
      ],
    },
    {
      heading: 'Business tools',
      body: [
        'An invoice is a request for payment with a link. Sending one does not guarantee that you will be paid.',
        'Records you download are for your own books. Check them before you rely on them.',
      ],
    },
    {
      heading: 'What you agree not to do',
      body: [
        'Do not use Entole to break the law, to deceive anyone, to pay for anything illegal, to get into an account that is not yours, or to test or overload the service beyond ordinary use.',
        'We may limit or close access for an account that does any of these.',
      ],
    },
    {
      heading: 'The service as it is',
      body: [
        'Entole is offered as it is, while it is being built. It can be slow, wrong or unavailable. Test balances can be reset or lost, and features can change or be removed.',
        'As far as the law allows, we are not liable for losses that come from using it. Nothing here takes away a right the law gives you that cannot be taken away.',
      ],
    },
    {
      heading: 'Changes, and leaving',
      body: [
        'We may change these terms. The date at the top changes when we do, and for a change that matters we will tell you in the app first.',
        'You can stop using Entole at any time, by signing out from Me.',
      ],
    },
    {
      heading: 'Law and contact',
      body: [
        'These terms are governed by the laws of the Federal Republic of Nigeria.',
        `Questions about them go to ${LEGAL_CONTACT}.`,
      ],
    },
  ],
};

export const PRIVACY: LegalDocument = {
  title: 'Privacy',
  updated: UPDATED,
  lead: 'What Entole knows about you, where it is kept, and who else sees it.',
  sections: [
    {
      heading: 'The short version',
      body: [
        'We ask for a name and a username. The phone app also asks for your phone number, so people can pay you by number. We do not ask for your email, your BVN, an identity document or your contact list.',
        'There are no ads, we do not sell or rent anything about you, and there is no tracking or analytics software in the app.',
      ],
    },
    {
      heading: 'What stays on your device',
      body: [
        'Your passkey. Your fingerprint or face is checked by your own device and never reaches us.',
        'Your name and username, the people you have saved, your recent records, and your settings. In the browser these are kept in that browser’s storage; on the phone, in the app’s own storage.',
        'Signing out and forgetting a device, from Me, removes your name and the link to your passkey from it. The people you saved and your records stay in that device’s storage until you clear the site’s data in your browser, or remove the app from your phone.',
      ],
    },
    {
      heading: 'What we keep',
      body: [
        'Your name, your initials and your username are published against your account number, so that people can find and pay you by username and see a name when they do. A username belongs to one person: the first to choose it. Anyone who has your username or your pay link can see that name.',
        'If you give your phone number in the phone app, it is published the same way, so that you can be paid by number. Anyone who has your number can see your name.',
        'When you pay someone, your app tells us which payment it was and the note you wrote. We check that payment against the public record and keep it for the person you paid: your name, the amount, when it arrived and your note. That is how it shows in their activity and how they are told it came. When someone pays you, the same is kept for you. We keep the most recent 200 for each person.',
        'If you connect the assistant to a messaging app, we keep the link between that chat and your account, the names and account numbers of the people you have saved, the allowance it may use, and the payments it has proposed.',
        'Like every website, the service records the usual technical details of each request, such as an IP address, the kind of browser and the time. We use them to keep the service running and to stop abuse.',
      ],
    },
    {
      heading: 'What is public',
      body: [
        'Payments are recorded on a public payment network. The record shows account numbers, amounts and times. It does not show names.',
        'That record is permanent. Neither you nor we can change or delete it. Today these are test payments on a test network.',
      ],
    },
    {
      heading: 'Who else handles it',
      body: [
        'Vercel hosts the app, and Upstash stores what is listed under “What we keep”.',
        'Telegram, if you connect the assistant to it, carries your messages to and from the assistant.',
        'Alibaba Cloud provides the language model that reads a message sent to the assistant on Telegram when the app cannot read it by itself. It receives the words of that one message. It does not receive your name, your account or the people you have saved.',
        'When paying in by bank or card opens, that step is run by a payment partner on their own page. They collect what they need from you directly. We never see your card details or your bank login.',
        'The market data sources behind stock prices receive nothing about you.',
        'Some of these companies keep data outside Nigeria.',
      ],
    },
    {
      heading: 'How long',
      body: [
        'What is on your device stays until you clear it there.',
        'A published name, username or number, a connected chat, or a record of a payment that arrived for you, stays until you ask us to remove it. Changing your username releases the old one for someone else to take.',
        'The public payment record cannot be removed by anyone.',
      ],
    },
    {
      heading: 'Your choices',
      body: [
        `You can ask what we hold about you, ask us to correct it, ask us to delete it, or object to how it is used. Write to ${LEGAL_CONTACT} and we will answer within 30 days.`,
        'If you are not satisfied with the answer, you can complain to the Nigeria Data Protection Commission.',
      ],
    },
    {
      heading: 'Children',
      body: ['Entole is not for anyone under 18, and we do not knowingly keep anything about them.'],
    },
    {
      heading: 'Changes and contact',
      body: [
        'If this notice changes, the date at the top changes with it, and for a change that matters we will tell you in the app first.',
        `Questions go to ${LEGAL_CONTACT}.`,
      ],
    },
  ],
};
