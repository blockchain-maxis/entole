import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';

import { formatNaira, kobo } from '@entole/core/money';
import {
  parsePayrollBytes,
  payrollTemplateCsv,
  type PayrollImport,
  type PayrollRow,
} from '@entole/core/payroll-import';
import { useBackend } from '@entole/core/backend';
import type { Staff } from '@entole/core/records';

import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { LinkRow, SectionHeading } from '@/components/ui/Rows';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { UnavailableNote } from '@/components/ui/UnavailableNote';
import { peopleWords } from '@/lib/payroll-run';
import { readFileBytes } from '@/lib/read-file';
import { plainMessage } from '@/lib/send';
import { useStaff } from '@/lib/staff';
import { useThemeColors } from '@/lib/theme';

type PickedFile = { uri: string; name: string };
type Picker = {
  getDocumentAsync(options: { type: string | string[]; copyToCacheDirectory: boolean; multiple: boolean }): Promise<{
    canceled: boolean;
    assets?: PickedFile[] | null;
  }>;
};

/**
 * The document picker is a native module. A build made before it was added does
 * not contain it, and importing it there throws — so it is loaded inside a
 * `try`, and its absence is a message, not a crash.
 */
function loadPicker(): Picker | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-document-picker') as Picker;
  } catch {
    return null;
  }
}

const UPDATE_NEEDED = 'Importing needs the updated app — you can add people by hand meanwhile.';

type Phase =
  | { kind: 'idle' }
  | { kind: 'reading'; fileName: string }
  | { kind: 'review'; fileName: string; result: PayrollImport }
  | { kind: 'saving'; fileName: string; result: PayrollImport }
  | { kind: 'unavailable' }
  | { kind: 'failed'; message: string };

/** Rows from the file into the roster: a person already there (same code) is
 * updated in place, anyone else is added. */
function mergeRows(rows: PayrollRow[], roster: Staff[], now: Date): { people: Staff[]; added: number; updated: number } {
  const byCode = new Map(roster.map((person) => [person.code, person]));
  let added = 0;
  let updated = 0;
  const people = rows.map((row, index): Staff => {
    const current = byCode.get(row.code);
    if (current) updated += 1;
    else added += 1;
    return {
      id: current?.id ?? `st-${now.getTime()}-${index}`,
      name: row.name,
      code: row.code,
      payAmountMinor: row.amountMinor,
      cadence: current?.cadence ?? null,
      ...((row.note ?? current?.note) ? { note: (row.note ?? current?.note)! } : {}),
      createdAt: current?.createdAt ?? now.toISOString(),
    };
  });
  return { people, added, updated };
}

/**
 * Bring a team in from a spreadsheet. Pick a .csv, .xlsx or .xls with a Name,
 * a Payment code (or their link) and an Amount for each person; the file is
 * read on this phone and shown back to you, row by row, before anything is
 * saved. Rows that can't be used say why. Nothing is paid here.
 */
