import type { ClimateFact } from '@outside/shared';
import { describe, expect, it } from 'vitest';
import { MAX_PLACE_SEARCHES, OFFER_WORDS, activitiesFor, activityOfferWords, fitsActivity, isForAnother, placeSearches, speaksOf } from '../src/pipeline/activities';
import { seasonOf } from '../src/pipeline/season';

const january = { start: '2027-01-15', end: '2027-01-20', fromListing: true };
const july = { start: '2027-07-10', end: '2027-07-17', fromListing: true };
const april = { start: '2027-04-10', end: '2027-04-14', fromListing: true };

function climate(tempMaxC: number, snowDaysPercent = 0, month = 'January'): ClimateFact {
  return { id: 'climate:stay', kind: 'climate', month, tempMinC: tempMaxC - 8, tempMaxC, wetDaysPercent: 30, snowDaysPercent, conditions: 'some rain', sourceId: 'open-meteo-archive' };
}

const winter = seasonOf(climate(3, 30), january, 47);
const summer = seasonOf(climate(27, 0, 'July'), july, 47);
const spring = seasonOf(climate(15, 0, 'April'), april, 47);

const labels = (interest: Parameters<typeof activitiesFor>[0], season: typeof winter): string[] =>
  activitiesFor(interest, season).map((activity) => activity.label);

describe('activitiesFor', () => {
  it('lists what an active person does in winter', () => {
    expect(labels('adventure', winter)).toEqual(['Ski & snowboard', 'Sledding', 'Ice skating']);
    expect(labels('nature', winter)).toEqual(['Snowshoe & winter walks', 'Cross-country skiing']);
    expect(labels('water', winter)).toEqual(['Thermal baths', 'Indoor pools']);
  });

  it('lists what an active person does in summer', () => {
    expect(labels('adventure', summer)).toEqual(['Quad & buggy', 'Swimming', 'Rafting & canyoning', 'Mountain biking', 'Climbing', 'Paragliding']);
    expect(labels('nature', summer)).toEqual(['Hiking', 'Viewpoints']);
    expect(labels('water', summer)).toEqual(['Swimming', 'Kayak & SUP', 'Boat trips']);
  });

  it('keeps to what works in between seasons', () => {
    expect(labels('adventure', spring)).toEqual(['Mountain biking', 'Climbing', 'Quad & buggy']);
    expect(labels('nature', spring)).toEqual(['Hiking', 'Viewpoints']);
  });

  it('has no activities for interests that are about places, not doing', () => {
    expect(activitiesFor('food', winter)).toEqual([]);
    expect(activitiesFor('culture', summer)).toEqual([]);
  });

  it('gives each activity what the search, the script and the photo need', () => {
    const [ski] = activitiesFor('adventure', winter);

    expect(ski).toMatchObject({
      id: 'ski',
      label: 'Ski & snowboard',
      doing: 'skiing and snowboarding',
      query: 'ski resort',
      offerWords: ['skiing', 'ski day', 'ski-day', 'ski lesson', 'ski lessons', 'ski tour', 'ski touring', 'ski pass', 'snowboard', 'snowboarding'],
      photoWord: 'skiing',
      radiusM: 40_000,
    });
  });
});

describe('placeSearches', () => {
  const queries = (interests: Parameters<typeof placeSearches>[0], season: typeof winter): string[] =>
    placeSearches(interests, season).map((search) => `${search.interest}: ${search.query}`);

  it('takes turns between the interests, most wanted activity first', () => {
    expect(queries(['adventure', 'nature'], winter)).toEqual([
      'adventure: ski resort',
      'nature: winter hiking trail',
      'adventure: toboggan run',
      'nature: cross-country ski trail',
    ]);
  });

  it('spends all its searches on one interest when that is all there is', () => {
    expect(queries(['adventure'], summer)).toEqual([
      'adventure: quad ATV buggy tour',
      'adventure: swimming lake or beach',
      'adventure: rafting',
      'adventure: bike park',
    ]);
    expect(MAX_PLACE_SEARCHES).toBe(4);
  });

  it('mixes activities with the one search of a place-kind interest', () => {
    expect(queries(['food', 'adventure', 'culture'], winter)).toEqual([
      'food: cosy restaurant',
      'adventure: ski resort',
      'culture: museum',
      'adventure: toboggan run',
    ]);
  });

  it('carries the activity on the searches that have one', () => {
    const searches = placeSearches(['food', 'adventure'], winter);

    expect(searches[0]).toMatchObject({ interest: 'food', query: 'cosy restaurant', fallback: 'local restaurants' });
    expect(searches[0]).not.toHaveProperty('activity');
    expect(searches[1]).toMatchObject({ interest: 'adventure', query: 'ski resort', activity: { id: 'ski', label: 'Ski & snowboard' } });
  });

  it('never runs the same search twice', () => {
    const searches = placeSearches(['adventure', 'family'], winter).map((search) => search.query);

    expect(new Set(searches).size).toBe(searches.length);
  });
});

