#!/bin/bash
# usage: wer_run.sh MODEL TAG files...
L=/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/audio
M=$1; TAG=$2; shift 2
cd $L/wer
for f in "$@"; do
  s=$(date +%s.%N)
  $L/whisper-build/bin/whisper-cli -m "$M" -f $f -l pt -t 8 -nt -otxt -of ${TAG}_${f%.wav} > ${TAG}_${f%.wav}.log 2>&1
  e=$(date +%s.%N)
  echo "$TAG $f $(python3 -I -c "print(round($e-$s,1))")s" >> $L/wer/times.txt
done
echo "DONE $TAG" >> $L/wer/times.txt
