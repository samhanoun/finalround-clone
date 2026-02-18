'use client';

import { DashboardSkeleton } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div style={{ padding: '20px 0' }}>
      <DashboardSkeleton />
    </div>
  );
}
