import { useEffect, useState } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Brand, ScreenFrame } from './ScreenFrame';
import type { GameController } from '@/app/gameController';
import type { GameSettings } from '@/types/app';
import { useTouchActive } from '@/utils/touch';

interface SettingsScreenProps {
  controller: GameController;
}

type SettingsTab = 'gameplay' | 'controls' | 'graphics';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'gameplay', label: 'Gameplay' },
  { id: 'controls', label: 'Controls' },
  { id: 'graphics', label: 'Graphics' },
];

function pct(value: number) {
  return `${Math.round(Number(value) * 100)}%`;
}

function row(label: string, control: React.ReactNode, value?: string) {
  return (
    <label className="grid gap-2 text-left text-sm font-bold text-[#dbeaff]">
      <span className="flex items-center justify-between gap-3">
        {label}
        {value && <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-xs font-extrabold text-cyan-300">{value}</span>}
      </span>
      {control}
    </label>
  );
}

export function SettingsScreen({ controller }: SettingsScreenProps) {
  const [form, setForm] = useState<GameSettings>(() => controller.getSettingsValues());
  const [tab, setTab] = useState<SettingsTab>('gameplay');
  const touchActive = useTouchActive();

  useEffect(() => {
    setForm(controller.getSettingsValues());
  }, [controller]);

  const update = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => {
    setForm(current => ({ ...current, [key]: value }));
  };

  return (
    <ScreenFrame panelClassName="w-[min(620px,calc(100vw-40px))] text-center">
      <Brand eyebrow="Setup" title="Settings" />

      <TabsList className="mx-auto grid-flow-col" role="tablist">
        {TABS.map(t => (
          <TabsTrigger key={t.id} type="button" role="tab" aria-selected={tab === t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {/* Each tab's own row grid, not one 14-row list - splitting by category
          both fixed the original overflow (far fewer rows visible at once)
          and reads better than an undifferentiated wall of settings. The
          screen-backdrop scroll fallback (index.css) still covers whatever's
          left on a genuinely tiny viewport. */}
      {tab === 'gameplay' && (
        <div className="grid gap-3 sm:grid-cols-2" role="tabpanel">
          {row('Sound Volume', (
            <Slider min={0} max={1} step={0.1} value={form.sfxVolume} onChange={event => update('sfxVolume', Number(event.target.value))} />
          ), pct(form.sfxVolume))}
          {row('Obstacles', (
            <Slider min={0} max={2} step={0.1} value={form.obstacleVolume} onChange={event => update('obstacleVolume', Number(event.target.value))} />
          ), pct(form.obstacleVolume))}
          {row('Difficulty', (
            <Select value={form.difficulty} onChange={event => update('difficulty', event.target.value as GameSettings['difficulty'])}>
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
              <option value="extreme">Extreme</option>
            </Select>
          ))}
          {row('Yeti Mode', (
            <Select value={form.yetiStartMode} onChange={event => update('yetiStartMode', event.target.value as GameSettings['yetiStartMode'])}>
              <option value="distance">Distance Trigger</option>
              <option value="immediate">Hunt From Start</option>
              <option value="disabled">No Yeti</option>
            </Select>
          ))}
          <div className="grid gap-1">
            <label className="flex items-center justify-between gap-3 text-sm font-bold text-[#dbeaff]">
              Difficulty Ramp
              <Checkbox checked={!!form.difficultyRamp} onChange={event => update('difficultyRamp', event.target.checked)} />
            </label>
            <p className="text-left text-[11px] leading-snug text-[#7d92ab]">Obstacle and ramp density gradually increase the further you ski.</p>
          </div>
          <div className="grid gap-1">
            <label className="flex items-center justify-between gap-3 text-sm font-bold text-[#dbeaff]">
              Skill Scoring
              <Checkbox checked={!!form.skillScoring} onChange={event => update('skillScoring', event.target.checked)} />
            </label>
            <p className="text-left text-[11px] leading-snug text-[#7d92ab]">Rewards risky play - ramp chains, clean runs, near misses, and yeti danger all add bonus distance.</p>
          </div>
          <div className="grid gap-1">
            <label className="flex items-center justify-between gap-3 text-sm font-bold text-[#dbeaff]">
              Snowball NPCs
              <Checkbox checked={!!form.snowballNpcs} onChange={event => update('snowballNpcs', event.target.checked)} />
            </label>
            <p className="text-left text-[11px] leading-snug text-[#7d92ab]">Hostile skiers along the trail throw snowballs as you pass - a hit costs a heart.</p>
          </div>
        </div>
      )}

      {tab === 'controls' && (
        <div className="grid gap-3 sm:grid-cols-2" role="tabpanel">
          {row('Control Mode', (
            <Select value={form.controlMode} onChange={event => update('controlMode', event.target.value as GameSettings['controlMode'])}>
              <option value="keyboard">Keyboard Only</option>
              <option value="mouse">Mouse Only</option>
              <option value="both">Both</option>
              {/* Tilt steering only makes sense on a device that actually has
                  a gyroscope and a touchscreen to hold - hidden on desktop
                  (mouse-primary) rather than offering a mode that silently
                  does nothing there. See GyroControl.ts for the permission
                  flow triggered when this is saved or a run starts. */}
              {touchActive && <option value="gyro">Gyroscope (Tilt)</option>}
            </Select>
          ))}
          {row('Touch Controls', (
            <Select value={form.touchControls} onChange={event => update('touchControls', event.target.value as GameSettings['touchControls'])}>
              <option value="auto">Auto-detect</option>
              <option value="on">Always On</option>
              <option value="off">Always Off</option>
            </Select>
          ))}
          {row('Mouse Sensitivity', (
            <Slider min={0.5} max={2} step={0.1} value={form.mouseSensitivity} onChange={event => update('mouseSensitivity', Number(event.target.value))} />
          ), Number(form.mouseSensitivity).toFixed(1))}
          <label className="flex items-center justify-between gap-3 text-sm font-bold text-[#dbeaff]">
            Invert Mouse Y
            <Checkbox checked={form.invertMouseY} onChange={event => update('invertMouseY', event.target.checked)} />
          </label>
          {form.controlMode === 'gyro' && (
            <div className="grid gap-1">
              <label className="flex items-center justify-between gap-3 text-sm font-bold text-[#dbeaff]">
                Invert Tilt Steering
                <Checkbox checked={!!form.invertGyroX} onChange={event => update('invertGyroX', event.target.checked)} />
              </label>
              <p className="text-left text-[11px] leading-snug text-[#7d92ab]">Flip left/right if steering feels backwards for how you're holding the phone.</p>
            </div>
          )}
        </div>
      )}

      {tab === 'graphics' && (
        <div className="grid gap-3 sm:grid-cols-2" role="tabpanel">
          {row('Graphics Quality', (
            <Select value={form.graphicsQuality} onChange={event => update('graphicsQuality', event.target.value as GameSettings['graphicsQuality'])}>
              <option value="high">High</option>
              <option value="low">Low</option>
            </Select>
          ))}
          {row('Fog Level', (
            <Slider min={0} max={2} step={0.1} value={form.fogLevel} onChange={event => update('fogLevel', Number(event.target.value))} />
          ), pct(form.fogLevel))}
          {row('Snowfall', (
            <Slider min={0} max={2} step={0.1} value={form.snowVolume} onChange={event => update('snowVolume', Number(event.target.value))} />
          ), pct(form.snowVolume))}
        </div>
      )}

      <p className="text-center text-[11px] font-bold uppercase tracking-wide text-[#7d92ab]">
        Control Mode, Touch Controls, Mouse Sensitivity, Invert Mouse Y, Invert Tilt Steering, Fog, Snowfall &amp; Sound Volume apply as soon as you hit Save - no new run needed. Graphics Quality, Obstacles &amp; run rules (difficulty, yeti, etc.) apply from your next run.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" onClick={() => controller.saveSettingsForm(form)}>
          <Save className="h-4 w-4" />
          Save
        </Button>
        <Button variant="secondary" type="button" onClick={() => controller.closeSettings()}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>
    </ScreenFrame>
  );
}
