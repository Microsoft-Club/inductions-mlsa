// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActionProvider } from '../../../src/components/ActionProvider.tsx';
import { ToastProvider } from '../../../src/components/Toasts.tsx';
import { ApiProvider } from '../../../src/lib/ApiProvider.tsx';
import { ClockProvider } from '../../../src/lib/ClockProvider.tsx';
import type { Candidate } from '../../../src/lib/types.ts';
import { ApplicationTabs } from '../../../src/panel/ApplicationTabs.tsx';
import { visibleSections } from '../../../src/panel/applicationView.ts';
import { CandidateCard, type CardInterview } from '../../../src/panel/CandidateCard.tsx';
import { candidateRow } from './fixtures.ts';
import { fakeApi } from './helpers.tsx';

function renderApplication(candidate: Candidate = candidateRow(), interview?: CardInterview) {
  const api = fakeApi();
  render(
    <ApiProvider api={api}>
      <ToastProvider>
        <ClockProvider serverNow={api.serverNow}>
          <ActionProvider>
            <CandidateCard candidate={candidate} interview={interview} targetMinutes={15} />
            <ApplicationTabs candidate={candidate} />
          </ActionProvider>
        </ClockProvider>
      </ToastProvider>
    </ApiProvider>,
  );
  return api;
}

describe('visibleSections', () => {
  it('keeps only answered questions, and only sections with an answer', () => {
    const sections = visibleSections(candidateRow());
    expect(sections.map((s) => s.label)).toEqual(['General', 'Dev', 'L&D']);
    expect(sections[0].answers).toEqual([{ q: 'What motivated you to join Microsoft Club?', a: 'I like building things with others.' }]);
  });

  it('shows the Brainees answers after Marketing, for people who answered them', () => {
    const answered = candidateRow({
      answers: { ...candidateRow().answers, brainees: [{ q: 'Why do you want to do research?', a: 'To find out how people learn.' }] },
    });
    const sections = visibleSections(answered);
    expect(sections.map((s) => s.label)).toEqual(['General', 'Dev', 'L&D', 'Brainees']);
    expect(sections[3].answers).toEqual([{ q: 'Why do you want to do research?', a: 'To find out how people learn.' }]);
  });
});

describe('the application', () => {
  it("shows the candidate's card with ranked preferences", () => {
    renderApplication();
    const card = screen.getByRole('region', { name: 'Candidate #7' });
    expect(within(card).getByRole('heading', { name: '#7 Sara Ahmed' })).toBeInTheDocument();
    expect(card).toHaveTextContent('2025007 · Computer Science · B35');
    expect(within(card).getByRole('list', { name: 'Team preferences' })).toHaveTextContent('1Dev Team2Marketing');
  });

  it('has a tab per answered section plus Contact, and hides blank answers', async () => {
    renderApplication();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['General', 'Dev', 'L&D', 'Contact']);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('I like building things with others.');
    expect(screen.queryByText('Tell us about something that you are proud of.')).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: 'Contact' }));
    const contact = screen.getByRole('tabpanel');
    expect(contact).toHaveTextContent('sara@example.test');
    expect(contact).toHaveTextContent('sara.account@example.test');
    expect(contact).toHaveTextContent('03001234507');
  });

  it('puts each question and its answer in a numbered box of their own', () => {
    renderApplication(candidateRow({
      answers: { general: [{ q: 'Why MLSA?', a: 'To learn.' }, { q: 'How many hours a week?', a: '6' }] },
    }));
    const questions = screen.getAllByRole('term');
    const answers = screen.getAllByRole('definition');
    expect(questions.map((q) => q.textContent)).toEqual(['Q1Why MLSA?', 'Q2How many hours a week?']);
    expect(answers.map((a) => a.textContent)).toEqual(['To learn.', '6']);
    // A question and its answer share a box, and each pair has its own.
    expect(questions[0].parentElement).toBe(answers[0].parentElement);
    expect(questions[1].parentElement).toBe(answers[1].parentElement);
    expect(questions[0].parentElement).not.toBe(questions[1].parentElement);
  });

  it('lists contact details as plain label and value, without question numbers', async () => {
    renderApplication();
    await userEvent.click(screen.getByRole('tab', { name: 'Contact' }));
    const labels = within(screen.getByRole('tabpanel')).getAllByRole('term').map((t) => t.textContent);
    expect(labels).toEqual(['Email', 'Google account', 'Phone (WhatsApp)', 'Registration number', 'Department', 'Batch']);
  });

  it('keeps line breaks and lets Urdu answers run right to left', () => {
    renderApplication(candidateRow({ answers: { general: [{ q: 'Why?', a: 'پہلی لائن\nدوسری لائن' }] } }));
    const answer = screen.getByText((_, el) => el?.tagName === 'DD' && el.textContent === 'پہلی لائن\nدوسری لائن');
    expect(answer).toHaveAttribute('dir', 'auto');
    expect(answer).toHaveClass('whitespace-pre-wrap');
  });

  it('shows the live timer and End interview while the interview runs, and asks before ending', async () => {
    const api = renderApplication(candidateRow(), { id: 'i7', status: 'in_progress', started_at: new Date().toISOString(), ended_at: null });
    expect(screen.getByText('00:00')).toBeInTheDocument();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await userEvent.click(screen.getByRole('button', { name: 'End interview' }));
    expect(confirm).toHaveBeenCalledWith('End the interview with #7 Sara Ahmed?');
    expect(api.endInterview).not.toHaveBeenCalled(); // cancelled
    await userEvent.click(screen.getByRole('button', { name: 'End interview' }));
    expect(api.endInterview).toHaveBeenCalledWith('i7');
    confirm.mockRestore();
  });

  it('says when an interview has ended, without an End button', () => {
    renderApplication(candidateRow(), { id: 'i7', status: 'ended', started_at: '2026-09-26T09:50:00Z', ended_at: '2026-09-26T10:06:30Z' });
    expect(screen.getByText('Interview ended · 16:30')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End interview' })).toBeNull();
  });
});
