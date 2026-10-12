import { PRIVACY } from '@entole/core/legal';

import { Header } from '@/components/ui/Header';
import { LegalDocument } from '@/components/ui/LegalDocument';
import { Screen } from '@/components/ui/Screen';

/** The privacy notice, from `@entole/core/legal`. */
export default function Privacy() {
  return (
    <Screen>
      <Header title={PRIVACY.title} />
      <LegalDocument document={PRIVACY} />
    </Screen>
  );
}
