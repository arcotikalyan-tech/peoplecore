import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-file-system/legacy', () => ({}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
const { filesToDelete } = await import('../src/lib/device-files');

const cache = 'file:///data/user/0/in.peoplecore.app/cache/';
const listing = {
  root: ['payslip-2026-09.pdf', 'payslip-2026-10.pdf', 'http-cache', 'notes.txt'],
  photos: { ImagePicker: ['a1.jpeg'], ImageManipulator: ['b1.jpg', 'b2.jpg'] },
};

describe('files left on the phone', () => {
  it('at sign-out: payslips and photos go, but not the photo of a punch still waiting to be sent', () => {
    const waiting = `${cache}ImageManipulator/b2.jpg`;
    expect(filesToDelete(cache, listing, [waiting], { payslips: true, photos: true })).toEqual([
      `${cache}payslip-2026-09.pdf`, `${cache}payslip-2026-10.pdf`, `${cache}ImagePicker/a1.jpeg`, `${cache}ImageManipulator/b1.jpg`,
    ]);
  });

  it('after punches are sent: only photos, nothing else in the cache', () => {
    expect(filesToDelete(cache, listing, [], { payslips: false, photos: true })).toEqual([
      `${cache}ImagePicker/a1.jpeg`, `${cache}ImageManipulator/b1.jpg`, `${cache}ImageManipulator/b2.jpg`,
    ]);
  });

  it('before a payslip download: only old payslips', () => {
    expect(filesToDelete(cache, listing, [], { payslips: true, photos: false })).toEqual([`${cache}payslip-2026-09.pdf`, `${cache}payslip-2026-10.pdf`]);
  });
});
