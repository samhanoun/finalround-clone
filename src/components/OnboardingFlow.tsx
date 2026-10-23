'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';
import { ApexMark } from './ApexMark';
import { ChartIcon, JobsIcon, LiveIcon, PracticeIcon, ResumeIcon } from './icons';

// Step types
type OnboardingStep = 'welcome' | 'plan' | 'profile' | 'tutorial';

interface Plan {
  id: string;
  name: string;
  price: string;
  features: string[];
  popular?: boolean;
}

interface ProfileData {
  fullName: string;
  targetRoles: string[];
  yearsExperience: string;
  industry: string;
}

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    features: [
      '5 mock interviews/month',
      'Basic resume analysis',
      'Job tracking (up to 10)',
      'Community support',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$19/mo',
    popular: true,
    features: [
      'Unlimited mock interviews',
      'Advanced resume optimization',
      'Unlimited job tracking',
      'Live copilot access',
      'Priority support',
      'Custom interview playbooks',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    price: '$49/mo',
    features: [
      'Everything in Pro',
      'Team analytics',
      'Admin dashboard',
      'API access',
      'Dedicated success manager',
      'Custom integrations',
    ],
  },
];

const ROLE_OPTIONS = [
  'Software Engineer',
  'Frontend Developer',
  'Backend Developer',
  'Full Stack Developer',
  'DevOps Engineer',
  'Data Scientist',
  'Machine Learning Engineer',
  'Product Manager',
  'Technical Lead',
  'Engineering Manager',
];

