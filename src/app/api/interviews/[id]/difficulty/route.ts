import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';

// Difficulty weights for adaptive scoring
const DIFFICULTY_WEIGHTS = {
  easy: 1,
  medium: 2,
  hard: 3,
};

// Performance thresholds
const DIFFICULTY_THRESHOLDS = {
  easy_to_medium: 3.5,  // Avg score >= 3.5 -> increase difficulty
  medium_to_hard: 4.0, // Avg score >= 4.0 -> increase difficulty
  hard_to_medium: 2.5,  // Avg score < 2.5 -> decrease difficulty
  medium_to_easy: 2.0, // Avg score < 2.0 -> decrease difficulty
};

interface QuestionScore {
  difficulty: string;
  score: number | null;
}

function toQuestionScore(q: { difficulty: string; response_score: number | null }[]): QuestionScore[] {
  return q.map(item => ({
    difficulty: item.difficulty,
    score: item.response_score ?? null,
  }));
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `interview_difficulty:get:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  // Verify session belongs to user
  const { data: session } = await supabase
    .from('interview_sessions')
    .select('id')
    .eq('id', id)
    .eq('user_id', userData.user.id)
    .single();

  if (!session) return jsonError(404, 'not_found');

  // Get all answered questions with scores
  const { data: questions, error } = await supabase
    .from('interview_questions')
    .select('difficulty, response_score')
    .eq('session_id', id)
    .not('response_score', 'is', null)
    .order('order_index', { ascending: true });

  if (error) return jsonError(500, 'db_error', error);

  // Calculate adaptive difficulty recommendation
  const answeredQuestions = toQuestionScore(questions || []);
  const totalWeight = answeredQuestions.reduce((sum, q) => sum + (DIFFICULTY_WEIGHTS[q.difficulty as keyof typeof DIFFICULTY_WEIGHTS] || 2), 0);
  const totalScore = answeredQuestions.reduce((sum, q) => sum + (q.score || 0), 0);
  const avgScore = answeredQuestions.length > 0 ? totalScore / answeredQuestions.length : 0;
  const avgWeight = answeredQuestions.length > 0 ? totalWeight / answeredQuestions.length : 2;

  // Determine current difficulty level based on average weight
  let currentLevel: 'easy' | 'medium' | 'hard' = 'medium';
  if (avgWeight < 1.5) currentLevel = 'easy';
  else if (avgWeight > 2.5) currentLevel = 'hard';

  // Calculate recommended difficulty
  let recommendedDifficulty: 'easy' | 'medium' | 'hard' = currentLevel;

  if (answeredQuestions.length >= 2) {
    if (avgScore >= DIFFICULTY_THRESHOLDS.medium_to_hard && currentLevel !== 'hard') {
      recommendedDifficulty = currentLevel === 'easy' ? 'medium' : 'hard';
    } else if (avgScore < DIFFICULTY_THRESHOLDS.hard_to_medium && currentLevel !== 'easy') {
      recommendedDifficulty = currentLevel === 'hard' ? 'medium' : 'easy';
    }
  }

  // Calculate performance stats
  const stats = {
    total_questions: answeredQuestions.length,
    avg_score: Math.round(avgScore * 10) / 10,
    current_difficulty: currentLevel,
    recommended_difficulty: recommendedDifficulty,
    performance_trend: calculateTrend(answeredQuestions),
  };

  return NextResponse.json(stats);
}

function calculateTrend(questions: QuestionScore[]): 'improving' | 'declining' | 'stable' {
  if (questions.length < 3) return 'stable';

  const recent = questions.slice(-2);
  const older = questions.slice(0, -2);

  if (recent.length === 0 || older.length === 0) return 'stable';

  const recentAvg = recent.reduce((s, q) => s + (q.score || 0), 0) / recent.length;
  const olderAvg = older.reduce((s, q) => s + (q.score || 0), 0) / older.length;

  const diff = recentAvg - olderAvg;
  if (diff > 0.5) return 'improving';
  if (diff < -0.5) return 'declining';
  return 'stable';
}
