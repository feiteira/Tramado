// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Admission — sync spec §9 with decisions from the class policy; `decide()` is shared with TS through
//! `test-vectors/admission.json`; §9.5 widening checks, start-up rule, strikes, early eviction. Empty in M0:
//! R-SYNC implements it.
