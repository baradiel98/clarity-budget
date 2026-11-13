import {
  Baby, Briefcase, Car, CircleDashed, Clapperboard, Coffee, Fuel, Gift, GraduationCap, HandCoins, HeartPulse, House, Landmark, PawPrint,
  Plane, Receipt, Repeat, Shield, ShoppingBag, ShoppingBasket, Sparkles, Tag, Utensils, Wifi, Zap, ArrowLeftRight, Scale, type LucideIcon,
} from 'lucide-react';

/** Explicit map (keeps the bundle small; no dynamic icon loading). Names match packages/shared categories. */
const MAP: Record<string, LucideIcon> = {
  'shopping-basket': ShoppingBasket, utensils: Utensils, coffee: Coffee, car: Car, fuel: Fuel, 'shopping-bag': ShoppingBag,
  clapperboard: Clapperboard, 'heart-pulse': HeartPulse, sparkles: Sparkles, gift: Gift, plane: Plane, house: House, zap: Zap, wifi: Wifi,
  shield: Shield, repeat: Repeat, landmark: Landmark, receipt: Receipt, 'graduation-cap': GraduationCap, baby: Baby, 'paw-print': PawPrint,
  'circle-dashed': CircleDashed, briefcase: Briefcase, 'hand-coins': HandCoins, tag: Tag, transfer: ArrowLeftRight, adjustment: Scale,
};

export const CATEGORY_ICON_NAMES = Object.keys(MAP).filter((k) => k !== 'transfer' && k !== 'adjustment');

export function CategoryIcon({ name, size = 17 }: { name: string | undefined; size?: number }) {
  const I = (name && MAP[name]) || Tag;
  return <I size={size} strokeWidth={1.9} aria-hidden />;
}
