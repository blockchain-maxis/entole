import { PRIVACY } from '@entole/core/legal';

import { Header } from '@/components/ui/Header';
import { LegalDocument } from '@/components/ui/LegalDocument';
import { Screen } from '@/components/ui/Screen';
import { useAccount } from '@/lib/account';

/** The privacy notice, from `@entole/core/legal`. */
export default function Privacy() {
  // This screen can be read before signing up. Someone with no account has no
  // assistant to pause, so the control is left out for them; signed in, it is
  // in the header as everywhere else.
  const { account } = useAccount();
  return (
    <Screen>
      <Header title={PRIVACY.title} trailing={account ? undefined : null} />
      <LegalDocument document={PRIVACY} />
    </Screen>
  );
}