const EXPERIENCE_LEVELS = [
  { value: '0-1', label: 'Entry Level (0-1 years)' },
  { value: '1-3', label: 'Junior (1-3 years)' },
  { value: '3-5', label: 'Mid-Level (3-5 years)' },
  { value: '5-10', label: 'Senior (5-10 years)' },
  { value: '10+', label: 'Staff/Principal (10+ years)' },
];

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
  return (
    <div className="onboarding-container">
      <div className="onboarding-card">
        <div className="onboarding-icon">
          <ApexMark size={52} />
        </div>
        <h1>Welcome to Apex Round</h1>
        <p className="onboarding-description">
          Help in the interview, and practice before it. Setup takes about two minutes.
        </p>

        <div className="onboarding-features">
          <div className="feature-item">
            <span className="feature-icon"><PracticeIcon size={20} /></span>
            <span>Practice interviews with a score and feedback</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon"><ResumeIcon size={20} /></span>
            <span>Your résumé, checked against each job</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon"><JobsIcon size={20} /></span>
            <span>Every application, tracked by stage</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon"><LiveIcon size={20} /></span>
            <span>A live copilot during real interviews</span>
          </div>
        </div>

        <button
          className="button buttonPrimary onboarding-button"
          onClick={onNext}
          disabled={loading}
        >
          Get started
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
  return (
    <div className="onboarding-container">
      <div className="onboarding-card">
        <button className="back-button" onClick={onBack}>Back</button>
        <h1>Choose a plan</h1>
        <p className="onboarding-description">
          Start free and upgrade whenever you need more minutes.
        </p>

        <div className="plans-grid">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`plan-card ${selectedPlan === plan.id ? 'selected' : ''} ${plan.popular ? 'popular' : ''}`}
              onClick={() => onSelect(plan.id)}
            >
              {plan.popular && <span className="popular-badge">Most popular</span>}
              <h3>{plan.name}</h3>
              <div className="plan-price">{plan.price}</div>
              <ul className="plan-features">
                {plan.features.map((feature, idx) => (
                  <li key={idx}>✓ {feature}</li>
                ))}
              </ul>
              <div className={`plan-select ${selectedPlan === plan.id ? 'selected' : ''}`}>
                {selectedPlan === plan.id ? '✓ Selected' : 'Select'}
              </div>
            </div>
          ))}
        </div>

        <button
          className="button buttonPrimary onboarding-button"
          onClick={onNext}
          disabled={loading || !selectedPlan}
        >
          Continue
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
  const isValid = profileData.fullName.trim() !== '' &&
                   profileData.targetRoles.length > 0 &&
                   profileData.yearsExperience !== '';

  return (
    <div className="onboarding-container">
      <div className="onboarding-card">
        <button className="back-button" onClick={onBack}>Back</button>
        <h1>About you</h1>
        <p className="onboarding-description">
          Answers and practice questions are tuned to the roles you pick here.
        </p>

        <div className="profile-form">
          <div className="form-group">
            <label className="label">Full name</label>
            <input
              className="input"
              type="text"
              value={profileData.fullName}
              onChange={(e) => onUpdate({ ...profileData, fullName: e.target.value })}
              placeholder="Your name"
            />
          </div>

          <div className="form-group">
            <label className="label">Roles you are aiming for (pick at least one)</label>
            <div className="role-tags">
              {ROLE_OPTIONS.map((role) => (
                <button
                  key={role}
                  className={`role-tag ${profileData.targetRoles.includes(role) ? 'selected' : ''}`}
                  onClick={() => onRoleToggle(role)}
                  type="button"
                >
                  {role}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="label">Years of experience</label>
            <select
              className="input"
              value={profileData.yearsExperience}
              onChange={(e) => onUpdate({ ...profileData, yearsExperience: e.target.value })}
            >
              <option value="">Select experience level</option>
              {EXPERIENCE_LEVELS.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="label">Industry (optional)</label>
            <input
              className="input"
              type="text"
              value={profileData.industry}
              onChange={(e) => onUpdate({ ...profileData, industry: e.target.value })}
              placeholder="e.g. Tech, finance, healthcare"
            />
          </div>
        </div>

        <button
          className="button buttonPrimary onboarding-button"
          onClick={onNext}
          disabled={loading || !isValid}
        >
          Continue
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
  const [tutorialStep, setTutorialStep] = useState(0);

  const tutorialSteps = [
    {
      title: 'Practice an interview',
      description: 'Answer behavioral or technical questions out loud, then read a score and notes on each answer.',
      Icon: PracticeIcon,
    },
    {
      title: 'See where you improve',
      description: 'Scores and session history build up on Home and in Analytics.',
      Icon: ChartIcon,
    },
    {
      title: 'Use the live copilot',
      description: 'Share your meeting with audio. When the interviewer asks a question, a short structured answer appears on your screen.',
      Icon: LiveIcon,
    },
    {
      title: 'Tune your résumé',
      description: 'Upload it once, then check it against any job description for missing keywords.',
      Icon: ResumeIcon,
    },
  ];

  return (
    <div className="onboarding-container">
      <div className="onboarding-card">
        <button className="back-button" onClick={onBack}>Back</button>
        <h1>How it works</h1>
        <p className="onboarding-description">
          Four things you can do with Apex Round.
        </p>

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
            <h3>{tutorialSteps[tutorialStep].title}</h3>
            <p>{tutorialSteps[tutorialStep].description}</p>
          </div>

          <div className="tutorial-nav">
            <button
              className="button"
              onClick={() => setTutorialStep(Math.max(0, tutorialStep - 1))}
              disabled={tutorialStep === 0}
            >
              Previous
            </button>
            <span className="tutorial-count">{tutorialStep + 1} / {tutorialSteps.length}</span>
            <button
              className="button"
              onClick={() => setTutorialStep(Math.min(tutorialSteps.length - 1, tutorialStep + 1))}
              disabled={tutorialStep === tutorialSteps.length - 1}
            >
              Next
            </button>
          </div>
        </div>

        <button
          className="button buttonPrimary onboarding-button"
          onClick={onComplete}
          disabled={loading}
        >
          {loading ? 'Setting up…' : 'Start using Apex Round'}
        </button>
      </div>
    </div>
  );
}
