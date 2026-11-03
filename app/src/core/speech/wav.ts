// The WAV header of Trama's call recordings: 16-bit PCM, 16 kHz, two channels (the researcher's
// microphone on the left, what the computer played on the right). Players everywhere read it.

export const WAV_HEADER_BYTES = 44;

export function wavHeader(dataBytes: number, rate: number, channels: number): Uint8Array {
  const b = new Uint8Array(WAV_HEADER_BYTES);
  const v = new DataView(b.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) b[at + i] = s.charCodeAt(i);
  };
  const blockAlign = channels * 2;
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, dataBytes, true);
  return b;
}