export default function ImportPayroll() {
  const router = useRouter();
  const colors = useThemeColors();
  const { source } = useBackend();
  const team = useStaff();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [sampleNote, setSampleNote] = useState<string | null>(null);

  async function choose() {
    const picker = loadPicker();
    if (!picker) {
      setPhase({ kind: 'unavailable' });
      return;
    }
    try {
      const picked = await picker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      const file = picked.canceled ? null : picked.assets?.[0];
      if (!file) return;
      setPhase({ kind: 'reading', fileName: file.name });
      const bytes = await readFileBytes(file.uri);
      setPhase({ kind: 'review', fileName: file.name, result: parsePayrollBytes(bytes) });
    } catch (error) {
      setPhase({ kind: 'failed', message: plainMessage(error, "We couldn't open that file. Try another one.") });
    }
  }

  async function shareSample() {
    setSampleNote(null);
    try {
      await Share.share({ title: 'Payroll sample.csv', message: payrollTemplateCsv() });
    } catch {
      setSampleNote("We couldn't open sharing on this phone.");
    }
  }

  const review = phase.kind === 'review' || phase.kind === 'saving' ? phase : null;
  const merge = useMemo(
    () => (review ? mergeRows(review.result.rows, team.staff, new Date()) : null),
    [review, team.staff],
  );

  async function save() {
    if (phase.kind !== 'review' || !merge || merge.people.length === 0) return;
    setPhase({ kind: 'saving', fileName: phase.fileName, result: phase.result });
    try {
      await source.saveManyStaff(merge.people);
      router.replace('/business/payroll');
    } catch (error) {
      setPhase({ kind: 'failed', message: plainMessage(error, "We couldn't save those people. Try again.") });
    }
  }

  const problems = review?.result.problems ?? [];
  const errors = problems.filter((problem) => problem.kind === 'error');

  return (
    <Screen>
      <Header title="Import from a spreadsheet" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, paddingTop: 4 }}
      >
        {phase.kind === 'reading' ? (
          <View className="gap-2.5">
            <Text className="px-1 pb-1 font-body text-label text-slate">Reading {phase.fileName}</Text>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </View>
        ) : review ? (
          <View>
            <Text numberOfLines={1} className="px-1 font-body text-label text-slate">
              {review.fileName}
            </Text>
            <Text className="mt-1 px-1 font-strong text-title text-ink">
              {review.result.rows.length > 0
                ? `${peopleWords(review.result.rows.length)} ready`
                : 'Nobody could be read from this file'}
            </Text>
            {merge && review.result.rows.length > 0 ? (
              <Text className="mt-1 px-1 font-body text-label text-slate">
                {merge.added > 0 ? `${merge.added} new` : 'No new people'}
                {merge.updated > 0 ? `, ${merge.updated} you already have will be updated` : ''}. Nothing is paid
                until you run payroll.
              </Text>
            ) : null}

            {problems.length > 0 ? (
              <View className="mt-6">
                <SectionHeading
                  title={errors.length > 0 ? `${errors.length} to fix in the file` : 'Worth a look'}
                />
                <View className="gap-2">
                  {problems.map((problem, index) => (
                    <View
                      key={`${problem.line}-${index}`}
                      className="rounded-control border border-line bg-card px-4 py-3"
                    >
                      <Text
                        className={`font-body text-label-sm ${problem.kind === 'error' ? 'text-halt' : 'text-caution'}`}
                      >
                        {problem.message}
                      </Text>
                    </View>
                  ))}
                </View>
                {errors.length > 0 && review.result.rows.length > 0 ? (
                  <Text className="mt-2 px-1 font-body text-caption text-slate">
                    Rows with a problem are left out. Fix them in the file and choose it again, or use the
                    rest now.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {review.result.rows.length > 0 ? (
              <View className="mt-6">
                <SectionHeading title="Who will be added" />
                <View className="gap-2">
                  {review.result.rows.map((row) => (
                    <View
                      key={`${row.line}-${row.code}`}
                      className="flex-row items-center gap-3 rounded-row border border-line bg-card px-4 py-3"
                    >
                      <Check size={16} strokeWidth={2} color={colors.settled.DEFAULT} />
                      <View className="min-w-0 flex-1">
                        <Text numberOfLines={1} className="font-strong text-body-sm text-ink">
                          {row.name}
                        </Text>
                        {row.note ? (
                          <Text numberOfLines={1} className="font-body text-caption text-slate">
                            {row.note}
                          </Text>
                        ) : null}
                      </View>
                      <Text tabular className="font-strong text-body-sm text-ink">
                        {formatNaira(kobo(row.amountMinor))}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        ) : (
          <View>
            {phase.kind === 'unavailable' ? (
              <View className="mb-5">
                <UnavailableNote title="Importing isn't available in this version" body={UPDATE_NEEDED} />
                <View className="mt-3">
                  <LinkRow label="Add someone by hand" onPress={() => router.push('/business/payroll/add')} />
                </View>
              </View>
            ) : null}
            {phase.kind === 'failed' ? (
              <View className="mb-5 rounded-control border border-line bg-card px-4 py-3.5">
                <Text className="font-strong text-body-sm text-halt">We couldn&apos;t use that file</Text>
                <Text className="mt-1 font-body text-label-sm text-slate">{phase.message}</Text>
              </View>
            ) : null}

            <Text className="px-1 font-strong text-title text-ink">Bring your team in from a spreadsheet</Text>
            <Text className="mt-2 px-1 font-body text-body-sm text-slate">
              Choose an Excel or CSV file with one row per person and these columns:
            </Text>
            <View className="mt-4 rounded-row border border-line bg-card px-4 py-4">
              <ColumnLine name="Name" note="who you are paying" />
              <ColumnLine name="Payment code" note="their code, or the link they shared" />
              <ColumnLine name="Amount" note="in naira, like 150,000" />
              <ColumnLine name="Note" note="optional, like September salary" last />
            </View>
            <Text className="mt-3 px-1 font-body text-caption text-slate">
              The file is read on this phone. You review every row before anything is saved.
            </Text>

            <View className="mt-7 gap-2.5">
              <LinkRow label="Get a sample file" onPress={() => void shareSample()} />
              {sampleNote ? <Text className="px-1 font-body text-caption text-halt">{sampleNote}</Text> : null}
              <Text className="px-1 font-body text-caption text-slate">
                Shares the columns as text you can paste into a spreadsheet or save as a .csv.
              </Text>
              <View className="mt-2">
                <UnavailableNote
                  title="Connect Google Sheets — coming soon"
                  body="This needs a Google sign-in that isn't set up yet. Import a file for now."
                />
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      <ActionBar>
        {review ? (
          <>
            <Button
              label="Choose another file"
              variant="secondary"
              disabled={phase.kind === 'saving'}
              onPress={() => void choose()}
            />
            <Button
              label={merge && merge.people.length > 0 ? `Use these ${merge.people.length}` : 'Use these'}
              busy={phase.kind === 'saving'}
              disabled={!merge || merge.people.length === 0 || team.status === 'loading'}
              onPress={() => void save()}
            />
          </>
        ) : (
          <Button
            label={phase.kind === 'failed' ? 'Choose another file' : 'Choose a file'}
            disabled={phase.kind === 'reading'}
            onPress={() => void choose()}
          />
        )}
      </ActionBar>
    </Screen>
  );
}

function ColumnLine({ name, note, last = false }: { name: string; note: string; last?: boolean }) {
  return (
    <View className={last ? '' : 'mb-3'}>
      <Text className="font-strong text-body-sm text-ink">{name}</Text>
      <Text className="font-body text-caption text-slate">{note}</Text>
    </View>
  );
}
