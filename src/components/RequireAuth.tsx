import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export async function RequireAuth(props: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <h2 className="cardTitle">You’re not logged in</h2>
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
