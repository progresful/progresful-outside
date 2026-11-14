import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { markdownLinks, parseGetYourGuideMarkdown, parseViatorMarkdown } from '../src/sources/experienceParsers';

function fixtureMarkdown(name: string): string {
  const file = new URL(`./fixtures/contextdev/${name}.json`, import.meta.url);
  return (JSON.parse(readFileSync(file, 'utf8')) as { markdown: { data: string } }).markdown.data;
}

const SEP = '\\\\ \\\\ ';

describe('markdownLinks', () => {
  it('finds links whose text holds an image', () => {
    const links = markdownLinks('Intro [plain](https://a.example/x) and [![alt [1]](https://img.example/i.jpg) Title](https://b.example/y "t") end');

    expect(links).toEqual([
      { text: 'plain', url: 'https://a.example/x' },
      { text: '![alt [1]](https://img.example/i.jpg) Title', url: 'https://b.example/y' },
    ]);
  });

  it('ignores brackets that are not links and survives an unclosed one', () => {
    expect(markdownLinks('[note] then [broken](https://a.example')).toEqual([]);
  });
});

describe('parseViatorMarkdown', () => {
  const tours = parseViatorMarkdown(fixtureMarkdown('viator-lisbon'));

  it('reads every tour card of the recorded page', () => {
    expect(tours).toHaveLength(24);
    expect(tours.every((tour) => /^€\d/.test(tour.priceText))).toBe(true);
  });

  it('reads title, price, duration, rating, reviews, link and image', () => {
    expect(tours[0]).toEqual({
      title: 'Small Group Tour to Sintra, Pena Palace, Cabo Roca and Cascais',
      priceText: '€70',
      durationText: '8 hours',
      rating: 4.9,
      reviewCount: 5212,
      url: 'https://www.viator.com/tours/Lisbon/Tour-to-Sintra-Pena-Palace-Cabo-da-Roca-Regaleira-and-Cascais/d538-70273P7',
      imageUrl: 'https://dynamic-media.tacdn.com/media/photo-o/32/b1/71/7e/caption.jpg?w=800&h=600&s=1',
    });
  });

  it('uses the title of the card, not the caption of its photo', () => {
    expect(tours.some((tour) => tour.title.startsWith('Standing on top of a hill'))).toBe(false);
    expect(tours.map((tour) => tour.title)).toContain('Sintra and Cascais Small-Group Day Trip from Lisbon');
    expect(tours.map((tour) => tour.title)).toContain('Lisbon Small-Group Portuguese Food and Wine Tour');
  });

  it('reads compound and ranged durations without the badges glued to them', () => {
    const durations = tours.map((tour) => tour.durationText);

    expect(durations).toContain('9 hours 30 minutes');
    expect(durations).toContain('1 to 5 hours');
    expect(durations).toContain('30 minutes to 5 hours');
    expect(durations.join(' ')).not.toMatch(/Cancellation|mention/);
  });

  it('takes the current price of a discounted tour, not the crossed-out one', () => {
    const tour = tours.find((entry) => entry.title.includes('All Tickets Included'));

    expect(tour).toMatchObject({ priceText: '€31', rating: 4.6, reviewCount: 989, durationText: '9 hours 30 minutes' });
  });

  it('keeps a from-price that varies by group size, and leaves out a price for the whole group', () => {
    expect(tours.find((entry) => entry.url.includes('Airport-Private-Transfer'))?.priceText).toBe('€24');
    const card = `[![Van hire](https://media.tacdn.com/a.jpg)${SEP}Van hire${SEP}2 hours${SEP}4.8${SEP}(120)${SEP}from${SEP}€30${SEP}per group (up to 8)](https://www.viator.com/tours/X/Van/d1-1P1)`;
    expect(parseViatorMarkdown(card)).toEqual([]);
  });

  it('skips the attraction tiles and anything without a price', () => {
    const card = `[![A tour](https://media.tacdn.com/a.jpg)${SEP}A tour${SEP}2 hours${SEP}4.8${SEP}(120)](https://www.viator.com/tours/X/A-tour/d1-1P1)`;
    const tile = `[**Ribeira**${SEP}Explore Options${SEP}from€12](https://www.viator.com/Porto-attractions/Ribeira/d26879-a2831)`;

    expect(parseViatorMarkdown(`${card}\n\n${tile}`)).toEqual([]);
  });

  it('returns nothing for a page that is not a results page', () => {
    expect(parseViatorMarkdown('# Access denied')).toEqual([]);
  });
});

