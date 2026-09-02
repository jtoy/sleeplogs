/**
 * Inspirational health quotes shown on the dashboard.
 * Shuffled randomly on page load (see page.tsx).
 */

export const HEALTH_QUOTES: string[] = [
  "Sleep is the best meditation.",
  "Take care of your body. It's the only place you have to live.",
  "A good laugh and a long sleep are the best cures in the doctor's book.",
  "Early to bed and early to rise makes a man healthy, wealthy, and wise.",
  "The groundwork for all happiness is good health.",
  "Health is a state of body. Wellness is a state of being.",
  "Every morning you are born again. What you do today matters most.",
  "Rest when you're weary. Refresh and renew yourself, your body, your energy, your spirit.",
  "The body achieves what the mind believes.",
  "It is health that is real wealth and not pieces of gold and silver.",
  "Take rest; a field that has rested gives a bountiful crop.",
  "Your body hears everything your mind says. Stay positive.",
  "Getting enough sleep is not a luxury — it's a necessity for a sharp mind.",
  "Well begun is half done — and a calm morning starts the night before.",
  "A healthy outside starts from the inside.",
  "To keep the body in good health is a duty... otherwise we shall not be able to keep our mind strong and clear.",
  "The best way to predict your health is to create it.",
  "He who has health has hope, and he who has hope has everything.",
  "Quiet the mind, and the soul will speak. Rest, and the body will recover.",
  "Strength does not come from the body. It comes from the will.",
  "Sleep is the golden chain that ties health and our bodies together.",
  "A journey of a thousand miles begins with a single step — take that first walk today.",
  "Your morning habits are tomorrow's health.",
  "Water is the driving force of all nature — drink up.",
  "The greatest wealth is health, and the greatest wealth transfer is good habits.",
  "Nourish your body with good food, your mind with good thoughts, your soul with good rest.",
  "Motivation is what gets you started. Habit is what keeps you going.",
  "You don't have to be extreme, just consistent — small healthy steps compound.",
  "Energy and persistence conquer all things — and sleep fuels both.",
  "Caring for yourself is not self-indulgence, it is self-preservation.",
]

/** Pick a random quote (stable per call). */
export function randomHealthQuote(): string {
  const i = Math.floor(Math.random() * HEALTH_QUOTES.length)
  return HEALTH_QUOTES[i]
}