import { phoneHandleSchema, usernameHandleSchema, type DirectoryIdentity, type PhoneHandle } from './directory';
import { normalizeUsername } from './profile';

/**
 * How a person names someone to pay without a payment code: a username or a
 * phone number. Reading one never touches the network, so it cannot say
 * whether anyone has claimed it; the directory answers that.
 */
export type Handle = { kind: 'username'; username: string } | { kind: 'phone'; phone: PhoneHandle };

/** A Nigerian mobile number in any of the ways it is written, down to its ten
 * digits: "0803 123 4567", "+234 803 123 4567", "2348031234567", "8031234567". */
function nigerianNumber(text: string): string | null {
  const digits = text.replace(/[\s().-]/g, '');
  const match = /^(?:\+?234|0)?([789][01]\d{8})$/.exec(digits);
  return match ? match[1]! : null;
}

/**
 * Reads typed text as a username ("@ada.eze", or "ada.eze" on its own) or a
 * phone number. `null` for anything else, including a payment code or a link,
 * which are read elsewhere and first.
 */
export function parseHandle(input: string): Handle | null {
  const text = input.trim();
  if (!text) return null;

  // A pay link made from a username: `entole.pro/pay/@ada.eze`.
  const linked = /(?:^|\/)pay\/(?:@|%40)([a-z0-9_.]{3,20})(?:[/?#].*)?$/i.exec(text);
  if (linked) return { kind: 'username', username: linked[1]!.toLowerCase() };
  if (text.length > 40) return null;

  const number = nigerianNumber(text);
  if (number) {
    const phone = phoneHandleSchema.safeParse({ country: 'ng', number });
    return phone.success ? { kind: 'phone', phone: phone.data } : null;
  }

  // A link, a path or a code is not a username, however it lower-cases.
  if (/[/:?#]|-/.test(text) || /\s/.test(text)) return null;
  const username = normalizeUsername(text);
  // Digits alone are a mistyped number, not a name.
  if (!usernameHandleSchema.safeParse(username).success || !/[a-z]/.test(username)) return null;
  return { kind: 'username', username };
}

/** "@ada.eze" or "0803 123 4567": a handle the way a person would write it. */
export function formatHandle(handle: Handle): string {
  if (handle.kind === 'username') return `@${handle.username}`;
  const n = handle.phone.number;
  return n.length === 10 ? `0${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}` : n;
}

/** The directory, as far as resolving a handle needs it. */
export type HandleDirectory = {
  resolveByUsername(username: string): Promise<DirectoryIdentity | null>;
  resolveByPhone(phone: PhoneHandle): Promise<DirectoryIdentity | null>;
};

/** Who a handle belongs to, or `null` when nobody has claimed it. */
export function resolveHandle(directory: HandleDirectory, handle: Handle): Promise<DirectoryIdentity | null> {
  return handle.kind === 'username'
    ? directory.resolveByUsername(handle.username)
    : directory.resolveByPhone(handle.phone);
}
