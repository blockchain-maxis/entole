import * as Haptics from 'expo-haptics';
import { ChevronDown, MessageCircleQuestion, Search } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HELP_ARTICLES, HELP_CATEGORIES, rankArticles, type HelpArticle } from '@entole/core/help';
import { token } from '@entole/tokens';

import { Button } from '@/components/ui/Button';
import { FeedbackSheet } from '@/components/ui/FeedbackSheet';
import { Header } from '@/components/ui/Header';
import { HelpBot } from '@/components/ui/HelpBot';
import { SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { SheetLayer } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { GlassHost } from '@/lib/blur';
import { useThemeColors } from '@/lib/theme';

/**
 * The help center: the questions people ask, each with its answer opening
 * underneath, and a help button floating at the bottom right that opens the
 * support bot. The list and the bot read the same articles
 * (`packages/core/help.ts`), so they can never disagree.
 */
export default function Help() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [botOpen, setBotOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const positions = useRef<Record<string, number>>({});

  const found = useMemo(() => {
    const text = query.trim();
    return text.length >= 2 ? new Set(rankArticles(text, 12).map((entry) => entry.article.id)) : null;
  }, [query]);

  const groups = HELP_CATEGORIES.map((category) => ({
    ...category,
    articles: HELP_ARTICLES.filter(
      (article) => article.category === category.id && (found === null || found.has(article.id)),
    ),
  })).filter((group) => group.articles.length > 0);

  function toggle(id: string) {
    void Haptics.selectionAsync();
    setOpen((current) => (current === id ? null : id));
  }

  /** An article the bot pointed to: closes the bot, opens the answer and scrolls to it. */
  function show(id: string) {
    setBotOpen(false);
    setQuery('');
    setOpen(id);
    setTimeout(() => scroller.current?.scrollTo({ y: Math.max(0, (positions.current[id] ?? 0) - 90), animated: true }), 350);
  }

  return (
    <Screen edges={{ bottom: false }}>
      <GlassHost
        sheet={
          botOpen || feedbackOpen ? (
            <SheetLayer>
              {botOpen ? (
                <HelpBot
                  onDismiss={() => setBotOpen(false)}
                  onOpenArticle={show}
                  onFeedback={() => {
                    setBotOpen(false);
                    setFeedbackOpen(true);
                  }}
                />
              ) : (
                <FeedbackSheet onDismiss={() => setFeedbackOpen(false)} />
              )}
            </SheetLayer>
          ) : null
        }
      >
      <Header title="Help center" />

      <ScrollView
        ref={scroller}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="font-body text-ui text-slate">
          Quick answers to what people ask most. Can’t find yours? Tap the help button and ask.
        </Text>

        <View className="mt-4 flex-row items-center gap-3 rounded-control border-[1.5px] border-line bg-card px-4">
          <Search size={18} strokeWidth={1.75} color={colors.slate} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search the help"
            placeholderTextColor={token.mist}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search the help"
            className="h-12 min-w-0 flex-1 font-body text-ui text-ink"
            style={{ padding: 0 }}
          />
        </View>

        {groups.length === 0 ? (
          <View className="mt-8">
            <Text className="font-display text-subhead text-ink">Nothing matches that</Text>
            <Text className="mt-1.5 font-body text-ui text-slate">
              Try other words, or tap the help button and ask in your own.
            </Text>
          </View>
        ) : (
          groups.map((group) => (
            <View key={group.id}>
              <SectionHeading title={group.title} />
              <View className="gap-2">
                {group.articles.map((article) => (
                  <Question
                    key={article.id}
                    article={article}
                    expanded={open === article.id}
                    onToggle={() => toggle(article.id)}
                    onLayout={(y) => {
                      positions.current[article.id] = y;
                    }}
                  />
                ))}
              </View>
            </View>
          ))
        )}

        <View className="mt-10 rounded-card border border-line bg-card p-5">
          <Text className="font-display text-subhead text-ink">Still stuck?</Text>
          <Text className="mt-1.5 font-body text-ui text-slate">
            Ask the support bot, or tell us what happened and a person will read it.
          </Text>
          <View className="mt-4 flex-row gap-2.5">
            <Button label="Ask the bot" onPress={() => setBotOpen(true)} />
            <Button label="Send feedback" variant="secondary" onPress={() => setFeedbackOpen(true)} />
          </View>
        </View>
      </ScrollView>

      {botOpen || feedbackOpen ? null : (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(120)}
          pointerEvents="box-none"
          style={{ position: 'absolute', right: 20, bottom: Math.max(insets.bottom, 16) + 16 }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ask for help"
            onPress={() => {
              void Haptics.selectionAsync();
              setBotOpen(true);
            }}
            className="h-14 w-14 items-center justify-center rounded-pill bg-ink shadow-floating active:scale-95"
          >
            <MessageCircleQuestion size={26} strokeWidth={1.75} color={colors.paper} />
          </Pressable>
        </Animated.View>
      )}

      </GlassHost>
    </Screen>
  );
}

/** One question: a card that opens to its answer. */
function Question({
  article,
  expanded,
  onToggle,
  onLayout,
}: {
  article: HelpArticle;
  expanded: boolean;
  onToggle: () => void;
  onLayout: (y: number) => void;
}) {
  const colors = useThemeColors();
  return (
    <Animated.View
      layout={LinearTransition.duration(180)}
      onLayout={(event) => onLayout(event.nativeEvent.layout.y)}
      className="overflow-hidden rounded-control border border-line bg-card"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        className="flex-row items-center justify-between gap-4 px-4 py-4 active:bg-press"
      >
        <Text className="min-w-0 flex-1 font-strong text-ui text-ink">{article.question}</Text>
        <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
          <ChevronDown size={18} strokeWidth={1.75} color={colors.mist} />
        </View>
      </Pressable>
      {expanded ? (
        <Animated.View entering={FadeIn.duration(180)} className="border-t border-hairline px-4 pb-4 pt-3">
          <Text className="font-body text-ui text-slate">{article.answer}</Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
