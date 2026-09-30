// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../fixtures/form-export-fake.csv?raw';
import { ActionProvider } from '../../../src/components/ActionProvider.tsx';
import { ToastProvider } from '../../../src/components/Toasts.tsx';
import { ApiError, type Api } from '../../../src/lib/api.ts';
import { ApiProvider } from '../../../src/lib/ApiProvider.tsx';
import { ImportDialog } from '../../../src/queue/ImportDialog.tsx';
import { fakeApi } from './helpers.tsx';

function renderDialog(overrides: Partial<Api> = {}) {
  const api = fakeApi(overrides);
  const onClose = vi.fn();
  const onSettled = vi.fn();
  render(
    <ApiProvider api={api}>
      <ToastProvider>
        <ActionProvider onSettled={onSettled}>
          <ImportDialog onClose={onClose} />
        </ActionProvider>
      </ToastProvider>
    </ApiProvider>,
  );
  return { api, onClose, onSettled };
}

async function choose(text: string, name = 'responses.csv') {
  await userEvent.upload(screen.getByLabelText('CSV file'), new File([text], name, { type: 'text/csv' }));
}

describe('ImportDialog', () => {
  it('imports every response in one call and shows the summary with flagged rows', async () => {
    const { api, onSettled } = renderDialog({
      importCandidates: vi.fn(async () => ({
        added: 3,
        updated: 0,
        flagged: [
          { reg_number: '', name: 'No Reg Person', reason: 'Missing registration number; row skipped' },
          { reg_number: '2099101', name: 'Ali Raza', reason: 'Duplicate submission (2 responses); kept the latest' },
        ],
      })),
    });
    await choose(fixture);
    expect(await screen.findByText(/5 responses ready to import/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Import 5 responses' }));
    expect(await screen.findByText('Added 3 · Updated 0')).toBeInTheDocument();
    expect(vi.mocked(api.importCandidates).mock.calls[0][0]).toHaveLength(5);
    expect(screen.getByText('Missing registration number; row skipped')).toBeInTheDocument();
    expect(screen.getByText('Duplicate submission (2 responses); kept the latest')).toBeInTheDocument();
    expect(onSettled).toHaveBeenCalled(); // the board reloads
  });

  it('stops before importing when the columns do not match, and shows which ones', async () => {
    const { api } = renderDialog();
    await choose(fixture.replace(',Registration Number,', ',Reg No,'));
    expect(await screen.findByRole('alert')).toHaveTextContent("The columns don't match the Fall 2026 induction form. Nothing was imported.");
    expect(screen.getByRole('row', { name: '5 (not in the app) Reg No' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: '5 Registration Number (missing)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import/ })).toBeNull();
    expect(api.importCandidates).not.toHaveBeenCalled();
  });

  it('explains an empty file', async () => {
    renderDialog();
    await choose('');
    expect(await screen.findByRole('alert')).toHaveTextContent('The file is empty.');
  });

  it("keeps the file ready when the import fails, and shows the server's message", async () => {
    renderDialog({ importCandidates: vi.fn(() => Promise.reject(new ApiError('Not allowed'))) });
    await choose(fixture);
    await userEvent.click(await screen.findByRole('button', { name: 'Import 5 responses' }));
    expect(await screen.findByText('Not allowed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 5 responses' })).toBeEnabled();
  });
});
