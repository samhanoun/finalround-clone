import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';

const deleteSchema = z.object({
  confirm_email: z.string().email(),
  reason: z.string().optional(),
});

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const validation = deleteSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: validation.error.issues },
      { status: 400 }
    );
  }

  const { confirm_email, reason } = validation.data;

  // Verify the email matches
  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', userData.user.id)
    .single();

  if (!profile || profile.email !== confirm_email) {
    return NextResponse.json(
      { error: 'Email does not match your account' },
      { status: 400 }
    );
  }

  try {
    // Use admin client to delete the user (this cascades to all related tables via RLS/on delete cascade)
    const adminClient = createAdminClient();
    
    // Log deletion reason for analytics (optional)
    console.log(`User ${userData.user.id} requested account deletion. Reason: ${reason || 'not provided'}`);

    // Delete the user - this will cascade delete all their data due to RLS policies
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userData.user.id);

    if (deleteError) {
      console.error('Account deletion error:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete account. Please try again later.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Account deletion exception:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
