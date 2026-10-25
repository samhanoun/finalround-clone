import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { JobsClient } from '@/components/JobsClient';

export default function JobsPage() {
  return (
    <AppShell title="Jobs">
      <RequireAuth>
        <JobsClient />
      </RequireAuth>
    </AppShell>
  );
}
