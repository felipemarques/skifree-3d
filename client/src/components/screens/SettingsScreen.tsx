import { useEffect, useState } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Brand, ScreenFrame } from './ScreenFrame';
import type { GameController } from '@/app/gameController';
import type { GameSettings } from '@/types/app';

interface SettingsScreenProps {
  controller: GameController;
  returnMode: 'title' | 'pause';
}

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

  useEffect(() => {
    setForm(controller.getSettingsValues());
  }, [controller]);

  const update = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => {
    setForm(current => ({ ...current, [key]: value }));
  };

  return (
    <ScreenFrame panelClassName="text-center">
      <Brand eyebrow="Setup" title="Settings" />

      <div className="grid gap-3">
        {row('Control Mode', (
          <Select value={form.controlMode} onChange={event => update('controlMode', event.target.value as GameSettings['controlMode'])}>
            <option value="keyboard">Keyboard Only</option>
            <option value="mouse">Mouse Only</option>
            <option value="both">Both</option>
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
        {row('Sound Volume', (
          <Slider min={0} max={1} step={0.1} value={form.sfxVolume} onChange={event => update('sfxVolume', Number(event.target.value))} />
        ), pct(form.sfxVolume))}
        {row('Fog Level', (
          <Slider min={0} max={2} step={0.1} value={form.fogLevel} onChange={event => update('fogLevel', Number(event.target.value))} />
        ), pct(form.fogLevel))}
        {row('Snowfall', (
          <Slider min={0} max={2} step={0.1} value={form.snowVolume} onChange={event => update('snowVolume', Number(event.target.value))} />
        ), pct(form.snowVolume))}
        {row('Obstacles', (
          <Slider min={0} max={2} step={0.1} value={form.obstacleVolume} onChange={event => update('obstacleVolume', Number(event.target.value))} />
        ), pct(form.obstacleVolume))}
        {row('Graphics Quality', (
          <Select value={form.graphicsQuality} onChange={event => update('graphicsQuality', event.target.value as GameSettings['graphicsQuality'])}>
            <option value="high">High</option>
            <option value="low">Low</option>
          </Select>
        ))}
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
      </div>

      <p className="text-center text-[11px] font-bold uppercase tracking-wide text-[#7d92ab]">
        Control Mode, Touch Controls, Mouse Sensitivity, Invert Mouse Y, Fog &amp; Snowfall apply immediately. Sound Volume, Obstacles, graphics quality &amp; run rules apply from your next run.
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
