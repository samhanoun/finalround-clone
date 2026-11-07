'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/browser';
import { ApexMark } from './ApexMark';
import { ChartIcon, ChevronLeftIcon, JobsIcon, LiveIcon, PracticeIcon, ResumeIcon } from './icons';
import styles from './OnboardingFlow.module.css';

type OnboardingStep = 'welcome' | 'plan' | 'profile' | 'tutorial';

const STEPS: OnboardingStep[] = ['welcome', 'plan', 'profile', 'tutorial'];

interface Plan {
  id: 'free' | 'pro';
  features: number;
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
  { id: 'pro', features: 5 },
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

/** What Apex Round does, in the order the welcome text gives it: in the interview, then before it. */
const FEATURES = [
  { key: 'live', Icon: LiveIcon },
  { key: 'practice', Icon: PracticeIcon },
  { key: 'resume', Icon: ResumeIcon },
  { key: 'jobs', Icon: JobsIcon },
] as const;

const TIPS = [
  { key: 'practice', Icon: PracticeIcon },
  { key: 'progress', Icon: ChartIcon },
  { key: 'live', Icon: LiveIcon },
  { key: 'resume', Icon: ResumeIcon },
] as const;

export default function OnboardingFlow() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
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
    const next = STEPS[STEPS.indexOf(currentStep) + 1];
    if (next) {
      setCurrentStep(next);
      saveState(next);
    }
  }

  function prevStep() {
    const previous = STEPS[STEPS.indexOf(currentStep) - 1];
    if (previous) {
      setCurrentStep(previous);
      saveState(previous);
    }
  }

  function handleRoleToggle(role: string) {
    setProfileData(prev => {
      const roles = prev.targetRoles.includes(role)
        ? prev.targetRoles.filter(r => r !== role)
        : [...prev.targetRoles, role];
      return { ...prev, targetRoles: roles };
    });
  }

  if (currentStep === 'welcome') {
    return <WelcomeStep onNext={nextStep} loading={loading} />;
  }

  if (currentStep === 'plan') {
    return (
      <PlanStep
        plans={PLANS}
        selectedPlan={plan}
        onSelect={setPlan}
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
    return <TutorialStep onComplete={completeOnboarding} onBack={prevStep} loading={loading} />;
  }

  return null;
}

