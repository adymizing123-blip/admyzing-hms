import { HeartPulse, Bone, Baby, Brain, Stethoscope, Flower2, Sparkles, Siren, Activity } from 'lucide-react';

const map: Record<string, any> = { HeartPulse, Bone, Baby, Brain, Stethoscope, Flower2, Sparkles, Siren };

export default function DeptIcon({ name, size = 22 }: { name?: string; size?: number }) {
  const Icon = (name && map[name]) || Activity;
  return <Icon size={size} />;
}
