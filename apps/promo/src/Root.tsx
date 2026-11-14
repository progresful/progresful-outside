import { useEffect, useState } from 'react';
import { Composition, continueRender, delayRender } from 'remotion';
import { FPS, HEIGHT, PLAN, WIDTH } from './film';
import { Promo } from './Promo';

/** Every face the film sets type in. A frame drawn before they have loaded would be drawn in the wrong one. */
const FACES = ['700 48px "Bricolage Grotesque"', '400 24px Inter', '500 24px Inter', '600 24px Inter'];

function useFacesLoaded(): void {
  const [handle] = useState(() => delayRender('Loading the typefaces'));
  useEffect(() => {
    Promise.all(FACES.map((face) => document.fonts.load(face)))
      .then(() => document.fonts.ready)
      .then(
        () => continueRender(handle),
        () => continueRender(handle),
      );
  }, [handle]);
}

export function Root() {
  useFacesLoaded();
  return <Composition id="Promo" component={Promo} durationInFrames={PLAN.durationInFrames} fps={FPS} width={WIDTH} height={HEIGHT} />;
}
