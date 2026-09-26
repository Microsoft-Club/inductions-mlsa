// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/lib/api.ts';
import { fakeApi, renderApp } from './helpers.tsx';

const selected = [
  { full_name: 'Ali Raza', reg_number: '2025101' },
  { full_name: "Zara O'Brien-Khan", reg_number: '2025103' },
  { full_name: 'عائشہ خان', reg_number: '2025102' },
];

describe('the public results page', () => {
  it('lists the selected candidates once results are published, without a login', async () => {
    renderApp('/selected', { api: fakeApi({ publishedResults: vi.fn(async () => selected) }) });
    const list = await screen.findByRole('list', { name: 'Selected candidates' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Ali Raza2025101', "Zara O'Brien-Khan2025103", 'عائشہ خان2025102',
    ]);
    expect(screen.getByText('3 candidates selected')).toBeInTheDocument();
    expect(document.title).toBe('Induction results · Microsoft Club GIKI');
  });

  it('finds your name or reg number, however it is typed', async () => {
    renderApp('/selected', { api: fakeApi({ publishedResults: vi.fn(async () => selected) }) });
    const find = await screen.findByRole('searchbox', { name: 'Find your name or reg number' });
    await userEvent.type(find, ' 2025 102 ');
    expect(within(screen.getByRole('list', { name: 'Selected candidates' })).getAllByRole('listitem')).toHaveLength(1);
    await userEvent.clear(find);
    await userEvent.type(find, 'nobody');
    expect(screen.getByText('No selected candidate matches “nobody”. Check the spelling, or search by reg number.')).toBeInTheDocument();
  });

  it('counts one selected candidate in the singular', async () => {
    renderApp('/selected', { api: fakeApi({ publishedResults: vi.fn(async () => selected.slice(0, 1)) }) });
    expect(await screen.findByText('1 candidate selected')).toBeInTheDocument();
  });

  it('says results are not announced yet before publishing', async () => {
    renderApp('/selected', { api: fakeApi({ publishedResults: vi.fn(async () => []) }) });
    expect(await screen.findByRole('heading', { name: 'Results not announced yet' })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('offers to try again when the results cannot be loaded', async () => {
    const publishedResults = vi.fn().mockRejectedValueOnce(new ApiError("Can't reach the server.")).mockResolvedValue(selected);
    renderApp('/selected', { api: fakeApi({ publishedResults }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Selected candidates' })).toBeInTheDocument();
  });
});
