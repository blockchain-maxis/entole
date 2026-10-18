import * as Haptics from 'expo-haptics';
import { ArrowUp, ThumbsDown, ThumbsUp } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from 'react-native';

import { HELP_QUESTION_MAX, helpArticle, type HelpHistory } from '@entole/core/help';
import { token } from '@entole/tokens';

import { askHelp, rateHelp } from '@/lib/support';
import { useThemeColors } from '@/lib/theme';

import { Sheet } from './Sheet';
import { Skeleton } from './Skeleton';
import { Text } from './Text';

type Turn =
  | { from: 'you'; text: string }
  | { from: 'bot'; text: string; id?: string; articles: string[]; covered: boolean; rated?: boolean };

const GREETING =
  'Hi, I’m here to help with Entole. Ask me about sending money, adding money, allowances or your account.';

const STARTERS = ['How do I add money?', 'What is an allowance?', 'Is my money safe?', 'I lost my phone'];

const UNREACHABLE = 'I couldn’t reach the help just now. Check your connection and ask again.';

/**
 * The support bot, in a glass sheet over the help center. It answers from the
 * help articles and from nothing else, so it can say "I'm not sure" and point
 * to a person instead of guessing. It sees no account and can do nothing but
 * answer. Each answer can be marked helpful or not, and the questions nothing
 * covered are kept (without who asked) so someone can write the article.
 */
