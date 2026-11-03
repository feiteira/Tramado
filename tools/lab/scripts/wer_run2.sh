#!/bin/bash
# usage: wer_run2.sh MODEL TAG files...   (Trama-like: greedy, no context, Silero VAD)
L=/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/audio
VAD=/home/feiteira/Trama/desktop/src-tauri/resources/speech/ggml-silero-v5.1.2.bin
M=$1; TAG=$2; shift 2
cd $L/wer
for f in "$@"; do
  s=$(date +%s.%N)
  $L/whisper-build/bin/whisper-cli -m "$M" -f $f -l pt -t 8 -bs 1 -bo 1 -mc 0 --vad -vm $VAD -nt -otxt -of ${TAG}_${f%.wav} > ${TAG}_${f%.wav}.log 2>&1
  e=$(date +%s.%N)
  echo "$TAG $f $(python3 -I -c "print(round($e-$s,1))")s" >> $L/wer/times2.txt
done
echo "DONE $TAG" >> $L/wer/times2.txt
