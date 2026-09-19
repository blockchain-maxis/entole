import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { ContactRow, SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { corridorsFor } from '@entole/core/pay-hub';
import { useStore } from '@entole/core/store';

/** Pick the country first, then the person — the send flow itself is unchanged. */
export default function SendAbroad() {
  const router = useRouter();
  const store = useStore();
  const loading = store.status === 'loading';

  const corridors = useMemo(() => corridorsFor(store.contacts), [store.contacts]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = corridors.find((corridor) => corridor.id === selectedId) ?? corridors[0];

  return (
    <Screen>
      <Header title="Send abroad" trailing={<PauseButton />} />

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View className="gap-2">
            <RowSkeleton />
            <RowSkeleton />
          </View>
        ) : selected ? (
          <>
            <SectionHeading title="Send to" />
            <View className="flex-row flex-wrap gap-2 pb-6">
              {corridors.map((corridor) => {
                const active = corridor.id === selected.id;
                return (
                  <Pressable
                    key={corridor.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setSelectedId(corridor.id)}
                    className={`rounded-pill border px-4 py-2.5 ${
                      active ? 'border-indigo bg-indigo-wash' : 'border-line bg-card active:border-mist'
                    }`}
                  >
                    <Text className={`font-strong text-label ${active ? 'text-indigo' : 'text-ink'}`}>
                      Nigeria → {corridor.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <SectionHeading title="Who are you sending to?" />
            <View className="gap-2">
              {selected.contacts.map((contact) => (
                <ContactRow
                  key={contact.id}
                  contact={contact}
                  trailing={<Text className="font-strong text-caption-sm text-indigo">Send</Text>}
                  onPress={() => router.push({ pathname: '/send', params: { contactId: contact.id } })}
                />
              ))}
            </View>
          </>
        ) : (
          <View className="rounded-control border border-line bg-card px-4 py-3.5">
            <Text className="font-strong text-body-sm text-ink">No countries yet</Text>
            <Text className="mt-1 font-body text-label-sm text-slate">
              Once you have a contact abroad, their country shows up here.
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
