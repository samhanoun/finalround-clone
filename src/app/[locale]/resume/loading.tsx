'use client';

import { FormSkeleton } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <div className="card">
        <div className="cardInner">
          <FormSkeleton />
        </div>
      </div>
      <div className="card">
        <div className="cardInner">
          <FormSkeleton />
        </div>
      </div>
    </div>
  );
}
