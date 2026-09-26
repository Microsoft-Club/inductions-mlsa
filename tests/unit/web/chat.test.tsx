// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionProvider } from '../../../src/components/ActionProvider.tsx';
import { ToastProvider } from '../../../src/components/Toasts.tsx';
import { ApiError } from '../../../src/lib/api.ts';
import { ApiProvider } from '../../../src/lib/ApiProvider.tsx';
import type { ChatMessage } from '../../../src/lib/types.ts';
import { ChatPanel } from '../../../src/panel/ChatPanel.tsx';
import { useInterviewLive } from '../../../src/panel/useInterviewLive.ts';
import { fakeApi, type FakeApi } from './helpers.tsx';

const message = (id: string, author_id: string, author_name: string, body: string): ChatMessage => ({
  id, interview_id: 'i7', author_id, author_name, body, created_at: '2026-09-26T09:55:00Z',
});
const existing = [message('m1', 'u1', 'Hamza', 'Strong on teamwork.'), message('m2', 'u-panelist', 'Test panelist', 'Agreed.')];

function Chat() {
  const live = useInterviewLive('i7');
  return <ChatPanel interviewId="i7" live={live} meId="u-panelist" />;
}

function renderChat(api: FakeApi) {
  return render(
    <ApiProvider api={api}>
      <ToastProvider>
        <ActionProvider>
          <Chat />
        </ActionProvider>
      </ToastProvider>
    </ApiProvider>,
  );
}

const log = () => screen.getByRole('log', { name: 'Messages' });

beforeEach(() => sessionStorage.clear());

describe('the panel discussion', () => {
  it("shows the interview's messages, marking your own", async () => {
    renderChat(fakeApi({ interviewMessages: vi.fn(async () => existing) }));
    expect(await within(log()).findByText('Strong on teamwork.')).toBeInTheDocument();
    expect(log()).toHaveTextContent('Hamza');
    expect(log()).toHaveTextContent('You');
  });

  it('shows a sent message at once, then keeps just the saved copy', async () => {
    let finish!: (m: ChatMessage) => void;
    const postMessage = vi.fn((_interviewId: string, _body: string, _id: string) => new Promise<ChatMessage>((resolve) => (finish = resolve)));
    const api = fakeApi({ interviewMessages: vi.fn(async () => existing), postMessage });
    renderChat(api);
    await within(log()).findByText('Agreed.');

    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Great answer on ownership{Enter}');
    expect(within(log()).getByText('Great answer on ownership')).toBeInTheDocument();
    expect(within(log()).getByText('Sending…')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    const [, body, id] = postMessage.mock.calls[0];
    expect(body).toBe('Great answer on ownership');

    const saved = message(id, 'u-panelist', 'Test panelist', body);
    vi.mocked(api.interviewMessages).mockResolvedValue([...existing, saved]);
    await act(async () => finish(saved));
    await waitFor(() => expect(within(log()).queryByText('Sending…')).toBeNull());
    expect(within(log()).getAllByText('Great answer on ownership')).toHaveLength(1);
  });

  it('offers Retry when a message fails, and retries with the same id so it posts once', async () => {
    const postMessage = vi.fn().mockRejectedValueOnce(new ApiError("Can't reach the server.")).mockImplementation(
      async (_interviewId: string, body: string, id: string) => message(id, 'u-panelist', 'Test panelist', body),
    );
    renderChat(fakeApi({ postMessage }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Ask about Git{Enter}');
    expect(await within(log()).findByText('Not sent')).toBeInTheDocument();

    await userEvent.click(within(log()).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
    expect(postMessage.mock.calls[1][2]).toBe(postMessage.mock.calls[0][2]);
  });

  it('adds a line break with Shift+Enter and never sends a blank message', async () => {
    const api = fakeApi();
    renderChat(api);
    const box = screen.getByRole('textbox', { name: 'Message' });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.type(box, '   {Enter}');
    expect(api.postMessage).not.toHaveBeenCalled();
    await userEvent.clear(box);
    await userEvent.type(box, 'Line one{Shift>}{Enter}{/Shift}Line two');
    expect(box).toHaveValue('Line one\nLine two');
  });

  it("shows other panelists' messages as they arrive", async () => {
    const api = fakeApi({ interviewMessages: vi.fn(async () => existing) });
    renderChat(api);
    await within(log()).findByText('Agreed.');
    vi.mocked(api.interviewMessages).mockResolvedValue([...existing, message('m3', 'u2', 'Mariam', 'Ask about deadlines.')]);
    act(() => api.topics.interview.event());
    expect(await within(log()).findByText('Ask about deadlines.')).toBeInTheDocument();
    expect(api.subscribeInterview).toHaveBeenCalledWith('i7');
  });
});

describe('coming back to an interview', () => {
  it('still has the message that failed and the text being typed, and retries with the same id', async () => {
    const api = fakeApi({
      interviewMessages: vi.fn(async () => existing),
      postMessage: vi.fn(async () => {
        throw new ApiError("Can't reach the server");
      }),
    });
    const first = renderChat(api);
    await within(log()).findByText('Agreed.');
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Ask about Docker{Enter}');
    expect(await within(log()).findByText('Not sent')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Half typed');
    first.unmount(); // the next candidate was sent in; later the panelist opens this interview again

    renderChat(api);
    await within(log()).findByText('Agreed.');
    expect(within(log()).getByText('Ask about Docker')).toBeInTheDocument();
    expect(within(log()).getByText('Not sent')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Half typed');

    const id = vi.mocked(api.postMessage).mock.calls[0][2];
    vi.mocked(api.postMessage).mockImplementation(async (_interviewId, body, messageId) => message(messageId, 'u-panelist', 'Test panelist', body));
    await userEvent.click(within(log()).getByRole('button', { name: 'Retry' }));
    expect(api.postMessage).toHaveBeenLastCalledWith('i7', 'Ask about Docker', id);
  });
});

/** The colour class on a name, e.g. text-sky-700. */
const colourOf = (el: HTMLElement) => [...el.classList].find((c) => /^text-[a-z]+-\d{3}$/.test(c));

describe('names in the discussion', () => {
  it('gives each panelist a colour of their own, the same on every message', async () => {
    const api = fakeApi({
      interviewMessages: vi.fn(async () => [
        message('m1', 'u1', 'Hamza', 'One'),
        message('m2', 'u2', 'Mariam', 'Two'),
        message('m3', 'u1', 'Hamza', 'Three'),
        message('m4', 'u-panelist', 'Test panelist', 'Four'),
      ]),
    });
    renderChat(api);
    await within(log()).findByText('Four');
    const [first, again] = within(log()).getAllByText('Hamza').map(colourOf);
    const mariam = colourOf(within(log()).getByText('Mariam'));
    const you = colourOf(within(log()).getByText('You'));
    expect(first).toBe(again);
    expect(new Set([first, mariam, you]).size).toBe(3);
  });
});
