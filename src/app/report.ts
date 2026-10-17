// Test reports are GitHub issues from the form in .github/ISSUE_TEMPLATE/test-report.yml.
// Query parameters named like the form's field ids prefill them.

import { PROVIDERS, type ProviderId } from '../core/ai/providers/types.ts';

const REPO = 'jaynoe/ck3-heraldry-creator';

export function testReportUrl({ provider, build }: { provider?: ProviderId; build?: string }): string {
  const label = PROVIDERS.find((p) => p.id === provider)?.label;
  const version = __APP_VERSION__;
  const params = new URLSearchParams({
    template: 'test-report.yml',
    title: `[Test] ${[label ?? build, version].filter(Boolean).join(' ')}`,
    version,
    ...(build ? { build } : {}),
    ...(label ? { provider: label } : {}),
  });
  return `https://github.com/${REPO}/issues/new?${params}`;
}
