// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionProvider } from '../../../src/components/ActionProvider.tsx';
import { ToastProvider } from '../../../src/components/Toasts.tsx';
import { ApiProvider } from '../../../src/lib/ApiProvider.tsx';
import type { MyEvaluation } from '../../../src/lib/types.ts';
import { draftKey } from '../../../src/panel/evaluation.ts';
import { EvaluationForm } from '../../../src/panel/EvaluationForm.tsx';
import { criteriaList } from './fixtures.ts';
import { fakeApi, type FakeApi } from './helpers.tsx';

function renderForm(api: FakeApi = fakeApi(), props: { saved?: MyEvaluation; locked?: boolean; count?: number } = {}) {
  const onSubmitted = vi.fn();
  const view = render(
    <ApiProvider api={api}>
      <ToastProvider>
        <ActionProvider>
          <EvaluationForm
            interviewId="i7"
            userId="u-panelist"
            criteria={criteriaList()}
            saved={props.saved}
            evaluationCount={props.count ?? 0}
            locked={props.locked ?? false}
            onSubmitted={onSubmitted}
          />
        </ActionProvider>
      </ToastProvider>
    </ApiProvider>,
  );
  return { api, onSubmitted, ...view };
}

const choose = (group: string, option: string) => userEvent.click(within(screen.getByRole('group', { name: group })).getByRole('radio', { name: option }));

describe('EvaluationForm', () => {
  beforeEach(() => localStorage.clear());

  it('lists every criterion and requires a recommendation', async () => {
    const { api } = renderForm();
    for (const name of ['Communication', 'Confidence & Attitude', 'Teamwork', 'Commitment', 'Problem Solving']) {
      expect(within(screen.getByRole('group', { name })).getAllByRole('radio')).toHaveLength(6); // 1–5 and "No score"
    }
    expect(within(screen.getByRole('group', { name: 'Dev' })).getByRole('radio', { name: 'N/A' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Submit evaluation' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a recommendation before submitting.');
    expect(api.submitEvaluation).not.toHaveBeenCalled();
  });

  it('sends only the scores given, leaving N/A out', async () => {
    const { api, onSubmitted } = renderForm();
    await choose('Communication', '4');
    await choose('Teamwork', '5');
    await choose('Dev', '5');
    await choose('Overall recommendation', 'Yes');
    await userEvent.type(screen.getByRole('textbox', { name: 'Comments (optional)' }), 'Good ownership');
    await userEvent.click(screen.getByRole('button', { name: 'Submit evaluation' }));
    expect(api.submitEvaluation).toHaveBeenCalledWith('i7', { communication: 4, teamwork: 5, fit_dev: 5 }, 'yes', 'Good ownership');
    expect(await screen.findByText('Evaluation submitted')).toBeInTheDocument();
    expect(onSubmitted).toHaveBeenCalled();
  });

  it('keeps a draft on this device until it is submitted', async () => {
    const first = renderForm();
    await choose('Overall recommendation', 'Maybe');
    await userEvent.type(screen.getByRole('textbox', { name: 'Comments (optional)' }), 'Quiet but thoughtful');
    expect(screen.getByText('Draft saved on this device')).toBeInTheDocument();
    first.unmount();

    const second = renderForm();
    expect(screen.getByRole('textbox', { name: 'Comments (optional)' })).toHaveValue('Quiet but thoughtful');
    expect(within(screen.getByRole('group', { name: 'Overall recommendation' })).getByRole('radio', { name: 'Maybe' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Submit evaluation' }));
    await waitFor(() => expect(second.onSubmitted).toHaveBeenCalled());
    expect(localStorage.getItem(draftKey('u-panelist', 'i7'))).toBeNull();
  });

  it('starts from your submitted evaluation and lets you update it', () => {
    renderForm(fakeApi(), {
      saved: { interview_id: 'i7', scores: { communication: 3 }, recommendation: 'no', comments: 'Unprepared', updated_at: '2026-09-26T10:07:00Z' },
    });
    expect(within(screen.getByRole('group', { name: 'Communication' })).getByRole('radio', { name: '3' })).toBeChecked();
    expect(within(screen.getByRole('group', { name: 'Overall recommendation' })).getByRole('radio', { name: 'No' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Update evaluation' })).toBeEnabled();
  });

  it('is read-only once results are published', () => {
    renderForm(fakeApi(), { locked: true });
    expect(screen.getByText('Results are published; evaluations are locked.')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Communication' })).getByRole('radio', { name: '4' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit evaluation' })).toBeDisabled();
  });

  it('says how many panelists have submitted', () => {
    const { unmount } = renderForm(fakeApi(), { count: 0 });
    expect(screen.getByText('No one has submitted yet')).toBeInTheDocument();
    unmount();
    renderForm(fakeApi(), { count: 2 });
    expect(screen.getByText('2 panelists have submitted')).toBeInTheDocument();
  });
});
