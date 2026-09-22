import * as Tone from 'tone';
import { TYPE_DAY, TYPE_NIGHT } from '../config/constants';
import type { SimState } from './state';

let synth: Tone.PolySynth | null = null;

export function initAudio(): void {
  if (synth) return;
  synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 0.005, decay: 0.08, sustain: 0, release: 0.08 },
  }).toDestination();
  synth.volume.value = -12;
}

export function playBounceSound(state: SimState, type: number): void {
  if (!state.soundEnabled || !synth) return;
  try {
    void Tone.start();
    const note =
      type === TYPE_DAY ? state.themes[TYPE_DAY].note : state.themes[TYPE_NIGHT].note;
    synth.triggerAttackRelease(note, '32n');
  } catch {
    /* ignore audio gesture errors */
  }
}
