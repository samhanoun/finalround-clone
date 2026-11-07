import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { QuestionBank } from '@/components/practice/QuestionBank';

export default async function QuestionBankPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await props.searchParams;
  const t = await getTranslations('QuestionBank');
  const company = typeof search.company === 'string' ? search.company.trim().slice(0, 120) : '';
  return (
    <AppShell title={t('title')}>
      <RequireAuth>
        <QuestionBank initialCompany={company} />
      </RequireAuth>
    </AppShell>
  );
}
