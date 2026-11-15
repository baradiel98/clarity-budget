import type { Account, ID } from '@clarity/shared';

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

/**
 * Phase 4A.8 (audit 4A.7.1 N4): is this outgoing description a payment to a credit card, and to which of the user's
 * cards? Evidence, never a decision: the row stays unselected until the user confirms the card (the review's existing
 * rule for transfers). It is a card payment when:
 * - the wording says so (CARD_PAYMENT_RE: "PAYMENT THANK YOU", "AUTOPAY", "CARD PAYMENT", …); or
 * - it says "payment" (PAYMENT, PMT, PYMT, PYMNT) AND names a card: a card network or issuer word (VISA, MASTERCARD,
 *   AMEX, AMERICAN EXPRESS, DISCOVER) or the name of one of the user's credit-card accounts ("PAYMENT TO VISA",
 *   "VISA PAYMENT", "CHASE FREEDOM PMT").
 * "Payment" alone ("PAYMENT TO CITY WATER", "ONLINE PAYMENT 1234") or a card word alone ("VISA GIFT CARD", "VISA DEBIT
 * PURCHASE") is not enough. `cardId`: the one card the description names (by account name, or by a network word that
 * only one card's name contains); null when none or several could be meant.
 */
const PAYMENT_WORD_RE = /\b(payment|pmt|pymt|pymnt|paymt)\b/i;
const CARD_NETWORK_RE = /\b(visa|mastercard|master card|amex|american express|discover)\b/i;
const NAME_STOP = new Set(['card', 'credit', 'bank', 'account', 'the', 'my', 'rewards', 'cash', 'back', 'checking', 'savings']);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function cardPaymentEvidence(description: string, accounts: readonly Pick<Account, 'id' | 'name' | 'type' | 'archived'>[]): { looks: boolean; cardId: ID | null } {
  const d = ` ${words(description)} `;
  const cards = accounts.filter((a) => a.type === 'credit_card' && !a.archived);
  const named = cards.filter((a) => {
    const n = words(a.name);
    if (n && d.includes(` ${n} `)) return true;
    return n.split(' ').some((w) => w.length >= 4 && !NAME_STOP.has(w) && d.includes(` ${w} `));
  });
  const network = description.match(CARD_NETWORK_RE)?.[1]?.toLowerCase().replace('master card', 'mastercard').replace('american express', 'amex');
  const byNetwork = network ? cards.filter((a) => words(a.name).replace('american express', 'amex').split(' ').includes(network)) : [];
  const looks = CARD_PAYMENT_RE.test(description) || (PAYMENT_WORD_RE.test(description) && (!!network || named.length > 0));
  const pickFrom = named.length ? named : byNetwork;
  return { looks, cardId: looks && pickFrom.length === 1 ? pickFrom[0]!.id : null };
}
