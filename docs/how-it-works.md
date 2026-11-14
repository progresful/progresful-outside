# How a video is made

What goes into a video, where each part comes from, how the stay's dates and the picked interests change
it, and what keeps it honest. The reasoning behind the choices is in [decisions.md](decisions.md); how the
sources were picked is in [sources.md](sources.md).

## What a video is made of

| Scene | Live source | Notes |
|---|---|---|
| Opening | Open-Meteo archive, Wikimedia Commons | the month and what the weather is usually like then ("15–20 Jan · usually −6 to 3 °C, snowy"), over a photo of the place in that season |
| Three places, one per interest | Google Maps via Context.dev | searched to suit the season; rating, walking or driving time, photo, "Open now" worked out when the video plays |
| Experiences with prices | Viator and GetYourGuide results pages via Context.dev | best-reviewed offer for the season and per interest; per-person prices only; GetYourGuide is asked for the stay's dates |
| During your stay | Songkick via Context.dev, else Open-Meteo forecast | a concert inside the trip dates, otherwise the forecast when the stay is within 15 days |
| Voiceover | OpenAI writes one line per scene, ElevenLabs speaks it | a guard rejects any number that is not in that scene's facts |

Everything fetched is kept for 6 hours, so a second visit is instant; the video says when its oldest fact
was fetched. How the sources were chosen, and what was tried and dropped (Airbnb Experiences, Tripadvisor,
Eventbrite), is in [sources.md](sources.md).

### It follows the time of year

The stay's dates decide what the video shows. The server reads the same dates in the last three years from
Open-Meteo's archive, so it knows what January in Innsbruck is usually like even though no forecast reaches
that far. From that it works out how the stay will feel (snowy, cold, mild, warm, hot) and:

- searches Maps for what suits it: "winter activities", "ski resort", "thermal bath" and "cosy restaurant" in
  snow; "restaurant with terrace" and "rooftop bar" in heat; "Christmas market" in the weeks before Christmas.
  If a seasonal search finds nothing within 25 km, the usual search runs instead;
- prefers a bookable offer that suits it (snowshoe, sleigh, husky… or boat, kayak…);
- opens on a photo of the place in that season, when Wikimedia Commons has one whose title names the place;
- swaps each outdoor place's stock photo for one taken in that season, found by image search
  ("Innsbrucker Hofgarten Innsbruck winter snow"). The search runs while the script is written and voiced.
  The original photo is used when it sits on a public https host; otherwise the search engine's own copy;
  and if neither downloads, or the search takes more than 9 seconds, the stock photo stays;
- lets the voiceover open with the month and the usual weather.

Image search goes to Bing Images through Context.dev. Google Images answers automated requests with a
CAPTCHA page, which this project does not work around. Watermarked stock-photo sites and social networks are
skipped, and a photo is used only when its title or address names the place or its city. The outro credits
"Bing Images". These photos belong to whoever published them: fine for a demo, not cleared for a public product.

When the usual weather cannot be fetched (it is tried twice), a winter stay beyond 40° of latitude is still
treated as cold; otherwise nothing is assumed and the video is built the plain way. In a mild season no image
search is made, and restaurants, bars, museums and spas always keep their stock photo.

### Things to do, not only places to see

Four interests are about doing something: Adventure & sports, Nature & hikes, Beaches & water, Family & kids.
For those the server does not search Maps for "outdoor activities"; it searches for where each activity of
the season is done, and labels the scene with it:

| Season of the stay | Adventure & sports | Nature & hikes | Beaches & water | Family & kids |
|---|---|---|---|---|
| Snowy or cold | Ski & snowboard, sledding, ice skating | Snowshoe & winter walks, cross-country skiing | Thermal baths, indoor pools | Sledding, ice skating |
| Warm or hot | Quad & buggy, swimming, rafting & canyoning, mountain biking, climbing, paragliding | Hiking, viewpoints | Swimming, kayak & SUP, boat trips | Swimming, adventure parks |
| Mild | Mountain biking, climbing, quad & buggy | Hiking, viewpoints | Kayak & SUP, boat trips | Adventure parks |

A video makes at most four place searches, shared between the picked interests in turn, most wanted activity
first. One interest alone gets four activities searched and the best three shown.

Each activity scene shows, all from live data:

- the activity ("Ski & snowboard") and the place Maps lists first or second for it ("Stubai Glacier");
- what kind of place it is, its rating and number of reviews, and the drive: "Ski resort · 4.7 rating ·
  11,817 reviews · ≈ 45 min drive". People drive to a ski area, so an activity may be up to 40 km away;
- Maps' own one-line description of the place;
- the best offer on Viator or GetYourGuide whose title names the activity, with its price: "A guided
  Ski-Day in Innsbruck … from €340". That offer is then not repeated in the experiences scene.

What keeps it honest: only Maps' first two results for an activity are trusted; a place for the other half
of the year ("Sommerrodelbahn" in January) is dropped; a place whose name is that of another activity is
dropped (a search for rafting in Albufeira returns kayak tours); and a rafting base, quad outfit, kayak
rental, climbing or bike park, paragliding school, boat tour, adventure park or ice rink must say what it is
in its name, kind or description. A place that says nothing either way ("Rumer Alm", a mountain hut with a
toboggan run) is taken on Maps' word only when it is the first result. Where an activity is not found
nearby, there is no scene for it. An offer goes with the activity its title names most exactly, so a
"cross-country skiing day" is not shown beside a downhill ski area. The offer is for the activity in the
area, not necessarily at that very place; its title says where. The drive is an estimate from the
straight-line distance (30 km/h in town, 60 beyond, 80 on a long run), rounded to five minutes above twenty.

## Limits worth knowing

- **Context.dev allows a free organisation 10 requests a minute.** A new video in a new city uses up to 7 (four
  place searches, two marketplaces, events), a few more when the planned searches found too little and each
  interest's broad search runs as well, and one more for each outdoor place
  whose photo is searched. Past ten, the photo searches are the ones that wait, and after 9 seconds the
  stock photos are used. The server queues beyond that rather than fail, so a second new city inside the same minute
  gets a thinner video or "Not enough live data"; a retry a minute later works. On a bigger plan, set
  `CONTEXT_DEV_RPM` in `.env`.
- Typical times, measured on real listings: 11–13 s for a new city, 4–8 s when the city is cached, instant when
  the video itself is cached.
- Experiences and events are looked up by city name as the listing gives it. A listing in a village may get
  places only.
- Booking.com drops the dates from the address for some visitors; the video then covers the next two weeks.
- The Viator, GetYourGuide and Songkick parsers read each site's results page as it is today. If a site
  changes its page, that scene should disappear from new videos until the parser is updated: a card the parser
  cannot read with confidence (no clear title, an ambiguous price) is dropped rather than shown.
- Street View scenes, MP4 export and the other later-tier ideas in the design are not built.
