import * as Clipboard from 'expo-clipboard';
import { ChevronRight, CreditCard, Landmark, ScanLine, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { DEPOSIT_SOURCES, depositSourceLabel, type DepositSource } from '@entole/core/deposit-sources';
import { token } from '@entole/tokens';

import { useThemeColors } from '@/lib/theme';

import { Button } from './Button';
import { Skeleton } from './Skeleton';
import { Text } from './Text';

/** Something fetched for a step: on its way, refused in plain words, or here. */
export type Loaded<T> = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; value: T };

function WayRow({
  icon: Icon,
  title,
  hint,
  onPress,
  disabled = false,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const colors = useThemeColors();
  const inactive = disabled || !onPress;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive }}
      disabled={inactive}
      onPress={onPress}
      className={`flex-row items-center gap-3.5 rounded-row border border-line bg-card px-4 py-3.5 active:border-mist ${
        inactive ? 'opacity-60' : ''
      }`}
    >
      <View className="h-10 w-10 items-center justify-center rounded-control bg-indigo-wash">
        <Icon size={20} strokeWidth={1.5} color={colors.indigo.DEFAULT} />
      </View>
      <View className="flex-1">
        <Text className="font-strong text-body text-ink">{title}</Text>
        <Text className="mt-0.5 font-body text-label-sm text-slate">{hint}</Text>
      </View>
      {onPress ? <ChevronRight size={18} strokeWidth={1.5} color={colors.mist} /> : null}
    </Pressable>
  );
}

/** The three ways real money comes in. One is not open yet, and says so. */
export function WaysToAdd({
  disabled,
  bankOpen,
  onAnotherApp,
  onCard,
  onBank,
}: {
  disabled: boolean;
  bankOpen: boolean;
  onAnotherApp: () => void;
  onCard: () => void;
  onBank: () => void;
}) {
  return (
    <View>
      <Text className="pb-3 pt-7 font-strong text-body-lg text-ink">How do you want to add money?</Text>
      <View className="gap-2.5">
        <WayRow
          icon={ScanLine}
          title="From another app"
          hint="Send dollars you already hold somewhere else."
          onPress={onAnotherApp}
          disabled={disabled}
        />
        <WayRow icon={CreditCard} title="Card" hint="Debit or credit card. $20 or more." onPress={onCard} disabled={disabled} />
        {bankOpen ? (
          <WayRow icon={Landmark} title="Bank transfer" hint="Pay in naira from your bank." onPress={onBank} disabled={disabled} />
        ) : (
          <WayRow icon={Landmark} title="Bank transfer" hint="In naira. Coming soon." />
        )}
      </View>
    </View>
  );
}

/**
 * Money from an app the person already uses. They say what they are sending
 * and get a code to send it to. The code is an address, so it is only ever a
 * picture to scan or something to copy: it is never written out. The phone
 * twin of the same step on the web add-money page.
 */
export function FromAnotherApp({
  source,
  code,
  onPick,
}: {
  source: DepositSource | null;
  code: Loaded<string> | null;
  onPick: (source: DepositSource) => void;
}) {
  const colors = useThemeColors();
  const [copied, setCopied] = useState(false);

  async function copy(value: string) {
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  if (!source || code?.state === 'failed') {
    return (
      <View>
        <Text className="pb-1 pt-7 font-strong text-body-lg text-ink">What are you sending?</Text>
        <Text className="pb-3 font-body text-label-sm text-slate">
          Pick what you hold in the other app. It arrives here as dollars in your balance.
        </Text>
        {code?.state === 'failed' ? (
          <Text accessibilityRole="alert" className="pb-3 font-body text-label-sm text-halt">
            {code.message}
          </Text>
        ) : null}
        <View className="gap-2">
          {DEPOSIT_SOURCES.map((option) => (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              onPress={() => onPick(option)}
              className="flex-row items-center justify-between rounded-row border border-line bg-card px-4 py-3.5 active:border-mist"
            >
              <Text className="font-strong text-body text-ink">{depositSourceLabel(option)}</Text>
              <ChevronRight size={18} strokeWidth={1.5} color={colors.mist} />
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  const label = depositSourceLabel(source);

  return (
    <View className="pt-7">
      <Text className="font-strong text-body-lg text-ink">Send {label} to this code</Text>
      <Text className="mt-1 font-body text-label-sm text-slate">
        Scan it from the app you are sending from, or copy it and paste it there. Send $1 or more.
      </Text>

      <View className="mt-5 items-center">
        {code?.state === 'ready' ? (
          // Always dark on white, in either theme: many scanners will not read
          // a light-on-dark square.
          <View
            accessibilityRole="image"
            accessibilityLabel={`Code to send ${label} to`}
            className="rounded-row border border-hairline bg-white p-3"
          >
            <QRCode value={code.value} size={208} color={token.ink} backgroundColor={token.white} />
          </View>
        ) : (
          <Skeleton className="h-[232px] w-[232px] rounded-row" />
        )}
      </View>

      <View className="mt-4 flex-row justify-center">
        <Button
          label={copied ? 'Copied' : 'Copy code'}
          variant="secondary"
          width="hug"
          disabled={code?.state !== 'ready'}
          onPress={() => {
            if (code?.state === 'ready') void copy(code.value);
          }}
        />
      </View>

      <Text className="mt-4 font-body text-caption text-slate">
        Only send {label} to it. Something else sent here may not arrive and may not be returned.
      </Text>
    </View>
  );
}

/** Card, paid on the partner's page. Nothing is priced here, so nothing is quoted. */
export function CardStep({ card }: { card: Loaded<string> | null }) {
  return (
    <View className="pt-7">
      <Text className="font-strong text-body-lg text-ink">Pay by card</Text>
      {card?.state === 'failed' ? (
        <Text accessibilityRole="alert" className="mt-2 font-body text-label-sm text-halt">
          {card.message}
        </Text>
      ) : card?.state === 'ready' ? (
        <View>
          <Text className="mt-1 font-body text-label-sm text-slate">
            You pay on our card partner&apos;s page, which opens next. It shows the amount, their fee and what you get
            before you pay. $20 or more.
          </Text>
          <Text className="mt-3 font-body text-label-sm text-slate">
            Come back here afterwards. Your balance changes once the money has arrived.
          </Text>
        </View>
      ) : (
        <View accessibilityLabel="Getting the card page ready">
          <Skeleton className="mt-3 h-4 w-full rounded-md" />
          <Skeleton className="mt-2.5 h-4 w-3/4 rounded-md" />
        </View>
      )}
    </View>
  );
}
