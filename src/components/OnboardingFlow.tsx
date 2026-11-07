'use client';

import { useState, useEffect } from 'react';
import { useRouter } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/browser';
import { ApexMark } from './ApexMark';
import { ChartIcon, JobsIcon, LiveIcon, PracticeIcon, ResumeIcon } from './icons';

// Step types
type OnboardingStep = 'welcome' | 'plan' | 'profile' | 'tutorial';

interface Plan {
  id: 'free' | 'pro';
  features: number;
  popular?: boolean;
}

interface ProfileData {
  fullName: string;
  targetRoles: string[];
  yearsExperience: string;
  industry: string;
}

// The plans as billed (see the plans table and /api/billing/checkout).
const PLANS: Plan[] = [
  { id: 'free', features: 5 },
  { id: 'pro', features: 5, popular: true },
];

/** Suggested roles; the chosen names are saved as shown, in the app's language. */
const ROLE_OPTIONS = [
  'softwareEngineer',
  'frontend',
  'backend',
  'fullStack',
  'devops',
  'dataScientist',
  'mlEngineer',
  'productManager',
  'techLead',
  'engManager',
] as const;

const EXPERIENCE_LEVELS = ['0-1', '1-3', '3-5', '5-10', '10+'] as const;

export default function OnboardingFlow() {
  const router = useRouter();
  const supabase = createClient();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<string>('');
  const [profileData, setProfileData] = useState<ProfileData>({
    fullName: '',
    targetRoles: [],
    yearsExperience: '',
    industry: '',
  });

  // Load initial state
  useEffect(() => {
    async function loadState() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/auth?next=/onboarding');
        return;
      }

      // Check existing onboarding state
      const { data: onboardingState } = await supabase
        .from('onboarding_state')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (onboardingState?.current_step) {
        setCurrentStep(onboardingState.current_step as OnboardingStep);
        if (onboardingState.plan) setPlan(onboardingState.plan);
        if (onboardingState.profile_data) {
          setProfileData(onboardingState.profile_data as ProfileData);
        }
      }
    }
    loadState();
  }, [supabase, router]);

  async function saveState(step: OnboardingStep) {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Update onboarding state
      await supabase.from('onboarding_state').upsert({
        user_id: user.id,
        current_step: step,
        plan: plan || null,
        profile_data: profileData,
      });

      // Also update profile if we have data
      if (profileData.fullName) {
        await supabase.from('profiles').update({
          full_name: profileData.fullName,
          target_roles: profileData.targetRoles,
          years_experience: parseInt(profileData.yearsExperience) || null,
          industry: profileData.industry || null,
        }).eq('id', user.id);
      }
    } catch (error) {
      console.error('Error saving onboarding state:', error);
    } finally {
      setLoading(false);
    }
  }

  async function completeOnboarding() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Mark onboarding as complete
      await supabase.from('profiles').update({
        onboarding_completed: true,
      }).eq('id', user.id);

      // Pro was chosen: go straight to checkout. If billing isn't available, Settings has the upgrade button.
      if (plan === 'pro') {
        const res = await fetch('/api/billing/checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ currency: 'usd' }),
        }).catch(() => null);
        const json = res?.ok ? await res.json().catch(() => null) : null;
        if (json?.url) {
          window.location.assign(json.url);
          return;
        }
        router.push('/settings');
        return;
      }

      router.push('/dashboard');
    } catch (error) {
      console.error('Error completing onboarding:', error);
    } finally {
      setLoading(false);
    }
  }

  function nextStep() {
    const steps: OnboardingStep[] = ['welcome', 'plan', 'profile', 'tutorial'];
    const currentIndex = steps.indexOf(currentStep);
    const nextStep = steps[currentIndex + 1];
    if (nextStep) {
      setCurrentStep(nextStep);
      saveState(nextStep);
    }
  }

  function prevStep() {
    const steps: OnboardingStep[] = ['welcome', 'plan', 'profile', 'tutorial'];
    const currentIndex = steps.indexOf(currentStep);
    const prevStep = steps[currentIndex - 1];
    if (prevStep) {
      setCurrentStep(prevStep);
      saveState(prevStep);
    }
  }

  function handlePlanSelect(planId: string) {
    setPlan(planId);
  }

  function handleRoleToggle(role: string) {
    setProfileData(prev => {
      const roles = prev.targetRoles.includes(role)
        ? prev.targetRoles.filter(r => r !== role)
        : [...prev.targetRoles, role];
      return { ...prev, targetRoles: roles };
    });
  }

  // Render steps
  if (currentStep === 'welcome') {
    return (
      <WelcomeStep
        onNext={nextStep}
        loading={loading}
      />
    );
  }

  if (currentStep === 'plan') {
    return (
      <PlanStep
        plans={PLANS}
        selectedPlan={plan}
        onSelect={handlePlanSelect}
        onNext={nextStep}
        onBack={prevStep}
        loading={loading}
      />
    );
  }

  if (currentStep === 'profile') {
    return (
      <ProfileStep
        profileData={profileData}
        onUpdate={setProfileData}
        onRoleToggle={handleRoleToggle}
        onNext={nextStep}
        onBack={prevStep}
        loading={loading}
      />
    );
  }

  if (currentStep === 'tutorial') {
    return (
      <TutorialStep
        onComplete={completeOnboarding}
        onBack={prevStep}
        loading={loading}
      />
    );
  }

  return null;
}

