'use client';

import { Check, FileText, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { NearClientError, type StatementReading } from '@entole/core/near-client';
import type { StatementRead } from '@entole/core/records';
import { proofLines, type ProofSummary } from '@entole/core/tee-proof';

import { GlassSheet } from './GlassSheet';
import { LogoLoader } from './LogoLoader';
import { balanceCheckWords } from '@/lib/plan-words';
import { messageOf } from '@/lib/pockets';

/**
 * Reading a bank statement. The file goes to a reader in sealed hardware that
 * nobody can look inside, with its password if it has one, and nowhere else;
 * only the lines read from it are kept, sealed on this device.
 *
 * A locked statement asks for its password in a sheet. A text field is right
 * for a password; it is never used for money.
 */

const SAMPLE_PATH = '/samples/adaeze-3-months-locked.pdf';
/** The sample's own password, said to whoever tries it. It opens nothing else. */
export const SAMPLE_PASSWORD = 'entole2026';

const PRIMARY =
  'flex h-14 w-full items-center justify-center gap-2.5 rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60';
const SECONDARY =
  'flex h-12 w-full items-center justify-center rounded-control border border-line bg-card font-strong text-ui text-ink transition-colors hover:border-mist active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60';

type Locked = { bytes: Uint8Array; sample: boolean; wrong: boolean };

export function StatementImport({
  importStatement,
  onRead,
  again = false,
}: {
  importStatement: (pdf: Uint8Array, password?: string) => Promise<StatementReading>;
  onRead: (reading: StatementReading) => void;
  /** A statement has been read before: the buttons say "another". */
  again?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [locked, setLocked] = useState<Locked | null>(null);
  const [password, setPassword] = useState('');

  async function read(bytes: Uint8Array, sample: boolean, withPassword?: string) {
    // The sheet steps aside the moment reading starts, and any earlier "that
    // password didn't open it" goes with it: the page says what is happening
    // now. A password that is wrong again brings the sheet back, saying so.
    setLocked(null);
    setReading(true);
    setProblem(null);
    try {
      const result = await importStatement(bytes, withPassword);
      setLocked(null);
      setPassword('');
      onRead(result);
    } catch (error) {
      if (error instanceof NearClientError && (error.code === 'needs_password' || error.code === 'wrong_password')) {
        setLocked({ bytes, sample, wrong: error.code === 'wrong_password' });
      } else {
        setLocked(null);
        setProblem(messageOf(error));
      }
    } finally {
      setReading(false);
    }
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    try {
      await read(new Uint8Array(await file.arrayBuffer()), false);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function trySample() {
    setProblem(null);
    try {
      const response = await fetch(SAMPLE_PATH);
      if (!response.ok) throw new Error('sample');
      await read(new Uint8Array(await response.arrayBuffer()), true);
    } catch {
      setProblem("We couldn't open the sample just now. Try again.");
    }
  }

  if (reading) {
    return (
      <div className="flex flex-col items-center border-y border-hairline py-8 text-center">
        <LogoLoader size={44} label="Reading your statement" />
        <p role="status" className="mt-4 font-strong text-prose text-ink">
          Reading in sealed hardware…
        </p>
        <p className="mt-1 max-w-[34ch] text-pretty font-body text-note text-slate">
          This can take a minute. Nobody can look inside while it reads, and nothing is kept there.
        </p>
      </div>
    );
  }

  return (
    <div>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => void pickFile(event.target.files?.[0])}
      />
      <button type="button" onClick={() => fileInput.current?.click()} className={PRIMARY}>
        <FileText size={20} strokeWidth={1.5} aria-hidden />
        {again ? 'Read another statement' : 'Read a bank statement'}
      </button>
      <button type="button" onClick={() => void trySample()} className={`mt-2.5 ${SECONDARY}`}>
        Try a sample statement
      </button>
      <p className="mt-2.5 text-pretty font-body text-note text-slate">
        The PDF your bank emails you. The sample is three months of someone else&apos;s made-up account; its password is{' '}
        <span className="font-strong text-ink">{SAMPLE_PASSWORD}</span>.
      </p>
      {problem ? (
        <p role="alert" className="mt-3 text-pretty font-body text-note text-halt">
          {problem}
        </p>
      ) : null}

      {locked ? (
        <GlassSheet label="Statement password" onDismiss={() => setLocked(null)}>
          <form
            className="pt-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (password) void read(locked.bytes, locked.sample, password);
            }}
          >
            <h2 className="font-display text-subhead text-ink">This statement is locked</h2>
            <p className="mt-1 text-pretty font-body text-note text-slate">
              Enter the password your bank sent with it. It goes to the reader with the file, and is not kept.
            </p>
            <label htmlFor="statement-password" className="mt-5 block font-strong text-note text-slate">
              Password
            </label>
            <input
              id="statement-password"
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={password}
              autoFocus
              onChange={(event) => {
                setPassword(event.target.value);
                // A new attempt starts clean: the old "didn't open it" is about the last one.
                if (locked.wrong) setLocked({ ...locked, wrong: false });
              }}
              className="mt-2 h-12 w-full rounded-control border-[1.5px] border-line bg-card px-4 font-strong text-ui text-ink outline-none focus:border-ink"
            />
            {locked.wrong ? (
              <p role="alert" className="mt-2 font-body text-note text-halt">
                That password didn&apos;t open it. Check it and try again.
              </p>
            ) : null}
            {locked.sample ? (
              <p className="mt-2 font-body text-note text-slate">
                The sample&apos;s password is <span className="font-strong text-ink">{SAMPLE_PASSWORD}</span>.
              </p>
            ) : null}
            <button type="submit" disabled={!password} className={`mt-5 ${PRIMARY}`}>
              Open and read it
            </button>
          </form>
        </GlassSheet>
      ) : null}
    </div>
  );
}

/**
 * What can be trusted about a reading: that it was read in sealed hardware,
 * each check that proves it, and whether the bank's own figures add up. Right
 * after a reading every check is listed; later, the kept record says whether
 * it was proven.
 */
export function ProofPanel({
  proof,
  read,
}: {
  proof: ProofSummary | null;
  read: Pick<StatementRead, 'status' | 'differenceMinor' | 'proven'>;
}) {
  const check = balanceCheckWords(read);
  const lines = proof ? proofLines(proof) : [];
  const proven = proof ? proof.proven : read.proven;

  return (
    <section aria-label="How this statement was read" className="border-y border-hairline py-4">
      <p className="flex items-start gap-2.5 font-strong text-ui text-ink">
        <Mark ok={proven} />
        {proven
          ? 'Read on NEAR AI Cloud in sealed hardware · proof checked'
          : 'We could not prove this reading was sealed. Treat its figures with care.'}
      </p>
      {lines.length ? (
        <ul className="mt-2.5 flex flex-col gap-1.5 pl-[30px]">
          {lines.map((line) => (
            <li key={line.id} className="flex items-start gap-2 font-body text-note text-slate">
              {line.passed ? (
                <Check size={15} strokeWidth={2} aria-label="Passed" className="mt-0.5 flex-none text-settled" />
              ) : (
                <X size={15} strokeWidth={2} aria-label="Did not pass" className="mt-0.5 flex-none text-halt" />
              )}
              {line.words}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 flex items-start gap-2.5 font-strong text-ui text-ink">
        <Mark ok={check.ok} />
        {check.words}
      </p>
    </section>
  );
}

function Mark({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-pill bg-settled-wash text-settled">
      <Check size={13} strokeWidth={2.5} aria-hidden />
    </span>
  ) : (
    <span className="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-pill bg-halt-wash text-halt">
      <X size={13} strokeWidth={2.5} aria-hidden />
    </span>
  );
}
