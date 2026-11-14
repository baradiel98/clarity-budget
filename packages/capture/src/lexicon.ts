import type { ID } from '@clarity/shared';

/**
 * Everyday words → Clarity's default category ids. Used only when that category exists in the
 * user's list; Capture never creates categories. The user's own category names are matched first.
 */
export const CATEGORY_WORDS: ReadonlyArray<[RegExp, ID]> = [
  [/\b(?:electric(?:ity)?|water bill|utilities|utility|power bill|gas bill)\b/i, 'cat_utilities'],
  [/\b(?:pets?|vet|dog food|cat food)\b/i, 'cat_pets'],
  [/\b(?:groceries|grocery|food shopping|supermarket)\b/i, 'cat_groceries'],
  [/\b(?:coffee|latte|espresso|cappuccino|tea)\b/i, 'cat_coffee'],
  [/\b(?:lunch|dinner|breakfast|brunch|restaurant|takeout|take-out|take out|eating out|dining|food|pizza|drinks)\b/i, 'cat_dining'],
  [/\b(?:gas|fuel|petrol|diesel|fill(?:ed)?[- ]up)\b/i, 'cat_fuel'],
  [/\b(?:uber|lyft|taxi|cab|bus|train|subway|metro|parking|tolls?|transport(?:ation)?|ride)\b/i, 'cat_transport'],
  [/\b(?:rent|mortgage)\b/i, 'cat_housing'],
  [/\b(?:internet|phone bill|cell(?:phone)? bill|wifi|mobile plan)\b/i, 'cat_internet'],
  [/\b(?:insurance)\b/i, 'cat_insurance'],
  [/\b(?:subscription|streaming)\b/i, 'cat_subscriptions'],
  [/\b(?:loan|student loan|car payment|debt)\b/i, 'cat_loans'],
  [/\b(?:fees?|interest|late charge|overdraft)\b/i, 'cat_fees'],
  [/\b(?:doctor|dentist|medicine|medication|pharmacy|prescription|copay|health(?:care)?|medical)\b/i, 'cat_health'],
  [/\b(?:haircut|salon|barber|toiletries|personal care|cosmetics|makeup|skincare)\b/i, 'cat_personal'],
  [/\b(?:movies?|cinema|concert|tickets?|games?|entertainment|show)\b/i, 'cat_entertainment'],
  [/\b(?:flight|hotel|airbnb|travel|vacation|trip)\b/i, 'cat_travel'],
  [/\b(?:gifts?|present|birthday)\b/i, 'cat_gifts'],
  [/\b(?:clothes|clothing|shoes|shopping)\b/i, 'cat_shopping'],
  [/\b(?:tuition|books|course|school|class)\b/i, 'cat_education'],
  [/\b(?:daycare|childcare|babysitter|kids|diapers)\b/i, 'cat_kids'],
];

/** Well-known merchants, for recognising them in lowercase text and writing them properly. */
export const KNOWN_MERCHANTS: readonly string[] = [
  'Walmart', 'Target', 'Costco', 'Amazon', 'Whole Foods', "Trader Joe's", 'Kroger', 'Safeway', 'Publix', 'Aldi', 'Starbucks', "Dunkin'",
  'Shell', 'Chevron', 'Exxon', 'Mobil', 'BP', 'Valero', 'Uber', 'Lyft', 'Netflix', 'Spotify', 'Hulu', 'Apple', 'Google',
  "McDonald's", 'Chipotle', 'Subway', 'Taco Bell', 'Chick-fil-A', 'DoorDash', 'Uber Eats', 'Instacart', 'CVS', 'Walgreens',
  'Home Depot', "Lowe's", 'Best Buy', 'IKEA', 'Etsy', 'eBay', 'Venmo', 'PayPal', 'Comcast', 'Verizon', 'AT&T', 'T-Mobile', 'Sephora', 'Ulta',
];

/** Words that end a merchant name ("at Walmart on groceries" → "Walmart"). */
export const MERCHANT_STOP = /^(?:on|for|in|with|using|via|by|today|tonight|yesterday|this|last|and|then|but|plus|also|from|to|at|around|about|when|which|that|because|so|my|the|a|an|i|we|it|of)$/i;