export function HelpBot({
  onDismiss,
  onOpenArticle,
  onFeedback,
}: {
  onDismiss: () => void;
  onOpenArticle: (id: string) => void;
  onFeedback: () => void;
}) {
  const colors = useThemeColors();
  const [turns, setTurns] = useState<Turn[]>([{ from: 'bot', text: GREETING, articles: [], covered: true }]);
  const [typed, setTyped] = useState('');
  const [thinking, setThinking] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const live = useRef(true);

  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  async function ask(question: string) {
    const text = question.replace(/\s+/g, ' ').trim().slice(0, HELP_QUESTION_MAX);
    if (!text || thinking) return;
    setTyped('');
    const history: HelpHistory = turns
      .slice(1)
      .slice(-6)
      .map((turn) => ({ from: turn.from, text: turn.text }));
    setTurns((current) => [...current, { from: 'you', text }]);
    setThinking(true);
    const answer = await askHelp(text, history);
    if (!live.current) return;
    setThinking(false);
    setTurns((current) => [
      ...current,
      answer
        ? { from: 'bot', text: answer.answer, id: answer.id, articles: answer.articles, covered: answer.by !== 'none' }
        : { from: 'bot', text: UNREACHABLE, articles: [], covered: true, rated: true },
    ]);
  }

  function rate(index: number, helpful: boolean) {
    const turn = turns[index];
    if (!turn || turn.from !== 'bot' || !turn.id || turn.rated) return;
    void Haptics.selectionAsync();
    void rateHelp(turn.id, helpful);
    setTurns((current) => current.map((entry, at) => (at === index && entry.from === 'bot' ? { ...entry, rated: true } : entry)));
  }

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1" pointerEvents="box-none">
      <Sheet glass onDismiss={onDismiss}>
        <Text className="font-strong text-note text-slate">Support</Text>
        <Text accessibilityRole="header" className="mt-0.5 font-display text-heading text-ink">
          Ask for help
        </Text>

        <ScrollView
          ref={scroller}
          className="mt-3 max-h-[320px]"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        >
          <View className="gap-3 pb-1">
            {turns.map((turn, index) =>
              turn.from === 'you' ? (
                <View key={index} className="items-end">
                  <View className="max-w-[85%] rounded-card rounded-br-[6px] bg-ink px-4 py-3">
                    <Text className="font-body text-ui text-paper">{turn.text}</Text>
                  </View>
                </View>
              ) : (
                <View key={index} className="items-start">
                  <View className="max-w-[92%] rounded-card rounded-bl-[6px] border border-line bg-card/80 px-4 py-3">
                    <Text className="font-body text-ui text-ink">{turn.text}</Text>

                    {turn.articles.length > 0 ? (
                      <View className="mt-2.5 flex-row flex-wrap gap-2">
                        {turn.articles.map((id) => {
                          const article = helpArticle(id);
                          return article ? (
                            <Pressable
                              key={id}
                              accessibilityRole="button"
                              accessibilityLabel={`Read: ${article.question}`}
                              onPress={() => onOpenArticle(id)}
                              className="rounded-pill border border-line bg-paper px-3 py-1.5 active:bg-press"
                            >
                              <Text numberOfLines={1} className="max-w-[220px] font-strong text-note text-ink">
                                {article.question}
                              </Text>
                            </Pressable>
                          ) : null;
                        })}
                      </View>
                    ) : null}

                    {!turn.covered ? (
                      <Pressable accessibilityRole="button" onPress={onFeedback} className="mt-2.5 self-start">
                        <Text className="font-strong text-note text-ink underline">Send us a message</Text>
                      </Pressable>
                    ) : null}
                  </View>

                  {turn.id ? (
                    <View className="mt-1.5 flex-row items-center gap-1 pl-1">
                      {turn.rated ? (
                        <Text className="font-body text-note text-slate">Thanks, that helps us.</Text>
                      ) : (
                        <>
                          <Text className="mr-1 font-body text-note text-slate">Did that help?</Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Yes, that helped"
                            hitSlop={8}
                            onPress={() => rate(index, true)}
                            className="h-8 w-8 items-center justify-center rounded-pill active:bg-press"
                          >
                            <ThumbsUp size={16} strokeWidth={1.75} color={colors.slate} />
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="No, that did not help"
                            hitSlop={8}
                            onPress={() => rate(index, false)}
                            className="h-8 w-8 items-center justify-center rounded-pill active:bg-press"
                          >
                            <ThumbsDown size={16} strokeWidth={1.75} color={colors.slate} />
                          </Pressable>
                        </>
                      )}
                    </View>
                  ) : null}
                </View>
              ),
            )}

            {thinking ? (
              <View className="items-start" accessibilityLabel="Looking that up" accessibilityRole="progressbar">
                <View className="w-[70%] gap-2 rounded-card rounded-bl-[6px] border border-line bg-card/80 px-4 py-3.5">
                  <Skeleton className="h-3.5 w-full rounded-md" />
                  <Skeleton className="h-3.5 w-2/3 rounded-md" />
                </View>
              </View>
            ) : null}

            {turns.length === 1 && !thinking ? (
              <View className="mt-1 flex-row flex-wrap gap-2">
                {STARTERS.map((starter) => (
                  <Pressable
                    key={starter}
                    accessibilityRole="button"
                    onPress={() => void ask(starter)}
                    className="rounded-pill border border-line bg-card/70 px-3.5 py-2 active:bg-press"
                  >
                    <Text className="font-strong text-note text-ink">{starter}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        </ScrollView>

        <View className="mt-4 flex-row items-center rounded-control border-[1.5px] border-line bg-card/80 pl-4 pr-1.5">
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="Ask a question"
            placeholderTextColor={token.mist}
            autoCapitalize="sentences"
            returnKeyType="send"
            maxLength={HELP_QUESTION_MAX}
            onSubmitEditing={() => void ask(typed)}
            accessibilityLabel="Ask a question"
            className="h-12 min-w-0 flex-1 font-body text-ui text-ink"
            style={{ padding: 0 }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send your question"
            disabled={!typed.trim() || thinking}
            onPress={() => void ask(typed)}
            className={`h-9 w-9 flex-none items-center justify-center rounded-pill bg-ink ${
              !typed.trim() || thinking ? 'opacity-30' : ''
            }`}
          >
            <ArrowUp size={18} strokeWidth={2} color={colors.paper} />
          </Pressable>
        </View>
        <Text className="mt-3 font-body text-note text-slate">
          I answer from Entole’s help and can’t see your account. For anything else, send us a message.
        </Text>
      </Sheet>
    </KeyboardAvoidingView>
  );
}
