import type { Source, WeatherFact } from '@outside/shared';
import { z } from 'zod';
import { scrapeKey } from '../cache/keys';
import { round2 } from './geo';
import { addDays, type TripWindow } from './tripWindow';
import { emptyResult, type LatLng, type SourceDeps, type SourceResult } from './types';

const SOURCE_ID = 'open-meteo';
/** Open-Meteo forecasts 16 days including today. */
const FORECAST_DAYS = 15;

const DailyValues = z.array(z.number().nullable()).default([]);
const ForecastSchema = z.object({
  daily: z.object({
    temperature_2m_max: DailyValues,
    temperature_2m_min: DailyValues,
    precipitation_probability_max: DailyValues,
  }),
});

export interface WeatherParams extends LatLng {
  window: TripWindow;
  today: string;
}

function present(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null);
}

function forecastUrl(p: LatLng, start: string, end: string): string {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lng}` +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    `&start_date=${start}&end_date=${end}&timezone=auto`
  );
}

async function requestWeather(deps: SourceDeps, p: WeatherParams, end: string): Promise<SourceResult<WeatherFact>> {
  const res = await deps.fetch(forecastUrl(p, p.window.start, end));
  if (!res.ok) {
    throw new Error(`Open-Meteo responded with status ${res.status}`);
  }
  const { daily } = ForecastSchema.parse(await res.json());
  const maxes = present(daily.temperature_2m_max);
  const mins = present(daily.temperature_2m_min);
  if (maxes.length === 0 || mins.length === 0) {
    return emptyResult();
  }
  const fact: WeatherFact = {
    id: 'weather:stay',
    kind: 'weather',
    tempMinC: Math.round(Math.min(...mins)),
    tempMaxC: Math.round(Math.max(...maxes)),
    precipitationChance: Math.max(0, ...present(daily.precipitation_probability_max)),
    sourceId: SOURCE_ID,
  };
  const source: Source = {
    id: SOURCE_ID,
    label: 'Open-Meteo',
    url: 'https://open-meteo.com',
    fetchedAt: new Date(deps.now()).toISOString(),
  };
  return { facts: [fact], source };
}

/** The outlook for the stay, or nothing when the stay starts beyond the forecast range. Never throws. */
export async function fetchWeather(deps: SourceDeps, p: WeatherParams): Promise<SourceResult<WeatherFact>> {
  const horizon = addDays(p.today, FORECAST_DAYS);
  if (p.window.start > horizon) {
    return emptyResult();
  }
  const end = p.window.end > horizon ? horizon : p.window.end;
  const key = scrapeKey('weather', { lat: round2(p.lat), lng: round2(p.lng), start: p.window.start, end });
  const cached = deps.cache.get<SourceResult<WeatherFact>>(key, deps.now());
  if (cached) {
    return cached.value;
  }
  try {
    return await deps.dedupe(key, async () => {
      const result = await requestWeather(deps, p, end);
      if (result.facts.length > 0) {
        deps.cache.set(key, result, { fetchedAt: deps.now() });
      }
      return result;
    });
  } catch (error: unknown) {
    deps.onSourceError?.(SOURCE_ID, error);
    return emptyResult();
  }
}

/** What falls when it is this cold: snow when the stay never gets above freezing, otherwise rain. */
export function precipitationWord(fact: Pick<WeatherFact, 'tempMaxC'>): 'snow' | 'rain' {
  return fact.tempMaxC <= 0 ? 'snow' : 'rain';
}