describe('parseGetYourGuideMarkdown', () => {
  const tours = parseGetYourGuideMarkdown(fixtureMarkdown('gyg-lisbon'));
  const byTitle = (part: string) => tours.find((tour) => tour.title.includes(part));

  it('reads the rated, per-person cards of the recorded page', () => {
    // 24 cards on the page, three of them sold per group.
    expect(tours.length).toBeGreaterThanOrEqual(20);
    expect(tours.length).toBeLessThan(24);
  });

  it('separates the place prefix, the title and the duration', () => {
    expect(tours[0]).toMatchObject({
      title: 'Lisbon: Sintra, Pena, Regaleira, Cabo da Roca Coast & Cascais',
      durationText: '9 hours',
      rating: 4.8,
      reviewCount: 12717,
    });
    expect(byTitle('Fado Show & Wine')).toMatchObject({ title: 'Lisbon: Top-Rated Authentic Fado Show & Wine', durationText: '50 minutes' });
    expect(byTitle('Benagil Sea Cave')?.title).toBe('From Lisbon: Algarve, Benagil Sea Cave & Lagos Full-Day Tour');
    expect(byTitle('Edge of Europe')?.title).toBe('Estoril: Hike on the Edge of Europe');
    expect(byTitle('Sunset Boat Party')?.durationText).toBe('1.5 - 4 hours');
  });

  it('takes the current price, not the crossed-out one', () => {
    expect(tours[0]?.priceText).toBe('€24');
    expect(byTitle('Pastel de Nata')?.priceText).toBe('€55');
  });

  it('drops the tracking query from the link and the placeholder image', () => {
    expect(tours[0]?.url).toBe('https://www.getyourguide.com/lisbon-l42/lisbon-sintra-pena-regaleira-cabo-da-roca-coast-cascai-t490146/');
    expect(tours[0]).not.toHaveProperty('imageUrl');
  });

  it('leaves out offers priced per group or sold to a private group', () => {
    expect(byTitle('Private Guided Tuk-Tuk Tour with Hotel Pickup')).toBeUndefined();
    expect(byTitle('Private Transfer to Porto')).toBeUndefined();
    expect(byTitle('Photoshoot')).toBeUndefined();
  });

  it('cleans a title that repeats its place and is decorated with emoji', () => {
    const card = `[![image](https://cdn.getyourguide.com/fallback/default.png)${SEP}Rovaniemi⭐Rovaniemi: Northern Lights Tour - 100% Guarantee & Photos⭐4 hours • Small group${SEP}4.9${SEP}(2,150)${SEP}From€79](https://www.getyourguide.com/rovaniemi-l1/northern-lights-t99/)`;

    expect(parseGetYourGuideMarkdown(card)[0]).toMatchObject({
      title: 'Rovaniemi: Northern Lights Tour - 100% Guarantee & Photos',
      durationText: '4 hours',
      priceText: '€79',
    });
  });

  it('keeps a real image when the page provides one', () => {
    const card = `[![image](https://cdn.getyourguide.com/img/tour-1.jpg)${SEP}PortoSix Bridges Cruise50 minutes${SEP}4.3${SEP}(8,120)${SEP}From€18](https://www.getyourguide.com/porto-l151/six-bridges-t123/?q=Porto)`;

    expect(parseGetYourGuideMarkdown(card)).toEqual([
      {
        title: 'Porto: Six Bridges Cruise',
        priceText: '€18',
        durationText: '50 minutes',
        rating: 4.3,
        reviewCount: 8120,
        url: 'https://www.getyourguide.com/porto-l151/six-bridges-t123/',
        imageUrl: 'https://cdn.getyourguide.com/img/tour-1.jpg',
      },
    ]);
  });
});
