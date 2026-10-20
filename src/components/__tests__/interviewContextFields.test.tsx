import { fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import {
  EMPTY_INTERVIEW_CONTEXT,
  InterviewContextFields,
  interviewContextBody,
  type InterviewContext,
} from '@/components/copilot/InterviewContextFields';

const resumes = [
  { id: 'r1', filename: 'cv-2026.pdf', created_at: '2026-10-01T00:00:00Z' },
  { id: 'r2', filename: null, created_at: '2026-09-01T00:00:00Z' },
];
let mockRows: typeof resumes = resumes;

jest.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        not: () => ({ order: () => ({ limit: () => Promise.resolve({ data: mockRows, error: null }) }) }),
      }),
    }),
  }),
}));

function Harness({ onChange }: { onChange: (value: InterviewContext) => void }) {
  const [value, setValue] = useState(EMPTY_INTERVIEW_CONTEXT);
  return (
    <InterviewContextFields
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      disabled={false}
    />
  );
}

describe('InterviewContextFields', () => {
  beforeEach(() => {
    mockRows = resumes;
  });

  it('lists parsed résumés and reports what the user fills in', async () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);

    expect(await screen.findByRole('option', { name: /cv-2026\.pdf/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Untitled/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Résumé'), { target: { value: 'r1' } });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByLabelText('Job description'), { target: { value: 'You will own the payments API.' } });

    expect(onChange).toHaveBeenLastCalledWith({
      resumeDocumentId: 'r1',
      company: 'Acme',
      role: '',
      jobDescription: 'You will own the payments API.',
    });
  });

  it('points to the résumé page when nothing is parsed yet', async () => {
    mockRows = [];
    render(<Harness onChange={jest.fn()} />);
    expect(await screen.findByText(/No parsed résumés yet/)).toBeInTheDocument();
  });
});

describe('interviewContextBody', () => {
  it('sends only filled, trimmed fields', () => {
    expect(interviewContextBody({ resumeDocumentId: '', company: '  Acme ', role: '', jobDescription: '\n' })).toEqual({
      company: 'Acme',
    });
    expect(interviewContextBody(EMPTY_INTERVIEW_CONTEXT)).toEqual({});
  });
});