/** One step: where you are, the title, the content, and Back beside the one primary action. */
function StepFrame({
  step,
  title,
  description,
  onBack,
  primary,
  children,
}: {
  step: OnboardingStep;
  title: string;
  description: string;
  onBack?: () => void;
  primary: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations('Onboarding');
  const titleId = useId();
  const index = STEPS.indexOf(step);
  return (
    <div className={styles.page}>
      <main id="main-content" className={styles.panel} tabIndex={-1} aria-labelledby={titleId}>
        <div className={styles.top}>
          <ApexMark size={28} />
          <span className={styles.stepCount}>{t('stepOf', { current: index + 1, total: STEPS.length })}</span>
        </div>
        <div className={styles.progress} aria-hidden="true">
          {STEPS.map((name, i) => (
            <span key={name} className={styles.segment} data-done={i <= index ? '' : undefined} />
          ))}
        </div>
        <div className={styles.heading}>
          <h1 id={titleId} className={styles.title}>
            {title}
          </h1>
          <p className={styles.description}>{description}</p>
        </div>
        <div className={styles.body}>{children}</div>
        <div className={styles.actions}>
          {onBack ? (
            <button type="button" className={`button buttonGhost ${styles.back}`} onClick={onBack}>
              <ChevronLeftIcon size={16} />
              {t('back')}
            </button>
          ) : null}
          {primary}
        </div>
      </main>
    </div>
  );
}

function WelcomeStep({ onNext, loading }: { onNext: () => void; loading: boolean }) {
  const t = useTranslations('Onboarding.welcome');
  return (
    <StepFrame
      step="welcome"
      title={t('title')}
      description={t('desc')}
      primary={
        <button type="button" className="button buttonPrimary buttonLarge" onClick={onNext} disabled={loading}>
          {t('start')}
        </button>
      }
    >
      <ul className={styles.features}>
        {FEATURES.map(({ key, Icon }) => (
          <li key={key} className={styles.feature}>
            <span className={styles.featureIcon}>
              <Icon size={18} />
            </span>
            {t(key)}
          </li>
        ))}
      </ul>
    </StepFrame>
  );
}

function PlanStep({
  plans,
  selectedPlan,
  onSelect,
  onNext,
  onBack,
  loading,
}: {
  plans: Plan[];
  selectedPlan: string;
  onSelect: (planId: string) => void;
  onNext: () => void;
  onBack: () => void;
  loading: boolean;
}) {
  const t = useTranslations('Onboarding');
  const baseId = useId();
  return (
    <StepFrame
      step="plan"
      title={t('plan.title')}
      description={t('plan.desc')}
      onBack={onBack}
      primary={
        <button
          type="button"
          className="button buttonPrimary buttonLarge"
          onClick={onNext}
          disabled={loading || !selectedPlan}
        >
          {t('continue')}
        </button>
      }
    >
      <fieldset className={styles.plans}>
        <legend className="srOnly">{t('plan.title')}</legend>
        {plans.map((plan) => {
          const selected = selectedPlan === plan.id;
          const id = `${baseId}-${plan.id}`;
          return (
            <div key={plan.id} className={styles.plan} data-selected={selected ? '' : undefined}>
              <input
                id={id}
                className={styles.radio}
                type="radio"
                name={`${baseId}-plan`}
                value={plan.id}
                checked={selected}
                onChange={() => onSelect(plan.id)}
                aria-describedby={`${id}-price ${id}-features`}
              />
              <label htmlFor={id} className={styles.planLabel}>
                <span className={styles.planName}>{t(`plan.${plan.id}.name`)}</span>
                <span className={styles.radioMark} aria-hidden="true" />
              </label>
              <p id={`${id}-price`} className={styles.planPrice}>
                {t(`plan.${plan.id}.price`)}
              </p>
              <ul id={`${id}-features`} className={styles.planFeatures}>
                {Array.from({ length: plan.features }, (_, idx) => (
                  <li key={idx}>{t(`plan.${plan.id}.feature${idx + 1}`)}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </fieldset>
    </StepFrame>
  );
}

function ProfileStep({
  profileData,
  onUpdate,
  onRoleToggle,
  onNext,
  onBack,
  loading,
}: {
  profileData: ProfileData;
  onUpdate: (data: ProfileData) => void;
  onRoleToggle: (role: string) => void;
  onNext: () => void;
  onBack: () => void;
  loading: boolean;
}) {
  const t = useTranslations('Onboarding');
  const isValid =
    profileData.fullName.trim() !== '' && profileData.targetRoles.length > 0 && profileData.yearsExperience !== '';

  return (
    <StepFrame
      step="profile"
      title={t('profile.title')}
      description={t('profile.desc')}
      onBack={onBack}
      primary={
        <button
          type="button"
          className="button buttonPrimary buttonLarge"
          onClick={onNext}
          disabled={loading || !isValid}
        >
          {t('continue')}
        </button>
      }
    >
      <div className={styles.form}>
        <label className="label">
          {t('profile.name')}
          <input
            className="input"
            type="text"
            autoComplete="name"
            value={profileData.fullName}
            onChange={(e) => onUpdate({ ...profileData, fullName: e.target.value })}
            placeholder={t('profile.namePlaceholder')}
          />
        </label>

        <fieldset className={styles.group}>
          <legend className={styles.groupLabel}>{t('profile.roles')}</legend>
          <div className={styles.roles}>
            {ROLE_OPTIONS.map((key) => {
              const role = t(`roles.${key}`);
              const selected = profileData.targetRoles.includes(role);
              return (
                <button
                  key={key}
                  className={styles.role}
                  onClick={() => onRoleToggle(role)}
                  aria-pressed={selected}
                  type="button"
                >
                  {role}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className={styles.twoUp}>
          <label className="label">
            {t('profile.experience')}
            <select
              className="select"
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
          </label>

          <label className="label">
            {t('profile.industry')}
            <input
              className="input"
              type="text"
              value={profileData.industry}
              onChange={(e) => onUpdate({ ...profileData, industry: e.target.value })}
              placeholder={t('profile.industryPlaceholder')}
            />
          </label>
        </div>
      </div>
    </StepFrame>
  );
}

function TutorialStep({
  onComplete,
  onBack,
  loading,
}: {
  onComplete: () => void;
  onBack: () => void;
  loading: boolean;
}) {
  const t = useTranslations('Onboarding');
  return (
    <StepFrame
      step="tutorial"
      title={t('tutorial.title')}
      description={t('tutorial.desc')}
      onBack={onBack}
      primary={
        <button type="button" className="button buttonPrimary buttonLarge" onClick={onComplete} disabled={loading}>
          {loading ? t('finishing') : t('finish')}
        </button>
      }
    >
      <ul className={styles.tips}>
        {TIPS.map(({ key, Icon }) => (
          <li key={key} className={styles.tip}>
            <span className={styles.tipIcon} aria-hidden="true">
              <Icon size={18} />
            </span>
            <h2 className={styles.tipTitle}>{t(`tutorial.${key}.title`)}</h2>
            <p className={styles.tipBody}>{t(`tutorial.${key}.desc`)}</p>
          </li>
        ))}
      </ul>
    </StepFrame>
  );
}
