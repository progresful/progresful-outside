import { z } from 'zod';

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const MAX_LISTING_PHOTOS = 5;

export const ListingContextSchema = z.object({
  site: z.enum(['airbnb', 'booking']),
  listingId: z.string().min(1).max(200),
  url: z.url().max(2000),
  title: z.string().min(1).max(300),
  locationText: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  photos: z.array(z.url().max(2000)).max(MAX_LISTING_PHOTOS),
  checkIn: IsoDateSchema.optional(),
  checkOut: IsoDateSchema.optional(),
  guests: z.number().int().min(1).max(50).optional(),
  currency: z.string().length(3).optional(),
});

export type ListingContext = z.infer<typeof ListingContextSchema>;
