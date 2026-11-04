// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! A decoded track kept as 16-bit samples (half the memory of `f32`: a 3-hour lecture is
//! 345 MB instead of 691 MB, critique G22 / R9); windows are handed out as `f32`.

#[derive(Debug, Clone, Default)]
pub struct Track16 {
    samples: Vec<i16>,
}

fn to_i16(x: f32) -> i16 {
    (x.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16
}

impl Track16 {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_f32(x: &[f32]) -> Self {
        let mut t = Self::new();
        t.push(x);
        t
    }

    pub fn push(&mut self, x: &[f32]) {
        self.samples.extend(x.iter().map(|v| to_i16(*v)));
    }

    pub fn len(&self) -> usize {
        self.samples.len()
    }

    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }

    /// Samples `a..b` (clamped) as `f32`.
    pub fn to_f32(&self, a: usize, b: usize) -> Vec<f32> {
        let b = b.min(self.samples.len());
        let a = a.min(b);
        self.samples[a..b]
            .iter()
            .map(|s| *s as f32 / i16::MAX as f32)
            .collect()
    }

    /// The length in ms at 16 kHz.
    pub fn duration_ms(&self) -> u64 {
        self.samples.len() as u64 * 1000 / crate::SAMPLE_RATE as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_sixteen_bits() {
        let t = Track16::from_f32(&[0.0, 0.5, -1.0, 2.0]);
        assert_eq!(t.len(), 4);
        let back = t.to_f32(0, 10);
        assert!((back[1] - 0.5).abs() < 1e-4);
        assert_eq!(back[2], -1.0);
        assert_eq!(back[3], 1.0);
        assert!(t.to_f32(3, 1).is_empty());
    }
}
