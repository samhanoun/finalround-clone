'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { useLocale, useTranslations } from 'next-intl';
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

/** Pro is billed in either; checkout uses the one picked on the plan step. */
type Currency = 'usd' | 'eur';
const CURRENCIES: Currency[] = ['usd', 'eur'];

interface ProfileData {
  fullName: string;
  targetRoles: string[];
  yearsExperience: string;
  industry: string;
}

/** What onboarding_state.profile_data holds: the answers so far, and the currency picked for Pro. */
type SavedAnswers = Partial<ProfileData> & { currency?: string };

// The plans as billed (see the plans table and /api/billing/checkout).
const PLANS: Plan[] = [
  { id: 'free', features: 5 },
  { id: 'pro', features: 4 },
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
type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

/** profiles.years_experience is a whole number: each level is saved as its first year, so entry level is 0. */
const EXPERIENCE_YEARS: Record<ExperienceLevel, number> = { '0-1': 0, '1-3': 1, '3-5': 3, '5-10': 5, '10+': 10 };

function yearsFor(level: string): number | null {
  return (EXPERIENCE_LEVELS as readonly string[]).includes(level) ? EXPERIENCE_YEARS[level as ExperienceLevel] : null;
}

/** The profile columns the answers fill in; none until there's a name (the profile step requires one). */
function profileFields(profile: ProfileData) {
  if (!profile.fullName.trim()) return {};
  return {
    full_name: profile.fullName.trim(),
    target_roles: profile.targetRoles,
    years_experience: yearsFor(profile.yearsExperience),
    industry: profile.industry.trim() || null,
  };
}

/** The saved answers that still fit the form; anything else keeps its default. */
function savedAnswers(saved: SavedAnswers): Partial<ProfileData> {
  const answers: Partial<ProfileData> = {};
  if (typeof saved.fullName === 'string') answers.fullName = saved.fullName;
  if (Array.isArray(saved.targetRoles)) answers.targetRoles = saved.targetRoles.filter((role) => typeof role === 'string');
  if (typeof saved.yearsExperience === 'string') answers.yearsExperience = saved.yearsExperience;
  if (typeof saved.industry === 'string') answers.industry = saved.industry;
  return answers;
}

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
  const locale = useLocale();
  const t = useTranslations('Onboarding');
  const [supabase] = useState(() => createClient());
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [loading, setLoading] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [plan, setPlan] = useState<string>('');
  const [currency, setCurrency] = useState<Currency>('usd');
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

      // Where the user left off, if they started before (a new account has no row yet).
      const { data: onboardingState } = await supabase
        .from('onboarding_state')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (onboardingState?.current_step) {
        setCurrentStep(onboardingState.current_step as OnboardingStep);
        if (onboardingState.plan) setPlan(onboardingState.plan);
        const saved = onboardingState.profile_data as SavedAnswers | null;
        if (saved) {
          setProfileData((current) => ({ ...current, ...savedAnswers(saved) }));
          if (CURRENCIES.includes(saved.currency as Currency)) setCurrency(saved.currency as Currency);
        }
      }
    }
    loadState();
  }, [supabase, router]);

  /** Saves the step and the answers so far. A failed save is shown, and the next step's save tries again. */
  async function saveState(step: OnboardingStep) {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // One row per user (user_id is unique), so each later save updates it.
      const { error } = await supabase
        .from('onboarding_state')
        .upsert(
          { user_id: user.id, current_step: step, plan: plan || null, profile_data: { ...profileData, currency } },
          { onConflict: 'user_id' },
        );
      if (error) throw error;

      const fields = profileFields(profileData);
      if (Object.keys(fields).length > 0) {
        const { error: profileError } = await supabase.from('profiles').update(fields).eq('id', user.id);
        if (profileError) throw profileError;
      }
      setSaveFailed(false);
    } catch (error) {
      console.error('Error saving onboarding state:', error);
      setSaveFailed(true);
    } finally {
      setLoading(false);
    }
  }

  async function completeOnboarding() {
    setLoading(true);
    setSaveFailed(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Finished. The answers go in again with the flag, in case an earlier save didn't get through.
      const { error } = await supabase
        .from('profiles')
        .update({ ...profileFields(profileData), onboarding_completed: true })
        .eq('id', user.id);
      if (error) throw error;

      // Pro was chosen: straight to checkout, in this language and the currency picked with the plan.
      // If billing isn't available, Settings has the upgrade button.
      if (plan === 'pro') {
        const res = await fetch('/api/billing/checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ currency, locale }),
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
      setSaveFailed(true);
    } finally {
      setLoading(false);
    }
  }

  const error = saveFailed ? t('saveFailed') : null;

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
    return <WelcomeStep onNext={nextStep} loading={loading} error={error} />;
  }

  if (currentStep === 'plan') {
    return (
      <PlanStep
        plans={PLANS}
        selectedPlan={plan}
        onSelect={setPlan}
        currency={currency}
        onCurrency={setCurrency}
        onNext={nextStep}
        onBack={prevStep}
        loading={loading}
        error={error}
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
        error={error}
      />
    );
  }

  if (currentStep === 'tutorial') {
    return <TutorialStep onComplete={completeOnboarding} onBack={prevStep} loading={loading} error={error} />;
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
  error,
  children,
}: {
  step: OnboardingStep;
  title: string;
  description: string;
  onBack?: () => void;
  primary: React.ReactNode;
  /** A save that didn't get through, shown above the actions. */
  error?: string | null;
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
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
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

function WelcomeStep({ onNext, loading, error }: { onNext: () => void; loading: boolean; error: string | null }) {
  const t = useTranslations('Onboarding.welcome');
  return (
    <StepFrame
      step="welcome"
      title={t('title')}
      description={t('desc')}
      error={error}
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
  currency,
  onCurrency,
  onNext,
  onBack,
  loading,
  error,
}: {
  plans: Plan[];
  selectedPlan: string;
  onSelect: (planId: string) => void;
  currency: Currency;
  onCurrency: (currency: Currency) => void;
  onNext: () => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
}) {
  const t = useTranslations('Onboarding');
  const tBilling = useTranslations('Billing');
  const baseId = useId();
  return (
    <StepFrame
      step="plan"
      title={t('plan.title')}
      description={t('plan.desc')}
      onBack={onBack}
      error={error}
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
      {/* Under the Pro option: what checkout will charge in. */}
      {selectedPlan === 'pro' ? (
        <div className={styles.currency}>
          <label className="label">
            {tBilling('payIn')}
            <select className="select" value={currency} onChange={(e) => onCurrency(e.target.value as Currency)}>
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {tBilling(`currencies.${code}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
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
  error,
}: {
  profileData: ProfileData;
  onUpdate: (data: ProfileData) => void;
  onRoleToggle: (role: string) => void;
  onNext: () => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
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
      error={error}
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
  error,
}: {
  onComplete: () => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
}) {
  const t = useTranslations('Onboarding');
  return (
    <StepFrame
      step="tutorial"
      title={t('tutorial.title')}
      description={t('tutorial.desc')}
      onBack={onBack}
      error={error}
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
