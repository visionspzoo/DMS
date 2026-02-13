import { supabase } from './supabase';

const rateCache = new Map<string, { rate: number; effectiveDate: string }>();

function cacheKey(currency: string, date: string): string {
  return `${currency}_${date}`;
}

async function fetchNBPRateForDate(
  currency: string,
  targetDate: string
): Promise<{ rate: number; effectiveDate: string } | null> {
  const key = cacheKey(currency, targetDate);
  if (rateCache.has(key)) return rateCache.get(key)!;

  try {
    const end = new Date(targetDate);
    const start = new Date(end);
    start.setDate(start.getDate() - 7);

    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    const res = await fetch(
      `https://api.nbp.pl/api/exchangerates/rates/a/${currency}/${startStr}/${endStr}/?format=json`
    );

    if (res.ok) {
      const data = await res.json();
      const rates = data.rates;
      if (rates && rates.length > 0) {
        const last = rates[rates.length - 1];
        const result = { rate: last.mid, effectiveDate: last.effectiveDate };
        rateCache.set(key, result);
        return result;
      }
    }

    const fallbackRes = await fetch(
      `https://api.nbp.pl/api/exchangerates/rates/a/${currency}/last/1/?format=json`
    );
    if (fallbackRes.ok) {
      const data = await fallbackRes.json();
      const result = { rate: data.rates[0].mid, effectiveDate: data.rates[0].effectiveDate };
      rateCache.set(key, result);
      return result;
    }

    return null;
  } catch {
    return null;
  }
}

interface InvoiceForRate {
  id: string;
  currency: string;
  gross_amount: number | null;
  issue_date: string | null;
  exchange_rate: number | null;
  pln_gross_amount: number | null;
}

export async function fetchAndUpdateExchangeRates<T extends InvoiceForRate>(
  invoices: T[]
): Promise<T[]> {
  const needsRate = invoices.filter(inv => {
    if (!inv.currency || inv.currency === 'PLN') return false;
    if (inv.exchange_rate && inv.exchange_rate !== 1 && inv.exchange_rate !== 0) return false;
    return true;
  });

  if (needsRate.length === 0) return invoices;

  const uniquePairs = new Map<string, { currency: string; date: string }>();
  for (const inv of needsRate) {
    const date = inv.issue_date || new Date().toISOString().split('T')[0];
    const key = cacheKey(inv.currency, date);
    if (!uniquePairs.has(key)) {
      uniquePairs.set(key, { currency: inv.currency.toUpperCase(), date });
    }
  }

  const rateResults = new Map<string, number>();
  const fetchPromises = Array.from(uniquePairs.entries()).map(async ([key, { currency, date }]) => {
    const result = await fetchNBPRateForDate(currency, date);
    if (result) {
      rateResults.set(key, result.rate);
    }
  });

  await Promise.all(fetchPromises);

  const updatePromises: Promise<void>[] = [];
  const updated = invoices.map(inv => {
    if (!inv.currency || inv.currency === 'PLN') return inv;
    if (inv.exchange_rate && inv.exchange_rate !== 1 && inv.exchange_rate !== 0) return inv;

    const date = inv.issue_date || new Date().toISOString().split('T')[0];
    const key = cacheKey(inv.currency.toUpperCase(), date);
    const rate = rateResults.get(key);

    if (!rate) return inv;

    const grossAmount = Number(inv.gross_amount) || 0;
    const plnAmount = Math.round(grossAmount * rate * 100) / 100;

    updatePromises.push(
      supabase
        .from('invoices')
        .update({ exchange_rate: rate, pln_gross_amount: plnAmount })
        .eq('id', inv.id)
        .then(() => {})
    );

    return {
      ...inv,
      exchange_rate: rate,
      pln_gross_amount: plnAmount,
    };
  });

  Promise.all(updatePromises).catch(err =>
    console.error('Error persisting exchange rates:', err)
  );

  return updated;
}