describe('activityOfferWords', () => {
  it('collects the words that mark a bookable offer as one of the planned activities', () => {
    const words = activityOfferWords(placeSearches(['adventure', 'nature'], winter));

    expect(words).toEqual(expect.arrayContaining(['skiing', 'snowboard', 'snowshoe', 'sledding', 'toboggan']));
    expect(activityOfferWords(placeSearches(['food'], winter))).toEqual([]);
  });

  it('does not take a ticket to a ski jump, or a sleigh ride, for the sport', () => {
    const words = activityOfferWords(placeSearches(['adventure', 'nature'], winter));

    expect(words).not.toContain('ski');
    expect(words).not.toContain('sleigh');
  });
});

describe('OFFER_WORDS', () => {
  it('holds the offer words of every activity, planned or not, so an offer can be told apart from a neighbouring activity', () => {
    expect(OFFER_WORDS.get('quad')).toEqual(expect.arrayContaining(['quad', 'atv', 'buggy', 'jeep']));
    expect(OFFER_WORDS.get('swim')).toEqual(expect.arrayContaining(['swimming', 'snorkeling']));
    expect(OFFER_WORDS.get('cross-country')).toEqual(expect.arrayContaining(['cross-country']));
    expect(OFFER_WORDS.size).toBe(18);
  });
});

