import type { BadgeState } from '../badge/badgeState';

export interface CardInput {
  /** True until the user has picked at least one interest. */
  firstRun: boolean;
  onListing: boolean;
  serverUp: boolean;
  badge?: BadgeState;
  locationText?: string;
}

export interface CardModel {
  title: string;
  subtitle: string;
  action?: 'play' | 'retry';
  progress?: boolean;
  /** The first-run card uses the display font for its title. */
  welcome?: boolean;
}

const NO_LISTING: CardModel = { title: 'No listing in this tab', subtitle: 'Open one on Airbnb or Booking.com.' };

/** The popup's one status card. Copy matches the approved mocks; conditions are checked in priority order. */
export function statusCardFor(input: CardInput): CardModel {
  if (!input.serverUp) {
    return { title: "Can't reach the server", subtitle: "Check that it's running.", action: 'retry' };
  }
  if (input.firstRun) {
    return {
      title: "See what's outside every listing",
      subtitle: 'Pick up to 5 interests to shape the video.',
      welcome: true,
    };
  }
  const badge: BadgeState = input.onListing && input.badge ? input.badge : { kind: 'hidden' };
  switch (badge.kind) {
    case 'hidden':
      return NO_LISTING;
    case 'generating':
      return { title: 'Building your video', subtitle: badge.stage, progress: true };
    case 'refreshing':
      return { title: 'Building your video', subtitle: 'Updating', progress: true };
    case 'ready':
      return { title: 'Video ready', subtitle: input.locationText ?? '', action: 'play' };
    case 'error':
      return { title: "Couldn't build video", subtitle: 'Try again.', action: 'retry' };
  }
}
