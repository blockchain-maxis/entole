import { PRIVACY } from '@entole/core/legal';

import { LegalPage } from '@/components/LegalPage';

/** The privacy notice, from `@entole/core/legal`. Public: readable before signing up. */
export default function PrivacyPage() {
  return <LegalPage document={PRIVACY} other={{ label: 'Terms', href: '/legal/terms' }} />;
}
