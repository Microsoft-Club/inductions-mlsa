import { useEffect, useState, type FormEvent } from 'react';
import { ActionButton, buttonClasses } from '../components/ActionButton.tsx';
import { ActionProvider, useRunAction } from '../components/ActionProvider.tsx';
import { useToast } from '../components/Toasts.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';

const inputClasses = 'mt-1 block h-9 w-full rounded-md border border-slate-300 px-2 text-sm font-normal focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none';

/** Same rules as update_settings(), checked before sending. */
export function settingsProblem(name: string, minutes: string): string | null {
  if (name.trim().length < 1 || name.trim().length > 80) return 'Name must be 1 to 80 characters';
  const n = Number(minutes);
  if (!Number.isInteger(n) || n < 1 || n > 180) return 'Target interview length must be 1 to 180 minutes';
  return null;
}

export function SettingsSection() {
  const api = useApi();
  const toast = useToast();
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    api.induction().then(
      (induction) => {
        setName(induction.name);
        setMinutes(String(induction.target_interview_minutes));
        setLoaded(true);
      },
      (e) => setProblem(errorMessage(e)),
    );
  }, [api]);

  return (
    <section aria-labelledby="settings-title" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 id="settings-title" className="font-semibold">Settings</h2>
      <ActionProvider>
        <SettingsForm
          name={name}
          minutes={minutes}
          disabled={!loaded}
          problem={problem}
          onName={setName}
          onMinutes={setMinutes}
          onProblem={setProblem}
          onSaved={() => toast.show('Settings saved', 'success')}
        />
      </ActionProvider>
    </section>
  );
}

interface SettingsFormProps {
  name: string;
  minutes: string;
  disabled: boolean;
  problem: string | null;
  onName: (value: string) => void;
  onMinutes: (value: string) => void;
  onProblem: (value: string | null) => void;
  onSaved: () => void;
}

function SettingsForm({ name, minutes, disabled, problem, onName, onMinutes, onProblem, onSaved }: SettingsFormProps) {
  const api = useApi();
  const run = useRunAction();
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    const found = settingsProblem(name, minutes);
    onProblem(found);
    if (found) return;
    setSaving(true);
    const done = await run(async () => {
      await api.updateSettings(name.trim(), Number(minutes));
      return true;
    });
    setSaving(false);
    if (done) onSaved();
  }

  return (
    <form noValidate className="grid gap-3 sm:grid-cols-[1fr_14rem_auto]" onSubmit={(e) => void save(e)}>
      <label className="text-sm font-medium">
        Induction name
        <input className={inputClasses} value={name} onChange={(e) => onName(e.target.value)} disabled={disabled} />
      </label>
      <label className="text-sm font-medium">
        Target interview length (minutes)
        <input className={inputClasses} type="number" min={1} max={180} value={minutes} onChange={(e) => onMinutes(e.target.value)} disabled={disabled} />
      </label>
      <div className="flex items-end">
        <button type="submit" className={buttonClasses('primary', 'md')} disabled={disabled || saving}>
          Save settings
        </button>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-3">
          {problem}
        </p>
      )}
    </form>
  );
}

/** The projector's secret link: copy, open, or replace it (old links stop working). */
export function ProjectorLinkSection() {
  const api = useApi();
  const toast = useToast();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const linkFor = (key: string) => `${window.location.origin}/display?key=${encodeURIComponent(key)}`;

  useEffect(() => {
    let active = true;
    api.getDisplayKey().then(
      (key) => active && setLink(linkFor(key)),
      (e) => active && setError(errorMessage(e)),
    );
    return () => {
      active = false;
    };
  }, [api]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.show('Projector link copied', 'success');
    } catch {
      toast.show('Copy failed. Select the link and copy it by hand.', 'error');
    }
  }

  return (
    <section aria-labelledby="projector-title" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <h2 id="projector-title" className="font-semibold">Projector link</h2>
      {link ? (
        <>
          <p className="rounded-md bg-slate-100 px-3 py-2 font-mono text-sm break-all">{link}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClasses('primary')} onClick={() => void copy(link)}>
              Copy link
            </button>
            <a className={buttonClasses('secondary')} href={link} target="_blank" rel="noreferrer">
              Open projector
            </a>
            <ActionProvider>
              <ActionButton
                variant="danger"
                confirm="Make a new projector link? The current link stops working at once; open the new one on the projector."
                action={async () => {
                  setLink(linkFor(await api.regenerateDisplayKey()));
                  toast.show('New projector link made', 'success');
                }}
              >
                Make a new link
              </ActionButton>
            </ActionProvider>
          </div>
        </>
      ) : error ? (
        <p role="alert" className="text-sm text-red-700">{error}</p>
      ) : (
        <p className="text-sm text-slate-500">Loading…</p>
      )}
      <p className="text-sm text-slate-600">Anyone with this link sees the projector screen. Share it only with whoever runs the projector.</p>
    </section>
  );
}
