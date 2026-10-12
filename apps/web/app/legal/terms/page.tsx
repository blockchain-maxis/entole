import { TERMS } from '@entole/core/legal';

import { LegalPage } from '@/components/LegalPage';

/** The terms, from `@entole/core/legal`. Public: readable before signing up. */
export default function TermsPage() {
  return <LegalPage document={TERMS} other={{ label: 'Privacy', href: '/legal/privacy' }} />;
}
