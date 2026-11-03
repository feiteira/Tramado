// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! `cpu_supported()`: x86-64 needs AVX2, FMA and F16C (whisper.cpp is built with them); aarch64 always.
//! Empty in M0: R-SPEECH.