describe('isForAnother', () => {
  const find = (interest: Parameters<typeof activitiesFor>[0], season: typeof winter, id: string) =>
    activitiesFor(interest, season).find((activity) => activity.id === id)!;
  const rafting = find('adventure', summer, 'rafting');
  const quad = find('adventure', summer, 'quad');
  const swim = find('water', summer, 'swim');
  const paddle = find('water', summer, 'paddle');
  const sled = find('adventure', winter, 'sled');
  const crossCountry = find('nature', winter, 'cross-country');
  const snowshoe = find('nature', winter, 'snowshoe');

  it('spots a place Maps offered for one activity that is plainly for another', () => {
    expect(isForAnother({ name: 'Kayak Caves Tours', category: 'Tour operator' }, rafting)).toBe(true);
    expect(isForAnother({ name: 'Axamer Lizum Ski Resort', category: 'Ski resort' }, crossCountry)).toBe(true);
    expect(isForAnother({ name: 'Bergisel Ski Jump', category: 'Tourist attraction' }, sled)).toBe(true);
    expect(isForAnother({ name: 'Lagos Boat Trips', category: 'Tour operator' }, paddle)).toBe(true);
  });

  it('keeps a place that speaks of the activity, in its name, its kind or its description', () => {
    expect(isForAnother({ name: 'Wiggi Rafting GmbH', category: 'Event management company' }, rafting)).toBe(false);
    expect(isForAnother({ name: 'SOURCE TO SEA - Kayak School - Shop - Rafting', category: 'Store' }, paddle)).toBe(false);
    expect(isForAnother({ name: 'Algarve: Quinta Quads & Buggy Tours', category: 'Tour agency' }, quad)).toBe(false);
    expect(isForAnother({ name: 'Praia Maria Luísa', category: 'Public beach' }, swim)).toBe(false);
    expect(isForAnother({ name: 'Torfstich Loipe Cross Country Sking', category: 'Ski resort' }, crossCountry)).toBe(false);
    expect(isForAnother({ name: 'Zirbenweg', category: 'Hiking area', description: 'Gentle trekking route with views.' }, snowshoe)).toBe(false);
    expect(isForAnother({ name: 'Lake Lans', category: 'Lake', description: 'Small, scenic lake popular for swimming.' }, swim)).toBe(false);
  });

  it('needs the place for an activity run by operators to say so itself', () => {
    const paraglide = find('adventure', summer, 'paraglide');

    expect(isForAnother({ name: 'Dream Wave', category: 'Boat tour agency' }, rafting)).toBe(true);
    expect(isForAnother({ name: 'Fly Tirol', category: 'Flight school' }, paraglide)).toBe(true);
    expect(isForAnother({ name: 'Offroad Arena', category: 'Off-road racing venue' }, quad)).toBe(false);
    expect(isForAnother({ name: 'Alpin Center', category: 'Tour operator', description: 'Guided rafting and canyoning trips.' }, rafting)).toBe(false);
  });

  it('counts only the name against a place: a ski resort may well have a toboggan run', () => {
    expect(isForAnother({ name: 'Bergeralm', category: 'Ski resort', description: 'Family ski area with hiking trails and views.' }, sled)).toBe(false);
  });

  it('knows how every activity in the catalogue shows itself', () => {
    const all = [winter, summer, spring].flatMap((season) =>
      (['adventure', 'nature', 'water', 'family'] as const).flatMap((interest) => activitiesFor(interest, season)),
    );

    expect(all.length).toBeGreaterThan(20);
    for (const activity of all) {
      expect(speaksOf(activity.query, activity.id), activity.id).toBe(true);
    }
  });

  it('trusts Maps where the place says nothing either way', () => {
    expect(isForAnother({ name: 'Rumer Alm', category: 'Mountain cabin' }, sled)).toBe(false);
    expect(isForAnother({ name: 'Seegrube', category: 'Tourist attraction' }, snowshoe)).toBe(false);
  });

  it('matches whole words and word starts, not letters inside a word', () => {
    // "Supermarket" is no SUP, "Skibar Alpenrose" does speak of skiing.
    expect(isForAnother({ name: 'Supermarket am Inn', category: 'Mountain cabin' }, sled)).toBe(false);
    expect(isForAnother({ name: 'Skilift Alpenrose', category: 'Bar' }, sled)).toBe(true);
  });

  it('is not fooled by a word that only starts like an activity', () => {
    const paraglide = find('adventure', summer, 'paraglide');

    expect(speaksOf('Skiathos Castle', 'ski')).toBe(false);
    expect(speaksOf('Skincare Clinic', 'ski')).toBe(false);
    expect(speaksOf('Zipfer Bierhaus', 'adventure-park')).toBe(false);
    expect(speaksOf('Sea Life Aquarium', 'pool')).toBe(false);
    expect(speaksOf('Grand Canyon Hotel', 'rafting')).toBe(false);
    expect(isForAnother({ name: 'Tandem Bike Rental', category: 'Bicycle rental service' }, paraglide)).toBe(true);
  });
});

describe('fitsActivity', () => {
  const [, sled] = activitiesFor('adventure', winter);

  it('takes a place that speaks of the activity wherever Maps listed it', () => {
    expect(fitsActivity({ name: 'Rodelbahn Birgitz', category: 'Park', rank: 1 }, sled!)).toBe(true);
  });

  it('takes a place that says nothing either way only as the first answer', () => {
    expect(fitsActivity({ name: 'Rumer Alm', category: 'Mountain cabin', rank: 0 }, sled!)).toBe(true);
    expect(fitsActivity({ name: 'Rumer Alm', category: 'Mountain cabin' }, sled!)).toBe(true);
    expect(fitsActivity({ name: 'Gasthof Post', category: 'Restaurant', rank: 1 }, sled!)).toBe(false);
  });

  it('never takes a place that is plainly for another activity', () => {
    expect(fitsActivity({ name: 'Bergisel Ski Jump', category: 'Tourist attraction', rank: 0 }, sled!)).toBe(false);
  });

  it('lets the caller say which answer counts as the first', () => {
    // Listed second, behind a summer slide the caller has already set aside.
    expect(fitsActivity({ name: 'Rumer Alm', category: 'Mountain cabin', rank: 1 }, sled!, true)).toBe(true);
    expect(fitsActivity({ name: 'Rumer Alm', category: 'Mountain cabin', rank: 0 }, sled!, false)).toBe(false);
  });
});
