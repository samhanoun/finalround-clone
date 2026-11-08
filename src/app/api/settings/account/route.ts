import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { cancelBillingForDeletion } from '@/lib/billing';
import { getStripe } from '@/lib/stripe';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const deleteSchema = z.object({
  confirm_email: z.string().trim().email(),
});

/**
 * DELETE /api/settings/account: deletes the signed-in account once the user has typed its email.
 * A paid plan stops billing first; if its Stripe subscription can't be cancelled, nothing is deleted.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return jsonError(401, 'unauthorized');

  const validation = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!validation.success) return jsonError(400, 'invalid_body', validation.error.flatten());
  const { confirm_email } = validation.data;

  // The typed address must be the account's sign-in address (Supabase Auth's, which the profile's copy
  // can lag behind). Email addresses are compared without regard to case.
  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', user.id)
    .maybeSingle();
  const accountEmail = (user.email ?? profile?.email ?? '').trim().toLowerCase();

  if (!accountEmail || accountEmail !== confirm_email.trim().toLowerCase()) {
    return jsonError(400, 'email_mismatch');
  }

  try {
    const admin = createAdminClient();

    // Billing stops first. Once the account is gone nothing maps the Stripe customer back to it, so a
    // subscription left running would go on charging. Without Stripe on this server there's nothing to stop.
    const stripe = getStripe();
    if (stripe) {
      try {
        await cancelBillingForDeletion(stripe, admin, user.id);
      } catch (e) {
        console.error('[account] billing could not be cancelled, so the account was kept', {
          userId: user.id,
          error: e instanceof Error ? e.message : e,
        });
        return jsonError(502, 'billing_cancel_failed');
      }
    }

    // Everything the user owns goes with the auth user (on delete cascade); the few rows that only point
    // at them (who invited a teammate, the audit log) keep their place with the pointer set to null.
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error('[account] deletion failed', { userId: user.id, error: deleteError.message });
      return jsonError(500, 'delete_failed');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[account] deletion failed', { userId: user.id, error: error instanceof Error ? error.message : error });
    return jsonError(500, 'delete_failed');
  }
}
