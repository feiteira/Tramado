// ClassTab (UX §1.3, §2.11): the class mark — a rounded square in the class colour with its lucide icon.
import React from 'react';
import {
  Atom, BookMarked, BookOpen, Brain, BriefcaseBusiness, Building2, Calculator, ChartLine, Code, Cpu, Dna, DraftingCompass, Earth, FlaskConical, Gavel, Globe, GraduationCap, Hammer, HeartPulse, Landmark, Languages, Leaf, Library, Lightbulb, Microscope, Music, Palette, PencilRuler, Pi, Scale, Sigma, Stethoscope, Utensils,
  type LucideIcon,
} from 'lucide-react';
import type { ClassIconName } from '../classIcons';
import { classStyle } from '../classColor';
import { cx } from '../cx';
import './tramado.css';

/** The 33 class icons (UX §1.3), imported one by one so the bundle carries only these. */
export const CLASS_ICON_COMPONENTS: Record<ClassIconName, LucideIcon> = {
  'scale': Scale,
  'gavel': Gavel,
  'landmark': Landmark,
  'calculator': Calculator,
  'sigma': Sigma,
  'pi': Pi,
  'chart-line': ChartLine,
  'flask-conical': FlaskConical,
  'atom': Atom,
  'dna': Dna,
  'microscope': Microscope,
  'stethoscope': Stethoscope,
  'heart-pulse': HeartPulse,
  'brain': Brain,
  'code': Code,
  'cpu': Cpu,
  'palette': Palette,
  'music': Music,
  'drafting-compass': DraftingCompass,
  'pencil-ruler': PencilRuler,
  'globe': Globe,
  'earth': Earth,
  'languages': Languages,
  'book-open': BookOpen,
  'library': Library,
  'book-marked': BookMarked,
  'briefcase-business': BriefcaseBusiness,
  'building-2': Building2,
  'leaf': Leaf,
  'utensils': Utensils,
  'hammer': Hammer,
  'lightbulb': Lightbulb,
  'graduation-cap': GraduationCap,
};
const SIZES = { sm: { box: 18, icon: 12 }, md: { box: 22, icon: 14 }, lg: { box: 40, icon: 22 } } as const;

export interface ClassTabProps {
  color: string;
  icon: ClassIconName;
  size?: 'sm' | 'md' | 'lg';
  filled?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function ClassTab({ color, icon, size = 'md', filled = false, className, ...rest }: ClassTabProps) {
  const Icon = classIconComponent(icon);
  const s = SIZES[size];
  return (
    <span
      aria-hidden
      className={cx('cls-scope', 'class-tab', `class-tab--${size}`, filled && 'class-tab--filled', className)}
      style={{ ...classStyle(color), width: s.box, height: s.box }}
      data-testid={rest['data-testid']}
    >
      <Icon size={s.icon} strokeWidth={1.75} />
    </span>
  );
}

/** The lucide component of a class icon name (shared by rail, header and chips). */
export function classIconComponent(icon: string): LucideIcon {
  return CLASS_ICON_COMPONENTS[icon as ClassIconName] ?? BookOpen;
}
