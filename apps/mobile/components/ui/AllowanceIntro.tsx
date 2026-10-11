import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { useAssistant } from '@/lib/assistant';

import { Button } from './Button';
import { Text } from './Text';

/**
 * What the allowances section shows before there is one. It teaches the idea
 * with a single example of how an allowance reads, in the assistant's blue,
 * and leads to the next real step: writing the first allowance if the
 * assistant is on, turning it on if it is off (it is a setting, never a
 * default). There is nothing to dismiss; it goes when an allowance exists.
 */
export function AllowanceIntro() {
  const router = useRouter();
  const assistant = useAssistant();

  return (
    <View className="rounded-card bg-indigo-wash p-5">
      <Text className="font-body text-note text-slate">An allowance reads like this</Text>
      <Text className="mt-2 font-display-plain text-subhead text-indigo">
        Send ₦50,000 to Mum every month, never more than ₦100,000 a month.
      </Text>
      <Text className="mt-3 font-body text-ui text-slate">
        {assistant.enabled
          ? 'Write one, and the assistant can pay inside it and never past it.'
          : 'You write it once. The assistant can then pay inside it and never past it. It is off until you turn it on.'}
      </Text>
      {assistant.loading ? null : (
        <View className="mt-4 flex-row">
          {assistant.enabled ? (
            <Button label="Write your first allowance" width="hug" onPress={() => router.push('/rules/new')} />
          ) : (
            <Button label="Turn on the assistant" width="hug" onPress={() => router.push('/assistant')} />
          )}
        </View>
      )}
    </View>
  );
}
