import { TEST_LABELS, type ProviderId, type TestStatus } from '../../core/ai/providers/types.ts';
import type { Platform } from '../platform/types.ts';
import { testReportUrl } from '../report.ts';
import { ActionButton } from './ActionButton.tsx';

/** "Tested" / "Lightly tested" / "Not tested yet" next to a provider. */
export function TestTag({ status }: { status: TestStatus }) {
  return (
    <span className="test-tag" data-status={status} title={status === 'tested' ? 'Used for real by the developer' : 'Should work, but has not been tried in real use yet'}>
      {TEST_LABELS[status]}
    </span>
  );
}

/** Opens the GitHub test report form, prefilled with the version, the running build and the provider. */
export function ReportTestLink({ platform, provider, label = 'Report a test' }: { platform: Platform; provider?: ProviderId; label?: string }) {
  return (
    <ActionButton
      className="link small"
      title="Opens a short form on GitHub (needs a GitHub account)"
      action={async () => platform.openUrl(testReportUrl({ provider, build: await platform.buildKind() }))}
      labels={{ idle: label, busy: 'Opening…', done: 'Opened in your browser' }}
    />
  );
}
