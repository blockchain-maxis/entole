import { ScrollView, View } from 'react-native';

import { LEGAL_CONTACT, type LegalDocument as Document } from '@entole/core/legal';

import { Text } from './Text';

/**
 * The Terms or the Privacy notice, set to be read: a serif lead and ruled
 * sections. The words come from `@entole/core/legal`, the same ones the browser
 * shows, so the two can never disagree.
 */
export function LegalDocument({ document }: { document: Document }) {
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 40 }}
    >
      <Text className="font-body text-note text-slate">Last updated {document.updated}</Text>
      <Text className="mt-4 font-display-plain text-prose text-ink">{document.lead}</Text>

      {document.sections.map((section) => (
        <View key={section.heading} className="mt-7 border-t border-hairline pt-5">
          <Text accessibilityRole="header" className="font-display text-subhead text-ink">
            {section.heading}
          </Text>
          {section.body.map((paragraph) => (
            <Text key={paragraph} className="mt-3 font-plain text-prose text-ink">
              {paragraph}
            </Text>
          ))}
        </View>
      ))}

      <View className="mt-8 border-t border-hairline pt-5">
        <Text selectable className="font-body text-ui text-slate">
          {LEGAL_CONTACT}
        </Text>
      </View>
    </ScrollView>
  );
}