// Welcome Step Component
function WelcomeStep({ onNext, loading }: { onNext: () => void; loading: boolean }) {
  const t = useTranslations('Onboarding.welcome');
  return (
    <div className="onboarding-container">
      <div className="onboarding-card">
        <div className="onboarding-icon">
          <ApexMark size={52} />
        </div>
        <h1>{t('title')}</h1>
        <p className="onboarding-description">{t('desc')}</p>

        <div className="onboarding-features">
          <div className="feature-item">
            <span className="feature-icon"><PracticeIcon size={20} /></span>
            <span>{t('practice')}</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon"><ResumeIcon size={20} /></span>
            <span>{t('resume')}</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon"><JobsIcon size={20} /></span>
            <span>{t('jobs')}</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon"><LiveIcon size={20} /></span>
            <span>{t('live')}</span>
          </div>
        </div>

        <button
          className="button buttonPrimary onboarding-button"
          onClick={onNext}
          disabled={loading}
        >
          {t('start')}
        </button>
      </div>
    </div>
  );
}

// Plan Step Component
function PlanStep({
  plans,
  selectedPlan,
  onSelect,
  onNext,
  onBack,
  loading
}: {
  plans: Plan[];
  selectedPlan: string;
  onSelect: (planId: string) => void;
  onNext: () => void;
  onBack: () => void;
  loading: boolean;
}) {
  const t = useTranslations('Onboarding');
  return (
    <div className="onboarding-container">
      <div className="onboarding-card">
        <button className="back-button" onClick={onBack}>{t('back')}</button>
        <h1>{t('plan.title')}</h1>
        <p className="onboarding-description">{t('plan.desc')}</p>

        <div className="plans-grid">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`plan-card ${selectedPlan === plan.id ? 'selected' : ''} ${plan.popular ? 'popular' : ''}`}
              onClick={() => onSelect(plan.id)}
            >
              {plan.popular && <span className="popular-badge">{t('plan.popular')}</span>}
              <h3>{t(`plan.${plan.id}.name`)}</h3>
              <div className="plan-price">{t(`plan.${plan.id}.price`)}</div>
              <ul className="plan-features">
                {Array.from({ length: plan.features }, (_, idx) => (
                  <li key={idx}>✓ {t(`plan.${plan.id}.feature${idx + 1}`)}</li>
                ))}
              </ul>
              <div className={`plan-select ${selectedPlan === plan.id ? 'selected' : ''}`}>
                {selectedPlan === plan.id ? `✓ ${t('plan.selected')}` : t('plan.select')}
              </div>
            </div>
          ))}
        </div>

        <button
          className="button buttonPrimary onboarding-button"
          onClick={onNext}
          disabled={loading || !selectedPlan}
        >
          {t('continue')}
        </button>
      </div>
    </div>
  );
}

