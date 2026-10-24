import { z } from 'zod';
import { defineAgent } from '../agent.ts';

/**
 * Check-in photo review (tier 0), asked for by HR on one punch: does the photo look like a live picture of a person
 * (not a photo of a photo or a screen), and does it show the same person as the profile photo? A suggestion for
 * the reviewer, never a verdict: HR decides whether to flag the punch. Nothing is stored but the run's metrics.
 */

const MAX_BASE64 = Math.ceil((2 * 1024 * 1024 * 4) / 3) + 4; // 2 MB
const image = z.object({ mediaType: z.enum(['image/jpeg', 'image/png']), data: z.string().min(16).max(MAX_BASE64) });

const output = z.object({
  looksLive: z.boolean().describe('true if this looks like a live photo of a person taken with a camera'),
  livenessConcerns: z.array(z.string().max(160)).max(4).describe('What suggests a photo of a photo, a screen, a mask or editing; empty if none'),
  samePerson: z.enum(['yes', 'no', 'unsure', 'no_profile_photo']).describe('Whether the check-in photo shows the same person as the profile photo'),
  note: z.string().max(240).describe('One sentence for the reviewer'),
});

export type SelfieReview = z.infer<typeof output>;

export const selfieReview = defineAgent({
  key: 'selfie_review',
  promptVersion: 'selfie_review/1.0.0',
  maxTier: 0,
  permission: 'attendance.manage',
  model: 'default',
  maxTokens: 400,
  input: z.object({ photo: image, profilePhoto: image.nullable() }),
  redactInput: [],
  output,
  outputDescription: 'Give your review of the check-in photo.',
  tools: [],

  async load() {
    return {};
  },

  prompt(input) {
    return {
      system: [
        'You help an HR reviewer check an attendance check-in photo. The first image is the check-in photo; the second, if any, is the employee’s profile photo.',
        '',
        'Rules:',
        '- Say whether the check-in photo looks like a live camera photo of a person, or like a photo of a printed picture, a phone or computer screen, a mask, or an edited image. Name what you see that suggests it.',
        '- Compare faces only to say whether it is plausibly the same person; say "unsure" when lighting, angle or quality don’t allow it. Never guess identity, age, gender, ethnicity or anything else about the person.',
        '- You are giving a suggestion to a person who decides. Be cautious and plain.',
      ].join('\n'),
      content: [
        { type: 'file', mediaType: input.photo.mediaType, data: input.photo.data, name: 'check-in photo' },
        ...(input.profilePhoto ? [{ type: 'file' as const, mediaType: input.profilePhoto.mediaType, data: input.profilePhoto.data, name: 'profile photo' }] : []),
      ],
    };
  },

  finalize(out, input): SelfieReview {
    return { ...out, samePerson: input.profilePhoto ? out.samePerson === 'no_profile_photo' ? 'unsure' : out.samePerson : 'no_profile_photo' };
  },

  mock(input) {
    // Test images that carry the text SCREEN read as a photo of a screen.
    const screen = Buffer.from(input.photo.data, 'base64').toString('latin1').includes('SCREEN');
    return {
      output: {
        looksLive: !screen,
        livenessConcerns: screen ? ['Moiré pattern and a visible screen edge: likely a photo of a screen'] : [],
        samePerson: input.profilePhoto ? ('unsure' as const) : ('no_profile_photo' as const),
        note: screen ? 'This looks like a picture of a screen rather than a live photo.' : 'Nothing suggests this isn’t a live photo.',
      },
    };
  },
});
