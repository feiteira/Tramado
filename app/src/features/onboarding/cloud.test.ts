import { describe, expect, it } from 'vitest';
import { cloudServiceOf, firstName, initials } from './cloud';

describe('cloudServiceOf (UX §3.1, G15)', () => {
  it('finds the cloud folders the UX lists', () => {
    expect(cloudServiceOf('C:\\Users\\ana\\OneDrive\\Tramado')).toBe('OneDrive');
    expect(cloudServiceOf('C:\\Users\\ana\\OneDrive - Universidade\\Tramado')).toBe('OneDrive');
    expect(cloudServiceOf('/home/ana/Dropbox/Tramado')).toBe('Dropbox');
    expect(cloudServiceOf('/Users/ana/Library/Mobile Documents/com~apple~CloudDocs/Tramado')).toBe('iCloud Drive');
    expect(cloudServiceOf('/Users/ana/iCloud Drive/Tramado')).toBe('iCloud Drive');
    expect(cloudServiceOf('G:\\Google Drive\\Tramado')).toBe('Google Drive');
    expect(cloudServiceOf('/Users/ana/Library/CloudStorage/GoogleDrive-ana@example.org/Tramado')).toBe('Google Drive');
  });
  it('leaves ordinary folders alone', () => {
    expect(cloudServiceOf('/home/ana/Tramado')).toBeNull();
    expect(cloudServiceOf('/home/ana/Dropboxes/Tramado')).toBeNull();
    expect(cloudServiceOf('C:\\Users\\ana\\Documents\\Tramado')).toBeNull();
  });
});

describe('names', () => {
  it('takes the first name and initials', () => {
    expect(firstName('  Ana Ribeiro ')).toBe('Ana');
    expect(firstName('Jamie')).toBe('Jamie');
    expect(initials('Ana Ribeiro')).toBe('AR');
    expect(initials('bruno da costa')).toBe('BC');
    expect(initials('Jamie')).toBe('J');
    expect(initials('')).toBe('?');
  });
});
