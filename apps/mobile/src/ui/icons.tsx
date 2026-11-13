import {
  ArrowLeftRight, Baby, Briefcase, Car, CircleDashed, Clapperboard, Coffee, Fuel, Gift, GraduationCap, HandCoins, HeartPulse, House, Landmark,
  PawPrint, Plane, Receipt, Repeat, Scale, Shield, ShoppingBag, ShoppingBasket, Sparkles, Tag, Utensils, Wifi, Zap, type LucideIcon,
} from 'lucide-react-native';

/** Same icon names as the web app (packages/shared categories). */
const MAP: Record<string, LucideIcon> = {
  'shopping-basket': ShoppingBasket, utensils: Utensils, coffee: Coffee, car: Car, fuel: Fuel, 'shopping-bag': ShoppingBag, clapperboard: Clapperboard,
  'heart-pulse': HeartPulse, sparkles: Sparkles, gift: Gift, plane: Plane, house: House, zap: Zap, wifi: Wifi, shield: Shield, repeat: Repeat, landmark: Landmark,
  receipt: Receipt, 'graduation-cap': GraduationCap, baby: Baby, 'paw-print': PawPrint, 'circle-dashed': CircleDashed, briefcase: Briefcase, 'hand-coins': HandCoins,
  tag: Tag, transfer: ArrowLeftRight, adjustment: Scale,
};

export function CategoryIcon({ name, size = 17, color }: { name: string | undefined; size?: number; color: string }) {
  const I = (name && MAP[name]) || Tag;
  return <I size={size} color={color} strokeWidth={1.9} />;
}
