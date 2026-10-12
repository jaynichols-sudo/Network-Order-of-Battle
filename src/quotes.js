// A short line for the top of Home, one per day. Only well-sourced quotes: no misattributions.
export const QUOTES = [
  ['The friends thou hast, and their adoption tried, grapple them unto thy soul with hoops of steel.', 'William Shakespeare, Hamlet'],
  ['Well done is better than well said.', 'Benjamin Franklin'],
  ['While we are postponing, life speeds by.', 'Seneca'],
  ['The only way to have a friend is to be one.', 'Ralph Waldo Emerson'],
  ['Well begun is half done.', 'Aristotle'],
  ['Knowing is not enough; we must apply.', 'Johann Wolfgang von Goethe'],
  ['Diligence is the mother of good luck.', 'Benjamin Franklin'],
  ['Waste no more time arguing what a good man should be. Be one.', 'Marcus Aurelius'],
  ['Nothing great was ever achieved without enthusiasm.', 'Ralph Waldo Emerson'],
  ['No act of kindness, no matter how small, is ever wasted.', 'Aesop'],
  ['The journey of a thousand miles begins with a single step.', 'Lao Tzu'],
  ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
  ['The best way to cheer yourself up is to try to cheer somebody else up.', 'Mark Twain'],
  ['Lost time is never found again.', 'Benjamin Franklin'],
  ['The secret of success is constancy to purpose.', 'Benjamin Disraeli'],
  ['Patience and diligence, like faith, remove mountains.', 'William Penn'],
  ['To be trusted is a greater compliment than to be loved.', 'George MacDonald'],
  ['Gratitude is not only the greatest of virtues, but the parent of all the others.', 'Cicero'],
  ['Act well your part; there all the honour lies.', 'Alexander Pope'],
  ['Our deeds determine us, as much as we determine our deeds.', 'George Eliot'],
  ['The reward of a thing well done is to have done it.', 'Ralph Waldo Emerson'],
  ['Hitch your wagon to a star.', 'Ralph Waldo Emerson'],
  ['Fortune favors the bold.', 'Virgil'],
  ['Who is wise? He that learns from everyone.', 'Benjamin Franklin'],
  ['Plough deep while sluggards sleep.', 'Benjamin Franklin'],
  ['The victorious strategist only seeks battle after the victory has been won.', 'Sun Tzu'],
  ['If you know the enemy and know yourself, you need not fear the result of a hundred battles.', 'Sun Tzu'],
  ['The beginning is the most important part of the work.', 'Plato'],
  ['First say to yourself what you would be; and then do what you have to do.', 'Epictetus'],
  ['Small opportunities are often the beginning of great enterprises.', 'Demosthenes'],
  ['Our doubts are traitors, and make us lose the good we oft might win, by fearing to attempt.', 'William Shakespeare, Measure for Measure'],
  ['There is a tide in the affairs of men, which, taken at the flood, leads on to fortune.', 'William Shakespeare, Julius Caesar'],
  ['Courage is resistance to fear, mastery of fear, not absence of fear.', 'Mark Twain'],
  ['Never leave that till tomorrow which you can do today.', 'Benjamin Franklin'],
  ['Do the thing, and you shall have the power.', 'Ralph Waldo Emerson'],
  ['Kind words do not cost much. Yet they accomplish much.', 'Blaise Pascal'],
];

/** The quote for a day ('YYYY-MM-DD'): the same all day, a different one tomorrow, in a fixed shuffle. */
export function quote(day) {
  const d = new Date((day || new Date().toISOString().slice(0, 10)) + 'T12:00:00Z');
  const n = Math.floor(d.getTime() / 86400000);
  const i = ((n * 7) % QUOTES.length + QUOTES.length) % QUOTES.length; // 7 and the list length share no factor
  const [text, by] = QUOTES[i];
  return {text, by};
}
