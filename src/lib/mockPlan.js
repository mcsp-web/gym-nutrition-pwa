// Offline stand-in for the Claude meal plan, used only in mock mode.
// Same JSON shape the Edge Function returns, so the UI doesn't care which one ran.
const TEMPLATES = {
  Breakfast: [
    ['Egg whites + 2 whole eggs', 'scramble', 0.30, 0.05, 0.35],
    ['Oatmeal with berries', '1 cup cooked', 0.05, 0.30, 0.10]
  ],
  Lunch: [
    ['Grilled chicken breast', '1 palm (≈4 oz)', 0.35, 0.00, 0.10],
    ['Jasmine rice', '1 cupped hand', 0.03, 0.30, 0.02],
    ['Mixed greens + olive oil', '1 fist + 1 thumb', 0.02, 0.05, 0.25]
  ],
  Dinner: [
    ['Lean ground turkey', '1 palm (≈4 oz)', 0.30, 0.00, 0.15],
    ['Roasted sweet potato', '1 cupped hand', 0.02, 0.25, 0.02],
    ['Broccoli', '1 fist', 0.03, 0.05, 0.01]
  ],
  Snacks: [
    ['Greek yogurt', '1 cup', 0.15, 0.08, 0.05],
    ['Almonds', '1 thumb', 0.03, 0.02, 0.20]
  ]
};

const SHARE = { Breakfast: 0.25, Lunch: 0.30, Dinner: 0.30, Snacks: 0.15 };

export function mockMealPlan({ calories, protein_g, carbs_g, fat_g }, preferences = '') {
  const meals = Object.entries(TEMPLATES).map(([name, items]) => {
    const share = SHARE[name];
    const rows = items.map(([food, amount, p, c, f]) => {
      // Spread each meal's share of the targets across its items by weight.
      const pw = items.reduce((s, i) => s + i[2], 0) || 1;
      const cw = items.reduce((s, i) => s + i[3], 0) || 1;
      const fw = items.reduce((s, i) => s + i[4], 0) || 1;
      return {
        food,
        amount,
        protein_g: Math.round((protein_g * share * p) / pw),
        carbs_g: Math.round((carbs_g * share * c) / cw),
        fat_g: Math.round((fat_g * share * f) / fw)
      };
    });
    return { name, items: rows };
  });
  const totals = meals.flatMap((m) => m.items).reduce(
    (t, i) => ({ protein_g: t.protein_g + i.protein_g, carbs_g: t.carbs_g + i.carbs_g, fat_g: t.fat_g + i.fat_g }),
    { protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
  totals.calories = totals.protein_g * 4 + totals.carbs_g * 4 + totals.fat_g * 9;
  return {
    meals,
    totals,
    target_calories: calories,
    notes: preferences
      ? `Demo plan (offline). Your note: "${preferences.slice(0, 120)}" — the live version tailors meals to it with Claude.`
      : 'Demo plan (offline). The live version is written by Claude on the server.'
  };
}
