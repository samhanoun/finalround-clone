'use client';

import Link from 'next/link';
import { createClient } from '@/lib/supabase/browser';
import { useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';

export function RequireAuth(props: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      setUser(data.user);
      setLoading(false);
    }
    checkAuth();
  }, []);

  if (loading) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <p className="small">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <h2 className="cardTitle">You&apos;re not logged in</h2>
          <p className="cardDesc">Please login to continue.</p>
          <div className="row">
            <Link className="button buttonPrimary" href="/auth">
              Go to login
            </Link>
            <Link className="button" href="/">
              Back to landing
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{props.children}</>;
}