// Profile Step Component
function ProfileStep({
  profileData,
  onUpdate,
  onRoleToggle,
  onNext,
  onBack,
  loading
}: {
  profileData: ProfileData;
  onUpdate: (data: ProfileData) => void;
  onRoleToggle: (role: string) => void;
  onNext: () => void;
  onBack: () => void;
  loading: boolean;
}) {
  const t = useTranslations('Onboarding');
  const isValid = profileData.fullName.trim() !== '' &&
                   profileData.targetRoles.length > 0 &&
                   profileData.yearsExperience !== '';

  return (
    <div className="onboarding-container">
      <div className="onboarding-card">
        <button className="back-button" onClick={onBack}>{t('back')}</button>
        <h1>{t('profile.title')}</h1>
        <p className="onboarding-description">{t('profile.desc')}</p>

        <div className="profile-form">
          <div className="form-group">
            <label className="label">{t('profile.name')}</label>
            <input
              className="input"
              type="text"
              value={profileData.fullName}
              onChange={(e) => onUpdate({ ...profileData, fullName: e.target.value })}
              placeholder={t('profile.namePlaceholder')}
            />
          </div>

          <div className="form-group">
            <label className="label">{t('profile.roles')}</label>
            <div className="role-tags">
              {ROLE_OPTIONS.map((key) => {
                const role = t(`roles.${key}`);
                const selected = profileData.targetRoles.includes(role);
                return (
                  <button
                    key={key}
                    className={`role-tag ${selected ? 'selected' : ''}`}
                    onClick={() => onRoleToggle(role)}
                    aria-pressed={selected}
                    type="button"
                  >
                    {role}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="form-group">
            <label className="label">{t('profile.experience')}</label>
            <select
              className="input"
              value={profileData.yearsExperience}
              onChange={(e) => onUpdate({ ...profileData, yearsExperience: e.target.value })}
            >
              <option value="">{t('profile.experiencePick')}</option>
              {EXPERIENCE_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {t(`levels.${level}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="label">{t('profile.industry')}</label>
            <input
              className="input"
              type="text"
              value={profileData.industry}
              onChange={(e) => onUpdate({ ...profileData, industry: e.target.value })}
              placeholder={t('profile.industryPlaceholder')}
            />
          </div>
        </div>

        <button
          className="button buttonPrimary onboarding-button"
          onClick={onNext}
          disabled={loading || !isValid}
        >
          {t('continue')}
        </button>
      </div>
    </div>
  );
}

// Tutorial Step Component
function TutorialStep({
  onComplete,
  onBack,
  loading
}: {
  onComplete: () => void;
  onBack: () => void;
  loading: boolean;
}) {
  const t = useTranslations('Onboarding');
  const [tutorialStep, setTutorialStep] = useState(0);

  const tutorialSteps = [
    { key: 'practice', Icon: PracticeIcon },
    { key: 'progress', Icon: ChartIcon },
    { key: 'live', Icon: LiveIcon },
    { key: 'resume', Icon: ResumeIcon },
  ] as const;

  return (
    <div className="onboarding-container">
      <div className="onboarding-card">
        <button className="back-button" onClick={onBack}>{t('back')}</button>
        <h1>{t('tutorial.title')}</h1>
        <p className="onboarding-description">{t('tutorial.desc')}</p>

        <div className="tutorial-content">
          <div className="tutorial-progress">
            {tutorialSteps.map((_, idx) => (
              <div
                key={idx}
                className={`progress-dot ${idx <= tutorialStep ? 'active' : ''}`}
                onClick={() => setTutorialStep(idx)}
              />
            ))}
          </div>

          <div className="tutorial-step">
            <div className="tutorial-icon">
              {(() => {
                const StepIcon = tutorialSteps[tutorialStep].Icon;
                return <StepIcon size={36} />;
              })()}
            </div>
            <h3>{t(`tutorial.${tutorialSteps[tutorialStep].key}.title`)}</h3>
            <p>{t(`tutorial.${tutorialSteps[tutorialStep].key}.desc`)}</p>
          </div>

          <div className="tutorial-nav">
            <button
              className="button"
              onClick={() => setTutorialStep(Math.max(0, tutorialStep - 1))}
              disabled={tutorialStep === 0}
            >
              {t('previous')}
            </button>
            <span className="tutorial-count">{tutorialStep + 1} / {tutorialSteps.length}</span>
            <button
              className="button"
              onClick={() => setTutorialStep(Math.min(tutorialSteps.length - 1, tutorialStep + 1))}
              disabled={tutorialStep === tutorialSteps.length - 1}
            >
              {t('next')}
            </button>
          </div>
        </div>

        <button
          className="button buttonPrimary onboarding-button"
          onClick={onComplete}
          disabled={loading}
        >
          {loading ? t('finishing') : t('finish')}
        </button>
      </div>
    </div>
  );
}
