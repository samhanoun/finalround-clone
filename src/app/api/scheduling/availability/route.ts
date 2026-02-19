import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const availabilitySchema = z.object({
  slots: z.array(z.object({
    day_of_week: z.number().min(0).max(6),
    start_time: z.string(), // "HH:MM" format
    end_time: z.string(),   // "HH:MM" format
    timezone: z.string(),
    is_active: z.boolean().default(true),
  })),
});

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: slots, error } = await supabase
    .from('availability_slots')
    .select('*')
    .eq('user_id', user.id)
    .order('day_of_week', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ slots });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { slots } = availabilitySchema.parse(body);

    // Basic validation: ensure end_time > start_time
    for (const slot of slots) {
      if (slot.start_time >= slot.end_time) {
        return NextResponse.json(
          { error: `Invalid time range for day ${slot.day_of_week}: start time must be before end time` },
          { status: 400 }
        );
      }
    }

    // Delete existing slots and insert new ones (simpler than complex update logic for MVP)
    // In a real app, you might want to be more granular to preserve IDs if needed
    const { error: deleteError } = await supabase
      .from('availability_slots')
      .delete()
      .eq('user_id', user.id);

    if (deleteError) throw deleteError;

    const { data, error } = await supabase
      .from('availability_slots')
      .insert(slots.map(slot => ({ ...slot, user_id: user.id })))
      .select();

    if (error) throw error;

    return NextResponse.json({ slots: data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
