import type { CSSProperties } from 'react';
import { useTutorial } from '../../store/tutorialStore';
import type { TutorialStep } from '../../store/tutorialStore';

export function PulseBeacon({ step, style }: { step: TutorialStep; style?: CSSProperties }) {
  const tutorial = useTutorial();
  if (!tutorial.walkthroughActive || tutorial.currentStep !== step) return null;

  return (
    <span style={{
      display: 'inline-block',
      position: 'relative',
      width: 10,
      height: 10,
      ...style,
    }}>
      <span style={{
        position: 'absolute',
        inset: 0,
        borderRadius: '50%',
        background: '#0e7490',
        animation: 'beaconPulse 1.4s ease-out infinite',
      }} />
      <span style={{
        position: 'absolute',
        inset: 2,
        borderRadius: '50%',
        background: '#67e8f9',
      }} />
    </span>
  );
}
