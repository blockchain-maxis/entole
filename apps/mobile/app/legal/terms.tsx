import { TERMS } from '@entole/core/legal';

import { Header } from '@/components/ui/Header';
import { LegalDocument } from '@/components/ui/LegalDocument';
import { Screen } from '@/components/ui/Screen';

/** The terms, from `@entole/core/legal`. */
export default function Terms() {
  return (
    <Screen>
      <Header title={TERMS.title} />
      <LegalDocument document={TERMS} />
    </Screen>
  );
}
