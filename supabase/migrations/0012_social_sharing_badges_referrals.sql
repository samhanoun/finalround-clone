-- Migration: Social sharing, badges, and referral system
-- Created: 2026-02-18

-- Achievement badges table
CREATE TABLE IF NOT EXISTS badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    badge_type TEXT NOT NULL CHECK (badge_type IN (
        'first_interview',
        'five_sessions',
        'ten_sessions',
        'first_offer',
        'streak_week',
        'streak_month',
        'resume_optimized',
        'job_applied',
        'referral_signup',
        'referral_conversion'
    )),
    title TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    awarded_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_badges_user_id ON badges(user_id);
CREATE INDEX idx_badges_type ON badges(badge_type);

-- Referral codes table
CREATE TABLE IF NOT EXISTS referral_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE,
    referral_count INTEGER DEFAULT 0,
    conversion_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_referral_codes_code ON referral_codes(code);
CREATE INDEX idx_referral_codes_user_id ON referral_codes(user_id);

-- Referral tracking table
CREATE TABLE IF NOT EXISTS referral_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    referee_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    referral_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed_up', 'converted', 'expired')),
    source TEXT,
    utm_campaign TEXT,
    utm_medium TEXT,
    utm_source TEXT,
    clicked_at TIMESTAMPTZ DEFAULT NOW(),
    signed_up_at TIMESTAMPTZ,
    converted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_referral_tracking_code ON referral_tracking(referral_code);
CREATE INDEX idx_referral_tracking_referrer ON referral_tracking(referrer_id);
CREATE INDEX idx_referral_tracking_referee ON referral_tracking(referee_id);

-- Social share tracking
CREATE TABLE IF NOT EXISTS social_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    share_type TEXT NOT NULL CHECK (share_type IN ('interview_report', 'badge', 'achievement', 'job_offer')),
    platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'twitter', 'facebook', 'email')),
    content_id TEXT,
    content_title TEXT,
    shared_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_social_shares_user ON social_shares(user_id);
CREATE INDEX idx_social_shares_type ON social_shares(share_type);

-- Enable RLS
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_shares ENABLE ROW LEVEL SECURITY;

-- Badges policies
CREATE POLICY "Users can view own badges" ON badges FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own badges" ON badges FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own badges" ON badges FOR UPDATE USING (auth.uid() = user_id);

-- Referral codes policies
CREATE POLICY "Users can view own referral code" ON referral_codes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own referral code" ON referral_codes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own referral code" ON referral_codes FOR UPDATE USING (auth.uid() = user_id);

-- Referral tracking policies
CREATE POLICY "Users can view own referrals" ON referral_tracking FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referee_id);
CREATE POLICY "Anyone can insert referral tracking" ON referral_tracking FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update own referrals" ON referral_tracking FOR UPDATE USING (auth.uid() = referrer_id);

-- Social shares policies
CREATE POLICY "Users can view own social shares" ON social_shares FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own social shares" ON social_shares FOR INSERT WITH CHECK (auth.uid() = user_id);
