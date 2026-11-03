#!/bin/bash
L=/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/audio
export CARGO_HOME=$L/cargo-home
cd $L/proj/opuslab
for v in base libopus opusrs rusty opusdec mousiki all; do
  case $v in base) F="";; all) F="--features libopus,opusrs,rusty,opusdec,mousiki";; *) F="--features $v";; esac
  T=$L/target-$v; rm -rf $T
  s=$(date +%s.%N)
  cargo build --release $F --target-dir $T > $L/build-$v.log 2>&1; rc=$?
  e=$(date +%s.%N)
  sz=$(stat -c %s $T/release/opuslab 2>/dev/null)
  echo "$v rc=$rc time=$(python3 -I -c "print(round($e-$s,1))")s size=$sz" >> $L/variants.txt
done
echo DONE >> $L/variants.txt
