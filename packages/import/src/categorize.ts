import type { ID } from '@clarity/shared';

/** Deterministic keyword rules (no AI, nothing leaves the device). First match wins. */
export const KEYWORD_RULES: ReadonlyArray<[RegExp, ID]> = [
  [/payroll|salary|direct dep|paycheck|nomina|n[oó]mina/i, 'cat_paycheck'],
  [/grocer|supermarket|safeway|kroger|whole foods|trader joe|aldi|publix|wegmans|h-e-b|heb |costco|sprouts|food lion|lidl|tesco|sainsbury/i, 'cat_groceries'],
  [/starbucks|coffee|cafe|caf[eé]|dunkin|peet'?s|tim hortons/i, 'cat_coffee'],
  [/restaurant|grill|pizza|burger|taco|sushi|doordash|uber eats|ubereats|grubhub|chipotle|mcdonald|wendy|subway|kitchen|diner|bistro/i, 'cat_dining'],
  [/uber|lyft|transit|metro|parking|toll|mta |bart|train|amtrak|taxi/i, 'cat_transport'],
  [/shell|chevron|exxon|mobil|bp |texaco|gas station|fuel|valero|sunoco|arco/i, 'cat_fuel'],
  [/netflix|spotify|hulu|disney\+|disney plus|apple\.com\/bill|youtube premium|hbo|max\.com|paramount|patreon|icloud/i, 'cat_subscriptions'],
  [/electric|power|energy|water|utility|utilities|gas co|pg&e|con ed|duke energy/i, 'cat_utilities'],
  [/comcast|xfinity|verizon|at&t|t-mobile|tmobile|spectrum|internet|wireless|vodafone/i, 'cat_internet'],
  [/insurance|geico|progressive|state farm|allstate/i, 'cat_insurance'],
  [/rent|mortgage|landlord|property mgmt|apartments/i, 'cat_housing'],
  [/pharmacy|cvs|walgreens|rite aid|doctor|dental|clinic|hospital|medical/i, 'cat_health'],
  [/amazon|amzn|target|walmart|best buy|ikea|etsy|ebay/i, 'cat_shopping'],
  [/cinema|theater|theatre|amc |regal|steam|playstation|xbox|nintendo|ticketmaster/i, 'cat_entertainment'],
  [/airline|airlines|hotel|airbnb|expedia|booking\.com|delta air|united air|southwest/i, 'cat_travel'],
  [/fee|interest charge|overdraft|finance charge/i, 'cat_fees'],
];

export type CategorySource = 'memory' | 'rule' | null;

export function suggestCategory(
  description: string,
  isInflow: boolean,
  memory: ReadonlyMap<string, { categoryId: ID | null }>,
  key: string,
): { categoryId: ID | null; source: CategorySource } {
  const mem = memory.get(key);
  if (mem?.categoryId) return { categoryId: mem.categoryId, source: 'memory' };
  for (const [re, cat] of KEYWORD_RULES) {
    // Inflows only map to income rules; outflows never map to income.
    if (isInflow ? cat !== 'cat_paycheck' : cat === 'cat_paycheck') continue;
    if (re.test(description)) return { categoryId: cat, source: 'rule' };
  }
  return { categoryId: isInflow ? 'cat_other_income' : null, source: isInflow ? 'rule' : null };
}

export const REFUND_RE = /refund|return|reversal|reversed|chargeback|credit adj|devoluci[oó]n|reembolso/i;
export const TRANSFER_RE = /transfer|xfer|trnsfr|to savings|from savings|to checking|from checking|online banking transfer|traspaso|transferencia/i;
export const CARD_PAYMENT_RE = /payment.*thank|thank you.*payment|autopay|auto pay|card payment|credit card payment|epayment|pago tarjeta|pymt|payment received/i;
