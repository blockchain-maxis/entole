import { useRouter } from 'expo-router';
import { FileSpreadsheet, UserPlus } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';

import { formatNaira, kobo } from '@entole/core/money';
import { initialsFor } from '@entole/core/profile';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { SectionHeading } from '@/components/ui/Rows';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { UnavailableNote } from '@/components/ui/UnavailableNote';
import { peopleWords } from '@/lib/payroll-run';
import { cadenceWord, useStaff } from '@/lib/staff';
import { useThemeColors } from '@/lib/theme';

function AddRow({
  label,
  hint,
  Icon,
  onPress,
}: {
  label: string;
  hint: string;
  Icon: typeof UserPlus;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-3.5 rounded-row border border-line bg-card px-4 py-3.5 active:border-mist"
    >
      <View className="h-10 w-10 items-center justify-center rounded-chip bg-track">
        <Icon size={19} strokeWidth={1.5} color={colors.ink} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-strong text-body-sm text-ink">{label}</Text>
        <Text className="font-body text-caption text-slate">{hint}</Text>
      </View>
    </Pressable>
  );
}

/**
 * Your team and the button that pays them. The people are records on this
 * phone — a name, a payment code, and optionally what you usually pay — and
 * they arrive by hand or from a spreadsheet. "Run payroll" is the next screen:
 * you choose who to pay this time, see the real total and fees, and confirm.
 */
export default function Payroll() {
  const router = useRouter();
  const team = useStaff();
  const loading = team.status === 'loading';
  const withPay = team.staff.filter((person) => person.payAmountMinor);
  const regularMinor = withPay.reduce((sum, person) => sum + (person.payAmountMinor ?? 0), 0);

  return (
    <Screen>
      <Header title="Pay staff" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, paddingTop: 2 }}
      >
        {loading ? (
          <View className="gap-2.5">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </View>
        ) : team.status === 'failed' ? (
          <View className="rounded-row border border-line bg-card px-4 py-4">
            <Text className="font-strong text-body-sm text-ink">We couldn&apos;t load your team</Text>
            <Text className="mt-1 font-body text-label-sm text-slate">They are saved on this phone. Try again.</Text>
            <View className="mt-3 flex-row">
              <Button label="Try again" variant="secondary" width="hug" onPress={() => void team.reload()} />
            </View>
          </View>
        ) : team.staff.length === 0 ? (
          <View className="px-1 pt-1">
            <Text className="font-strong text-title text-ink">Add the people you pay</Text>
            <Text className="mt-2 font-body text-body-sm text-slate">
              Put each person in once, with their payment code. Then paying everyone is one screen, and you
              see the total and the fees before anything moves.
            </Text>
          </View>
        ) : (
          <View>
            <View className="px-1">
              <Text className="font-body text-label text-slate">{peopleWords(team.staff.length)}</Text>
              {regularMinor > 0 ? (
                <Text tabular className="mt-1 font-strong text-amount text-ink">
                  {formatNaira(kobo(regularMinor))}
                </Text>
              ) : null}
              {regularMinor > 0 ? (
                <Text className="mt-0.5 font-body text-caption text-slate">
                  in regular pay across {peopleWords(withPay.length)}
                </Text>
              ) : null}
            </View>

            <View className="mt-5 gap-2.5">
              {team.staff.map((person) => (
                <Pressable
                  key={person.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${person.name}`}
                  onPress={() => router.push({ pathname: '/business/payroll/add', params: { id: person.id } })}
                  className="flex-row items-center gap-3 rounded-row border border-line bg-card px-3.5 py-3 active:border-mist"
                >
                  <Avatar initials={initialsFor(person.name)} tone={1} size="lg" />
                  <View className="min-w-0 flex-1">
                    <Text numberOfLines={1} className="font-strong text-body text-ink">
                      {person.name}
                    </Text>
                    <Text numberOfLines={1} className="mt-0.5 font-body text-caption text-slate">
                      {person.note ?? 'No note'}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text tabular className="font-strong text-body-sm text-ink">
                      {person.payAmountMinor ? formatNaira(kobo(person.payAmountMinor)) : 'No amount'}
                    </Text>
                    {cadenceWord(person.cadence) ? (
                      <Text className="font-body text-caption text-slate">{cadenceWord(person.cadence)}</Text>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <SectionHeading title="Add people" className="pt-8" />
        <View className="gap-2.5">
          <AddRow
            label="Add someone by hand"
            hint="A name and their payment code"
            Icon={UserPlus}
            onPress={() => router.push('/business/payroll/add')}
          />
          <AddRow
            label="Import a spreadsheet"
            hint="Excel or CSV, one row per person"
            Icon={FileSpreadsheet}
            onPress={() => router.push('/business/payroll/import')}
          />
          <UnavailableNote
            title="Connect Google Sheets — coming soon"
            body="This needs a Google sign-in that isn't set up yet. Import a file for now."
          />
        </View>
      </ScrollView>

      <ActionBar>
        {team.staff.length === 0 ? (
          <Button
            label="Add a person"
            disabled={loading}
            onPress={() => router.push('/business/payroll/add')}
          />
        ) : (
          <Button label="Run payroll" onPress={() => router.push('/business/payroll/run')} />
        )}
      </ActionBar>
    </Screen>
  );
}
